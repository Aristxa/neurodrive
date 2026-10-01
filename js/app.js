'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const FIXED_DT = 1 / 60;
const SPEEDS = [1, 3, 10, 30];

/**
 * Application shell: owns the world, the training simulation and the test
 * drive, routes input to the editor / camera, and renders everything.
 */
class App {
  constructor() {
    this.canvas = $('#world');
    this.ctx = this.canvas.getContext('2d');
    this.viewport = new Viewport(this.canvas);
    this.settings = Object.assign(
      {
        population: 150,
        trafficCount: 6,
        generationTime: 45,
        mutationRate: 0.1,
        mutationStrength: 0.3,
        varyTraffic: false,
        showPopulation: true,
        showSensors: true,
        showPath: true,
        followCam: true,
        driveTraffic: 10,
        driveSensors: false,
      },
      AppStorage.load('settings') || {},
    );

    this.keys = {};
    this.driveInput = { up: false, down: false, left: false, right: false };
    this.touchInput = { up: false, down: false, left: false, right: false };
    this.isTouch = window.matchMedia('(pointer: coarse)').matches;
    this.mode = null;
    this.running = true;
    this.simSpeed = 1;
    this.accumulator = 0;
    this.focus = null;
    this.pinnedFocus = null;
    this.drive = null;
    this.path = null;
    this.frameCount = 0;
    this.fps = { frames: 0, since: performance.now() };

    this.editor = new GraphEditor(this);
    this.chart = new FitnessChart($('#chartCanvas'), $('#chartTooltip'));
    this.minimap = new Minimap($('#minimap'), (p) => {
      this._setFollow(false);
      this.viewport.center = { x: p.x, y: p.y };
    });

    const saved = AppStorage.load('world');
    this.loadWorldData(saved && saved.graph ? saved : this._presetData('downtown'), { recordUndo: false, silent: true });
    // First impression: start from the best brain on hand (saved, else pretrained), so the cars
    // drive as soon as the page opens. Random brains mostly crash at the start line, which reads as
    // "broken" to a first-time visitor. Reset still starts over from random brains.
    const startBrain = this._savedBrain() || this._pretrained();
    this.sim = this._createSimulation(startBrain);
    this.seeded = !!startBrain;

    this._bindUI();
    this._bindInput();
    this.setMode('train');
    this.viewport.scale = 0.8;
    if (this.world.start) this.viewport.center = { x: this.world.start.x, y: this.world.start.y };
    requestAnimationFrame((t) => this._frame(t));
  }

  // =============================================================== world

  _presetData(id) {
    const data = Presets.get(id).build();
    data.presetId = id;
    return data;
  }

  loadWorldData(data, { keepCamera = false, recordUndo = true, silent = false } = {}) {
    if (recordUndo && this.world) this.editor.snapshot();
    const world = World.fromJSON(data);
    world.generate();
    this.world = world;
    this.worldName = data.name || 'Custom world';
    this.presetId = data.presetId || null;
    this.editor.selected = this.editor.hovered = this.editor.hoveredSegment = null;
    if (!keepCamera) this.frameWorld();
    this._syncRoadWidth?.();
    this._afterWorldChange();
    if (!silent) this.toast(`Loaded “${this.worldName}”`);
  }

  /** Called by the editor. `final` = commit (mouse up / click); otherwise a live drag. */
  onWorldEdited(final) {
    this.presetId = null;
    this._fastRegen = true;
    if (!final) return;
    clearTimeout(this._regenTimer);
    this._regenTimer = setTimeout(() => {
      this._fastRegen = false;
      this.world.generate();
      this._afterWorldChange();
    }, 350);
  }

  _afterWorldChange() {
    AppStorage.save('world', { ...this.world.toJSON(this.worldName), presetId: this.presetId });
    this._updateWorldStats?.();
    if (this.mode === 'train' || this.mode === 'drive') this._syncSimWorld();
    if (this.mode === 'drive') this._startDrive();
  }

  /** Makes sure the world is fully generated and the simulation runs on its latest version. */
  _syncSimWorld() {
    if (this._fastRegen || !this.world.detailed) {
      clearTimeout(this._regenTimer);
      this._fastRegen = false;
      this.world.generate();
    }
    if (this.sim && (this.sim.world !== this.world || this.simWorldVersion !== this.world.version)) {
      this.sim.setWorld(this.world);
      this.simWorldVersion = this.world.version;
    }
  }

