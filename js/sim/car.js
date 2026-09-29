'use strict';

/**
 * Vehicle with a kinematic bicycle model:
 *   yaw rate = v / wheelbase · tan(δ), capped by a lateral-grip limit
 * Controls are continuous (throttle, steering ∈ [-1, 1]) and come either from
 * the keyboard or from the car's neural network.
 */
class Car {
  static PHYSICS = {
    length: 40,
    width: 20,
    maxSpeed: 260, // px/s  (HUD shows px/s × 0.36 as km/h)
    maxReverse: 60,
    acceleration: 300,
    braking: 520,
    friction: 80,
    maxSteerAngle: 0.6, // rad
    maxLateralAccel: 900, // px/s² – grip limit
  };

  /** Network topology: rays + speed in, throttle + steering out. */
  static brainLayout() {
    return [Sensor.DEFAULTS.rayCount + 1, 12, 8, 2];
  }

  constructor(x, y, angle, { brain = null, autopilot = !!brain, sensor = true } = {}) {
    Object.assign(this, Car.PHYSICS);
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.speed = 0;
    this.throttle = 0;
    this.steer = 0;
    this.brain = brain;
    this.autopilot = autopilot;
    this.sensor = sensor ? new Sensor() : null;
    this.inputs = new Float32Array(Sensor.DEFAULTS.rayCount + 1);
    this.poly = new Float64Array(8);
    this.alive = true;
    this.status = 'driving';
    this.distance = 0;
    this.fitness = 0;
    this.updatePolygon();
  }

  update(dt, env) {
    if (!this.alive) return;
    const R = (this.sensor ? this.sensor.rayLength : 0) + this.length;
    const borders = env.borderGrid ? env.borderGrid.query(this.x - R, this.y - R, this.x + R, this.y + R, env.buf) : [];

    if (this.sensor) {
      this.sensor.update(this, borders, env.traffic);
      this.inputs.set(this.sensor.readings);
      this.inputs[this.inputs.length - 1] = this.speed / this.maxSpeed;
    }

    if (this.autopilot && this.brain) {
      const out = this.brain.forward(this.inputs);
      this.throttle = out[0];
      this.steer = out[1];
    } else if (env.input) {
      const k = env.input;
      this.throttle = (k.up ? 1 : 0) - (k.down ? 1 : 0);
      const target = (k.right ? 1 : 0) - (k.left ? 1 : 0);
      this.steer = MathUtil.approach(this.steer, target, dt * 4);
    }

    this._integrate(dt);
    this.updatePolygon();
    if (this._collides(borders, env.traffic)) {
      this.alive = false;
      this.status = 'crashed';
      this.speed = 0;
    }
  }

  _integrate(dt) {
    let acc;
    if (this.throttle >= 0) acc = this.throttle * this.acceleration;
    else acc = this.speed > 0 ? this.throttle * this.braking : this.throttle * this.acceleration * 0.5;
    this.speed += acc * dt;

    const f = this.friction * dt;
    this.speed = Math.abs(this.speed) <= f ? 0 : this.speed - Math.sign(this.speed) * f;
    this.speed = MathUtil.clamp(this.speed, -this.maxReverse, this.maxSpeed);

    const wheelbase = this.length * 0.65;
    let yawRate = (this.speed / wheelbase) * Math.tan(this.steer * this.maxSteerAngle);
    const gripLimit = this.maxLateralAccel / Math.max(Math.abs(this.speed), 1);
    yawRate = MathUtil.clamp(yawRate, -gripLimit, gripLimit);

    this.angle += yawRate * dt;
    this.x += Math.cos(this.angle) * this.speed * dt;
    this.y += Math.sin(this.angle) * this.speed * dt;
    this.distance += Math.abs(this.speed) * dt;
  }

  updatePolygon() {
    writeBoxCorners(this.poly, this.x, this.y, this.angle, this.length, this.width);
  }

  _collides(borders, traffic) {
    const p = this.poly;
    for (let e = 0; e < 4; e++) {
      const f = (e + 1) & 3;
      const ax = p[e * 2], ay = p[e * 2 + 1], bx = p[f * 2], by = p[f * 2 + 1];
      for (let k = 0; k < borders.length; k++) {
        const s = borders[k];
        if (MathUtil.segmentIntersectT(ax, ay, bx, by, s.ax, s.ay, s.bx, s.by) >= 0) return true;
      }
      for (let k = 0; k < traffic.length; k++) {
        const o = traffic[k];
        if (Math.abs(o.x - this.x) > 50 || Math.abs(o.y - this.y) > 50) continue;
        const q = o.poly;
        for (let g = 0; g < 4; g++) {
          const h = (g + 1) & 3;
          if (MathUtil.segmentIntersectT(ax, ay, bx, by, q[g * 2], q[g * 2 + 1], q[h * 2], q[h * 2 + 1]) >= 0) return true;
        }
      }
    }
    return false;
  }