  frameWorld() {
    this.viewport.fit(this.world.bounds, 60);
  }

  // ========================================================== simulation

  _simSettings() {
    const s = this.settings;
    return {
      population: s.population,
      trafficCount: s.trafficCount,
      generationTime: s.generationTime,
      mutationRate: s.mutationRate,
      mutationStrength: s.mutationStrength,
      varyTraffic: s.varyTraffic,
    };
  }

  _createSimulation(seedBrain = null) {
    const sim = new Simulation(this.world, this._simSettings(), seedBrain);
    sim.onGeneration = (s) => this._onGeneration(s);
    this.simWorldVersion = this.world.version;
    this.focus = this.pinnedFocus = null;
    this.chart?.draw([]);
    return sim;
  }

  _onGeneration(summary) {
    this.chart.draw(this.sim.evolution.history);
    this.pinnedFocus = null;
    if (summary.coverage >= 0.98 && !this._announcedFull) {
      this._announcedFull = true;
      this.toast(`Generation ${summary.generation}: a car covered the entire road network`);
    }
  }

  _pretrained() {
    if (typeof PRETRAINED_BRAINS === 'undefined') return null;
    const entry = PRETRAINED_BRAINS[this.presetId] || PRETRAINED_BRAINS.downtown || Object.values(PRETRAINED_BRAINS)[0];
    try {
      return entry ? NeuralNetwork.fromJSON(entry.brain, Car.brainLayout()) : null;
    } catch {
      return null;
    }
  }

  _savedBrain() {
    const json = AppStorage.load('brain');
    try {
      return json ? NeuralNetwork.fromJSON(json, Car.brainLayout()) : null;
    } catch {
      return null;
    }
  }

  /** Best driver available for the test drive's autopilot. */
  _bestAvailableBrain() {
    const b = this.sim.evolution.bestEver || this._savedBrain() || this._pretrained();
    return b ? b.clone() : null;
  }

  seedPopulation(brain, label) {
    this._syncSimWorld();
    this.sim.seed(brain);
    this.seeded = true;
    this.pinnedFocus = this.focus = null;
    this.running = true;
    this._syncRunButton();
    this.toast(`Population seeded from ${label}`);
  }

  // =============================================================== drive

  _startDrive() {
    const s = this.world.start;
    if (!s) {
      this.drive = null;
      return;
    }
    const car = new Car(s.x, s.y, s.angle, { brain: this._bestAvailableBrain(), autopilot: false });
    const traffic = TrafficCar.spawn(this.world, this.settings.driveTraffic, (Math.random() * 1e9) | 0, s);
    this.drive = {
      car,
      traffic,
      obstacles: [...traffic, car],
      env: { borderGrid: this.world.borderGrid, traffic, buf: [], input: this.driveInput },
    };
    this._syncAutopilotButton();
  }

  toggleAutopilot(force) {
    const d = this.drive;
    if (!d) return;
    if (!d.car.brain) d.car.brain = this._bestAvailableBrain();
    if (!d.car.brain) return this.toast('Train a network first — no brain available yet', true);
    const next = force ?? !d.car.autopilot;
    if (next === d.car.autopilot) return;
    d.car.autopilot = next;
    this._syncAutopilotButton();
    this.toast(next ? 'Autopilot engaged' : 'Autopilot disengaged — you have control');
  }

  _stepDrive(dt) {
    const d = this.drive;
    const k = this.keys;
    const t = this.touchInput;
    this.driveInput.up = !!(k.KeyW || k.ArrowUp || t.up);
    this.driveInput.down = !!(k.KeyS || k.ArrowDown || t.down);
    this.driveInput.left = !!(k.KeyA || k.ArrowLeft || t.left);
    this.driveInput.right = !!(k.KeyD || k.ArrowRight || t.right);
    for (const t of d.traffic) t.update(dt, d.obstacles);
    const wasAlive = d.car.alive;
    d.car.update(dt, d.env);
    if (wasAlive && !d.car.alive) {
      this.toast('Collision detected — press R to respawn', true);
      this._syncAutopilotButton();
    }
  }

  // ================================================================ modes

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    document.body.dataset.mode = mode;
    $$('.mode').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    this.focus = this.pinnedFocus = null;
    this.path = null;
    if (mode === 'build') {
      this.drive = null;
    } else {
      this._syncSimWorld();
      if (!this.world.start) this.toast('Build a road network first', true);
      if (mode === 'drive') {
        this._startDrive();
        if (this.isTouch && this.world.start) this.toast('Hold GAS to drive · tap AUTOPILOT to let the AI drive');
      }
    }
    document.body.classList.remove('panel-open');
    this._updateHint(true);
  }

  // ================================================================ loop

  _frame(ts) {
    const dt = Math.min(0.05, (ts - (this._last ?? ts)) / 1000);
    this._last = ts;
    this.frameCount++;

    if (this._fastRegen && this.mode === 'build') {
      this._fastRegen = false;
      this.world.generate({ detail: false });
    }

    if (this.mode === 'train' && this.running && this.sim.ready) {
      this.accumulator += dt * this.simSpeed;
      const t0 = performance.now();
      while (this.accumulator >= FIXED_DT) {
        this.sim.step(FIXED_DT);
        this.accumulator -= FIXED_DT;
        if (performance.now() - t0 > 14) {
          this.accumulator = 0; // CPU budget exhausted: drop time rather than spiral
          break;
        }
      }
    } else if (this.mode === 'drive' && this.drive) {
      this.accumulator += dt;
      while (this.accumulator >= FIXED_DT) {
        this._stepDrive(FIXED_DT);
        this.accumulator -= FIXED_DT;
      }
    }

    this._updateFocus(dt);
    this._render();
    this._updatePanels(ts);
    requestAnimationFrame((t) => this._frame(t));
  }

  _updateFocus(dt) {
    if (this.mode === 'train') {
      const gen = this.sim.evolution.generation;
      if (this._focusGen !== gen) {
        this._focusGen = gen;
        this.focus = this.pinnedFocus = null;
      }
      if (this.pinnedFocus?.alive) {
        this.focus = this.pinnedFocus;
      } else {
        this.pinnedFocus = null;
        const leader = this.sim.leader();
        // hysteresis: only switch when the challenger is clearly ahead
        if (!this.focus || !this.focus.alive || (leader && leader.fitness > this.focus.fitness + 2)) this.focus = leader;
      }
    } else if (this.mode === 'drive') {
      this.focus = this.drive?.car || null;
    } else {
      this.focus = null;
    }

    const f = this.focus;
    // Drive mode always tracks your own car, pausing only while a finger or mouse is actively panning or
    // pinching: on phones a thumb slipping off the pedals onto the map would otherwise switch follow off for good.
    const follow = this.mode === 'drive' ? !(this._pan?.moved || this._pinch) : this.settings.followCam;
    if (f && follow && this.mode !== 'build') {
      const lead = 0.35;
      this.viewport.follow(f.x + Math.cos(f.angle) * f.speed * lead, f.y + Math.sin(f.angle) * f.speed * lead, dt, 3.5);
    }
  }

  // ============================================================== render

  _render() {
    const ctx = this.ctx, vp = this.viewport;
    vp.applyScreen(ctx);
    ctx.fillStyle = THEME.ground;
    ctx.fillRect(0, 0, vp.width, vp.height);

    vp.apply(ctx);
    const view = vp.visibleBounds();
    this._drawGrid(ctx, view);
    this.world.drawRoads(ctx);

    if (this.mode === 'build') {
      this.world.drawItems(ctx, vp.center, view);
      this.editor.draw(ctx, vp.scale);
    } else {
      const traffic = this.mode === 'train' ? this.sim.traffic : this.drive?.traffic || [];
      const inView = (o) => o.x > view.minX - 60 && o.x < view.maxX + 60 && o.y > view.minY - 60 && o.y < view.maxY + 60;
      for (const t of traffic) if (inView(t)) t.draw(ctx);

      if (this.mode === 'train' && this.settings.showPopulation) {
        const now = this.sim.time;
        for (const c of this.sim.cars) {
          if (c === this.focus || !inView(c)) continue;
          if (c.alive) c.draw(ctx, 'population');
          else if (now - c.deathTime < 1.5) c.draw(ctx, 'crashed');
        }
      }

      const f = this.focus;
      if (f) {
        const piloted = f.brain && f.autopilot && f.alive;
        if (piloted && (this.mode === 'drive' || this.settings.showPath)) this._drawPlannedPath(ctx, f);
        const sensors = this.mode === 'train' ? this.settings.showSensors : this.settings.driveSensors;
        if (sensors && f.sensor && f.alive) f.sensor.draw(ctx, f);
        f.draw(ctx, 'hero');
        if (!f.alive) f.draw(ctx, 'crashed');
      }
      this.world.drawItems(ctx, vp.center, view);
      // The start marker is only drawn in Build mode (by the editor): painted over the cars in Train and
      // Drive, it looked like a frozen car at the start line.
    }

    const minimapData = this.mode === 'train'
      ? { cars: this.settings.showPopulation ? this.sim.cars : [], traffic: this.sim.traffic, focus: this.focus }
      : this.mode === 'drive'
        ? { traffic: this.drive?.traffic || [], focus: this.focus }
        : {};
    this.minimap.draw(this.world, vp, minimapData);
  }

  _drawGrid(ctx, view) {
    if (this.viewport.scale < 0.2) return;
    const step = 100;
    ctx.strokeStyle = THEME.groundGrid;
    ctx.lineWidth = 1 / this.viewport.scale;
    ctx.beginPath();
    for (let x = Math.floor(view.minX / step) * step; x <= view.maxX; x += step) {
      ctx.moveTo(x, view.minY);
      ctx.lineTo(x, view.maxY);
    }
    for (let y = Math.floor(view.minY / step) * step; y <= view.maxY; y += step) {
      ctx.moveTo(view.minX, y);
      ctx.lineTo(view.maxX, y);
    }
    ctx.stroke();
  }

  _drawPlannedPath(ctx, car) {
    const stale = this.path && Math.hypot(this.path.pts[0] - car.x, this.path.pts[1] - car.y) > 6;
    if (!this.path || this.path.car !== car || stale || this.frameCount % 3 === 0) {
      const env = this.mode === 'train' ? this.sim.env : this.drive.env;
      this.path = { car, pts: car.predictPath(env) };
    }
    const pts = this.path.pts;
    if (pts.length < 4) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    };
    ctx.strokeStyle = 'rgba(61,139,253,0.22)';
    ctx.lineWidth = car.width * 1.1;
    trace();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(130,185,255,0.75)';
    ctx.lineWidth = 2;
    trace();
    ctx.stroke();
  }

  // ============================================================== panels

  _updatePanels(ts) {
    // fps
    this.fps.frames++;
    if (ts - this.fps.since > 500) {
      $('#fpsPill').textContent = `${Math.round((this.fps.frames * 1000) / (ts - this.fps.since))} fps`;
      this.fps = { frames: 0, since: ts };
    }
    if (this.mode === 'build') {
      if (this.frameCount % 15 === 0) this._updateHint();
      return;
    }

    const f = this.focus;
    this._drawNetwork(f);
    if (this.frameCount % 3 !== 0) return;

    // HUD
    $('#hudSpeed').textContent = f ? Math.round(Math.abs(f.speed) * 0.36) : 0;
    $('#hudWheel').style.transform = `rotate(${(f ? f.steer : 0) * 110}deg)`;
    $('#hudThr').style.width = `${f ? Math.max(0, f.throttle) * 100 : 0}%`;
    $('#hudBrk').style.width = `${f ? Math.max(0, -f.throttle) * 100 : 0}%`;
    const badge = $('#hudBadge');
    let text = 'MANUAL', cls = '';
    if (!f) text = '—';
    else if (!f.alive) { text = f.status === 'stalled' ? 'STALLED' : 'COLLISION'; cls = 'crash'; }
    else if (this.mode === 'train') { text = f === this.pinnedFocus ? `AI #${f.id}` : 'LEADER'; cls = 'on'; }
    else if (f.autopilot) { text = 'AUTOPILOT'; cls = 'on'; }
    badge.textContent = text;
    badge.className = `hud-badge ${cls}`;
    $('#hudGen').textContent = this.mode === 'train' ? `GEN ${this.sim.evolution.generation} · ${this.sim.alive}/${this.sim.cars.length}` : '';

    if (this.mode === 'train') {
      const sim = this.sim, evo = sim.evolution;
      $('#stGen').textContent = evo.generation;
      $('#stAlive').textContent = `${sim.alive} / ${sim.cars.length}`;
      $('#stLeader').textContent = f ? f.fitness.toFixed(1) : '—';
      $('#stBest').textContent = evo.bestEver ? evo.bestEverFitness.toFixed(1) : '—';
      $('#stCoverage').textContent = f && this.world.checkpoints.length ? `${Math.round((f.checkpoints / this.world.checkpoints.length) * 100)}%` : '—';
      $('#stClock').textContent = `${sim.time.toFixed(0)} / ${sim.settings.generationTime}s`;
      $('#genProgress').style.width = `${Math.min(100, (sim.time / sim.settings.generationTime) * 100)}%`;
    }
    if (this.frameCount % 15 === 0) this._updateHint();
  }

  _drawNetwork(car) {
    const canvas = $('#netCanvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w) return;
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const brain = car?.brain || null;
    NetworkView.draw(ctx, w, h, brain, car?.inputs);
    const meta = brain ? `${brain.sizes.join('·')} · ${brain.parameterCount} params` : '';
    if (this._netMeta !== meta) $('#netMeta').textContent = this._netMeta = meta;
  }

  _updateHint(force) {
    let hint = '';
    if (this.mode === 'build') {
      hint = {
        start: 'Click a lane to set where cars spawn — the arrow follows the lane direction',
        erase: 'Click a node or road to delete it',
        road: 'Click to lay roads · click a road to add a junction · right-click deletes · press 2 to train',
      }[this.editor.tool];
    } else if (!this.world.start) {
      hint = 'No roads yet — press 1 to open the builder';
    } else if (this.mode === 'train') {
      hint = !this.settings.followCam
        ? 'Press F to follow the leader again'
        : this.sim.evolution.generation <= 2 && !this.sim.evolution.bestEver && !this.seeded
          ? 'Generation 1 is random brains — watch them improve, or load the pretrained brain'
          : this.seeded && this.sim.evolution.generation <= 2
            ? 'Started from the trained brain · press Reset to watch them learn from scratch'
            : 'Click any car to follow it · drag to look around · scroll to zoom';
    } else {
      hint = this.drive?.car.autopilot ? 'Autopilot engaged — press any driving key (W A S D / arrows) to take over' : 'Drive with W A S D / arrows · press P to engage autopilot';
    }
    const el = $('#hint');
    if (force || el.textContent !== hint) el.textContent = hint;
  }

  _updateWorldStats() {
    const w = this.world;
    $('#worldStats').innerHTML = [
      ['Nodes', w.graph.points.length],
      ['Roads', w.graph.segments.length],
      ['Blocks', w.buildings.length],
      ['Trees', w.trees.length],
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  }

  toast(message, isError = false) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.toggle('error', isError);
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ================================================================== UI

  _saveSettings() {
    AppStorage.save('settings', this.settings);
  }

  _setFollow(on) {
    this.settings.followCam = on;
    $('#followCam').checked = on;
    this._saveSettings();
    this._updateHint();
  }

  _syncRunButton() {
    $('#runLabel').textContent = this.running ? 'Pause' : 'Resume';
  }

  _syncAutopilotButton() {
    const on = !!this.drive?.car.autopilot;
    const btn = $('#autopilotBtn');
    btn.classList.toggle('engaged', on);
    btn.firstChild.textContent = on ? 'Disengage autopilot ' : 'Engage autopilot ';
    $('#tdAutopilot').classList.toggle('engaged', on);
  }

  setSpeed(speed) {
    this.simSpeed = speed;
    $$('#speedSeg button').forEach((b) => b.classList.toggle('active', +b.dataset.speed === speed));
  }

  _bindRange(id, key, format, onChange) {
    const el = $(`#${id}`), out = $(`#${id}Out`);
    const paint = () => {
      out.textContent = format(+el.value);
      el.style.setProperty('--fill', `${((el.value - el.min) / (el.max - el.min)) * 100}%`);
    };
    el.value = this.settings[key];
    paint();
    el.addEventListener('input', () => {
      this.settings[key] = +el.value;
      paint();
      onChange?.(+el.value);
      this._saveSettings();
    });
  }

  _bindCheck(id, key, onChange) {
    const el = $(`#${id}`);
    el.checked = !!this.settings[key];
    el.addEventListener('change', () => {
      this.settings[key] = el.checked;
      onChange?.(el.checked);
      this._saveSettings();
    });
  }

  _bindUI() {
    $$('.mode').forEach((b) => b.addEventListener('click', () => this.setMode(b.dataset.mode)));

    // ---- build
    $$('#toolSeg button').forEach((b) => b.addEventListener('click', () => this.setTool(b.dataset.tool)));
    const select = $('#presetSelect');
    select.innerHTML = Presets.list.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
    if (this.presetId) select.value = this.presetId;
    $('#loadPresetBtn').addEventListener('click', () => this.loadWorldData(this._presetData(select.value)));

    const rw = $('#roadWidth');
    this._syncRoadWidth = () => {
      rw.value = this.world.options.roadWidth;
      $('#roadWidthOut').textContent = `${rw.value} px`;
      rw.style.setProperty('--fill', `${((rw.value - rw.min) / (rw.max - rw.min)) * 100}%`);
    };
    this._syncRoadWidth();
    rw.addEventListener('input', () => {
      this.world.options.roadWidth = +rw.value;
      this._syncRoadWidth();
      this.onWorldEdited(true);
    });

    $('#undoBtn').addEventListener('click', () => this.editor.undo() || this.toast('Nothing to undo'));
    $('#clearBtn').addEventListener('click', () => {
      this.editor.snapshot();
      this.world.graph.clear();
      this.world.start = null;
      this.editor.selected = null;
      this.onWorldEdited(true);
      this.toast('World cleared — Ctrl+Z to undo');
    });
    $('#exportWorldBtn').addEventListener('click', () => AppStorage.download('neurodrive-world.json', this.world.toJSON(this.worldName)));
    $('#importWorldBtn').addEventListener('click', () =>
      AppStorage.pick($('#fileInput'))
        .then((data) => {
          if (!data.graph || !Array.isArray(data.graph.points)) throw new Error('Not a NeuroDrive world file');
          this.loadWorldData(data);
        })
        .catch((e) => this.toast(e.message, true)),
    );
    this._updateWorldStats();

    // ---- train
    $('#runBtn').addEventListener('click', () => this.toggleRun());
    $('#nextGenBtn').addEventListener('click', () => this.sim.endGeneration());
    $('#resetBtn').addEventListener('click', () => {
      this._syncSimWorld();
      this.sim = this._createSimulation();
      this._announcedFull = false;
      this.seeded = false;
      this.toast('Population reset to random brains');
    });
    $$('#speedSeg button').forEach((b) => b.addEventListener('click', () => this.setSpeed(+b.dataset.speed)));

    const applySim = () => this.sim.applySettings(this._simSettings());
    this._bindRange('population', 'population', (v) => v, applySim);
    this._bindRange('traffic', 'trafficCount', (v) => v, applySim);
    this._bindRange('genTime', 'generationTime', (v) => `${v}s`, applySim);
    this._bindRange('mutRate', 'mutationRate', (v) => `${Math.round(v * 100)}%`, applySim);
    this._bindRange('mutStrength', 'mutationStrength', (v) => v.toFixed(2), applySim);
    this._bindCheck('varyTraffic', 'varyTraffic', applySim);
    this._bindCheck('showPopulation', 'showPopulation');
    this._bindCheck('showSensors', 'showSensors');
    this._bindCheck('showPath', 'showPath');
    this._bindCheck('followCam', 'followCam', () => this._updateHint());

    $('#saveBrainBtn').addEventListener('click', () => {
      const b = this.sim.bestBrain();
      if (!b) return this.toast('No brain to save yet', true);
      AppStorage.save('brain', b.toJSON());
      this.toast('Best brain saved to this browser');
    });
    $('#loadBrainBtn').addEventListener('click', () => {
      const b = this._savedBrain();
      if (!b) return this.toast('No saved brain yet — use “Save best” first', true);
      this.seedPopulation(b, 'the saved brain');
    });
    $('#exportBrainBtn').addEventListener('click', () => {
      const b = this.sim.bestBrain();
      if (!b) return this.toast('No brain to export yet', true);
      AppStorage.download(`neurodrive-brain-gen${this.sim.evolution.bestEverGeneration || 1}.json`, b.toJSON());
    });
    $('#importBrainBtn').addEventListener('click', () =>
      AppStorage.pick($('#fileInput'))
        .then((json) => this.seedPopulation(NeuralNetwork.fromJSON(json, Car.brainLayout()), 'the imported brain'))
        .catch((e) => this.toast(e.message, true)),
    );
    $('#pretrainedBtn').addEventListener('click', () => {
      const b = this._pretrained();
      if (!b) return this.toast('No pretrained brain bundled — run: node tools/train.js', true);
      this.seedPopulation(b, 'the pretrained brain');
    });

    // ---- drive
    $('#autopilotBtn').addEventListener('click', () => this.toggleAutopilot());
    $('#respawnBtn').addEventListener('click', () => this._startDrive());
    this._bindRange('driveTraffic', 'driveTraffic', (v) => v, () => this._startDrive());
    this._bindCheck('driveSensors', 'driveSensors');

    // ---- touch driving controls (multi-touch: each button tracks its own pointer)
    $$('[data-touch]').forEach((btn) => {
      const key = btn.dataset.touch;
      const release = () => {
        this.touchInput[key] = false;
        btn.classList.remove('pressed');
      };
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.touchInput[key] = true;
        btn.classList.add('pressed');
        if (this.drive?.car.autopilot) this.toggleAutopilot(false);
        try {
          btn.setPointerCapture(e.pointerId); // keeps the press alive if the finger slides off
        } catch { /* pointer already gone */ }
        if (navigator.vibrate) navigator.vibrate(8);
      });
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });
    $('#tdAutopilot').addEventListener('click', () => this.toggleAutopilot());
    $('#tdRespawn').addEventListener('click', () => this._startDrive());
    $('#panelToggle').addEventListener('click', () => document.body.classList.toggle('panel-open'));

    // ---- chrome
    $('#helpBtn').addEventListener('click', () => this.toggleHelp());
    $('#helpClose').addEventListener('click', () => this.toggleHelp(false));
    $('#helpModal').addEventListener('click', (e) => e.target.id === 'helpModal' && this.toggleHelp(false));
    this.setSpeed(1);
    this._syncRunButton();
  }

  setTool(tool) {
    this.editor.tool = tool;
    this.editor.selected = null;
    $$('#toolSeg button').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
    this._updateHint(true);
  }

  toggleRun() {
    this.running = !this.running;
    this.accumulator = 0;
    this._syncRunButton();
  }

  toggleHelp(force) {
    const modal = $('#helpModal');
    modal.hidden = force === undefined ? !modal.hidden : !force;
  }

  // =============================================================== input

  _worldPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return this.viewport.screenToWorld(e.clientX - r.left, e.clientY - r.top);
  }

  _bindInput() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    // Active pointers, for two-finger pinch-zoom / pan on touch screens.
    this._pointers = new Map();
    const pinchState = () => {
      const [a, b] = [...this._pointers.values()];
      return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
    };

    c.addEventListener('pointerdown', (e) => {
      try {
        c.setPointerCapture(e.pointerId);
      } catch { /* pointer already gone */ }
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const touch = e.pointerType === 'touch';
      this.editor.touch = touch;

      if (this._pointers.size === 2) {
        // second finger: abandon any one-finger action and start pinching
        if (this.editor.dragging) this.editor.pointerUp();
        this._pan = null;
        this._pinch = pinchState();
        return;
      }
      if (this._pointers.size > 2) return;

      const pan = e.button === 1 || (e.button === 0 && (this.keys.Space || this.mode !== 'build'));
      if (pan) {
        e.preventDefault();
        this._pan = { x: e.clientX, y: e.clientY, moved: false, click: e.button === 0 && this.mode !== 'build' };
        return;
      }
      if (this.mode !== 'build') return;

      const p = this._worldPos(e);
      if (touch && e.button === 0) {
        // On touch, a finger on a node grabs it immediately (drag to move); anywhere else
        // it's a tap (edit on release) or a one-finger pan if it moves.
        this.editor._updateHover(p);
        if (!this.editor.hovered || this.editor.tool !== 'road') {
          this._pan = { x: e.clientX, y: e.clientY, moved: false, click: false, tap: p };
          return;
        }
      }
      this.editor.pointerDown(e.button, p);
    });

    c.addEventListener('pointermove', (e) => {
      if (this._pointers.has(e.pointerId)) this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pinch) {
        if (this._pointers.size < 2) return;
        const next = pinchState(), r = c.getBoundingClientRect();
        this.viewport.zoomAt(next.mx - r.left, next.my - r.top, next.dist / this._pinch.dist);
        this.viewport.panBy(next.mx - this._pinch.mx, next.my - this._pinch.my);
        this._pinch = next;
        return;
      }
      if (this._pan) {
        const dx = e.clientX - this._pan.x, dy = e.clientY - this._pan.y;
        if (!this._pan.moved && Math.hypot(dx, dy) > (e.pointerType === 'touch' ? 10 : 4)) {
          this._pan.moved = true;
          c.classList.add('panning');
          if (this.mode === 'train' && this.settings.followCam) this._setFollow(false);
        }
        if (this._pan.moved) {
          this.viewport.panBy(dx, dy);
          this._pan.x = e.clientX;
          this._pan.y = e.clientY;
        }
        return;
      }
      if (this.mode === 'build') this.editor.pointerMove(this._worldPos(e));
    });

    const up = (e) => {
      this._pointers.delete(e.pointerId);
      if (this._pinch) {
        if (this._pointers.size < 2) this._pinch = null;
        return; // lifting fingers after a pinch never counts as a tap
      }
      if (this._pan) {
        if (!this._pan.moved && this._pan.click) this._pickCar(this._worldPos(e));
        if (!this._pan.moved && this._pan.tap && e.type === 'pointerup') {
          this.editor.pointerDown(0, this._pan.tap);
          this.editor.pointerUp();
        }
        this._pan = null;
        c.classList.remove('panning');
        return;
      }
      if (this.mode === 'build') this.editor.pointerUp();
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      this.viewport.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });

    window.addEventListener('resize', () => {
      this.viewport.resize();
      this.chart.draw(this.sim.evolution.history);
    });
    window.addEventListener('blur', () => (this.keys = {}));
    window.addEventListener('keydown', (e) => this._onKeyDown(e));
    window.addEventListener('keyup', (e) => (this.keys[e.code] = false));
  }

  _pickCar(p) {
    if (this.mode !== 'train') return;
    let best = null, bestD = 40;
    for (const car of this.sim.cars) {
      if (!car.alive) continue;
      const d = Math.hypot(car.x - p.x, car.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = car;
      }
    }
    if (best) {
      this.pinnedFocus = this.focus = best;
      this._setFollow(true);
    }
  }

  _onKeyDown(e) {
    const tag = e.target.tagName;
    if ((tag === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const code = e.code;
    this.keys[code] = true;
    const ctrl = e.ctrlKey || e.metaKey;

    if (code === 'Digit1') return this.setMode('build');
    if (code === 'Digit2') return this.setMode('train');
    if (code === 'Digit3') return this.setMode('drive');
    if (code === 'KeyH') return this.toggleHelp();
    if (code === 'Escape' && !$('#helpModal').hidden) return this.toggleHelp(false);
    if (code === 'KeyV' && !ctrl) {
      if (this.mode !== 'build') this._setFollow(false);
      return this.frameWorld();
    }

    if (this.mode === 'build') {
      if (code === 'Space') e.preventDefault();
      if (ctrl && code === 'KeyZ') {
        e.preventDefault();
        if (!this.editor.undo()) this.toast('Nothing to undo');
      } else if (code === 'KeyR' && !ctrl) this.setTool('road');
      else if (code === 'KeyS' && !ctrl) this.setTool('start');
      else if (code === 'KeyE' && !ctrl) this.setTool('erase');
      else if (code === 'Escape') this.editor.selected = null;
      else if (code === 'Delete' || code === 'Backspace') this.editor.deleteSelected();
      return;
    }

    if (code === 'KeyF') return this._setFollow(!this.settings.followCam);

    if (this.mode === 'train') {
      if (code === 'Space') {
        e.preventDefault();
        if (!e.repeat) this.toggleRun();
      } else if (code === 'KeyN') this.sim.endGeneration();
      else if (code === 'Equal' || code === 'NumpadAdd') this.setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(this.simSpeed) + 1)]);
      else if (code === 'Minus' || code === 'NumpadSubtract') this.setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(this.simSpeed) - 1)]);
      return;
    }

    if (this.mode === 'drive') {
      if (code.startsWith('Arrow') || code === 'Space') e.preventDefault();
      if (code === 'KeyP' && !e.repeat) this.toggleAutopilot();
      else if (code === 'KeyR' && !e.repeat) this._startDrive();
      else if (this.drive?.car.autopilot && ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown', 'KeyW', 'KeyA', 'KeyD', 'KeyS'].includes(code)) {
        this.toggleAutopilot(false);
      }
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