  /** Rolls a ghost copy forward with the same brain to preview the planned trajectory. */
  predictPath(env, steps = 36, dt = 1 / 18) {
    const ghost = new Car(this.x, this.y, this.angle, { brain: this.brain, autopilot: true });
    ghost.speed = this.speed;
    const pts = [this.x, this.y];
    for (let i = 0; i < steps; i++) {
      ghost.update(dt, env);
      if (!ghost.alive) break;
      pts.push(ghost.x, ghost.y);
    }
    return pts;
  }

  // ----------------------------------------------------------------- render

  draw(ctx, style = 'population') {
    const L = this.length, W = this.width;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    if (style === 'population') {
      ctx.fillStyle = THEME.population;
      roundRect(ctx, -L / 2, -W / 2, L, W, 5);
      ctx.fill();
    } else if (style === 'crashed') {
      ctx.fillStyle = THEME.crashed;
      roundRect(ctx, -L / 2, -W / 2, L, W, 5);
      ctx.fill();
    } else {
      Car.drawBody(ctx, L, W, style === 'hero' ? null : this.color, style === 'hero' ? this.throttle < -0.1 : false);
    }
    ctx.restore();
  }

  /** Detailed body shared by the hero car and traffic. Assumes a car-local transform. */
  static drawBody(ctx, L, W, color, braking) {
    const hero = !color;
    if (hero) {
      // headlight beams
      const beam = ctx.createLinearGradient(L / 2, 0, L / 2 + 110, 0);
      beam.addColorStop(0, 'rgba(190,220,255,0.22)');
      beam.addColorStop(1, 'rgba(190,220,255,0)');
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(L / 2, -W / 2 + 2);
      ctx.lineTo(L / 2 + 110, -W * 1.6);
      ctx.lineTo(L / 2 + 110, W * 1.6);
      ctx.lineTo(L / 2, W / 2 - 2);
      ctx.closePath();
      ctx.fill();
      ctx.shadowColor = THEME.accent;
      ctx.shadowBlur = 22;
    }
    const body = ctx.createLinearGradient(0, -W / 2, 0, W / 2);
    body.addColorStop(0, hero ? '#ffffff' : color);
    body.addColorStop(1, hero ? '#c9d2de' : shadeHex(color, -0.25));
    ctx.fillStyle = body;
    roundRect(ctx, -L / 2, -W / 2, L, W, 6);
    ctx.fill();
    ctx.shadowBlur = 0;

    // glasshouse
    ctx.fillStyle = hero ? '#1d2735' : 'rgba(20,24,30,0.85)';
    ctx.beginPath();
    ctx.moveTo(L * 0.2, -W / 2 + 3);
    ctx.lineTo(L * 0.05, -W / 2 + 3.5);
    ctx.lineTo(-L * 0.28, -W / 2 + 3.5);
    ctx.lineTo(-L * 0.36, -W / 2 + 4);
    ctx.lineTo(-L * 0.36, W / 2 - 4);
    ctx.lineTo(-L * 0.28, W / 2 - 3.5);
    ctx.lineTo(L * 0.05, W / 2 - 3.5);
    ctx.lineTo(L * 0.2, W / 2 - 3);
    ctx.closePath();
    ctx.fill();
    // roof panel
    ctx.fillStyle = hero ? '#e9eef5' : shadeHex(color, 0.08);
    roundRect(ctx, -L * 0.24, -W / 2 + 4.5, L * 0.3, W - 9, 3);
    ctx.fill();

    // lights
    ctx.fillStyle = '#f4f8ff';
    ctx.fillRect(L / 2 - 2.5, -W / 2 + 2, 2.5, 4);
    ctx.fillRect(L / 2 - 2.5, W / 2 - 6, 2.5, 4);
    ctx.fillStyle = braking ? '#ff2d4b' : '#a3162b';
    ctx.fillRect(-L / 2, -W / 2 + 2, 2.5, 5);
    ctx.fillRect(-L / 2, W / 2 - 7, 2.5, 5);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function shadeHex(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => MathUtil.clamp(Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount), 0, 255);
  const r = ch(n >> 16), g = ch((n >> 8) & 255), b = ch(n & 255);
  return `rgb(${r},${g},${b})`;
}
