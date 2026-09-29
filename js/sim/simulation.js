'use strict';

/**
 * Training loop: runs one generation of AI cars in the world, scores them and
 * hands the scores to the genetic algorithm. DOM-free; the browser app and the
 * headless trainer both drive it through step(dt).
 *
 * Fitness = unique road checkpoints reached (+ a tiny distance tie-breaker,
 * − a crash penalty). Checkpoints rather than raw distance means circling in
 * place or wiggling earns nothing; cars that stop making progress are retired.
 */
class Simulation {
  static DEFAULTS = {
    population: 150,
    trafficCount: 6,
    generationTime: 45,
    stallTime: 3.5,
    mutationRate: 0.1,
    mutationStrength: 0.3,
    varyTraffic: false,
    trafficSeed: 1337,
  };

  constructor(world, settings = {}, seedBrain = null) {
    this.world = world;
    this.settings = Object.assign({}, Simulation.DEFAULTS, settings);
    this.evolution = new Evolution(
      {
        populationSize: this.settings.population,
        layers: Car.brainLayout(),
        mutationRate: this.settings.mutationRate,
        mutationStrength: this.settings.mutationStrength,
      },
      seedBrain,
    );
    this.env = { borderGrid: null, traffic: [], buf: [] };
    this._cpBuf = [];
    this.onGeneration = null;
    this.totalTime = 0;
    this.startGeneration();
  }

  get ready() {
    return !!this.world.start && this.world.checkpoints.length > 0;
  }

  setWorld(world) {
    this.world = world;
    this.startGeneration();
  }

  applySettings(partial) {
    Object.assign(this.settings, partial);
    this.evolution.populationSize = this.settings.population;
    this.evolution.mutationRate = this.settings.mutationRate;
    this.evolution.mutationStrength = this.settings.mutationStrength;
  }

  /** Replaces the population with variants of `brain` and restarts the generation. */
  seed(brain) {
    this.evolution.seed(brain);
    this.startGeneration();
  }

  startGeneration() {
    const w = this.world;
    this.time = 0;
    this.cars = [];
    this.traffic = [];
    this.alive = 0;
    if (!this.ready) return;

    const cpCount = w.checkpoints.length;
    const { x, y, angle } = w.start;
    this.cars = this.evolution.brains.map((brain, i) => {
      const car = new Car(x, y, angle, { brain, autopilot: true });
      car.id = i;
      car.visited = new Uint8Array(cpCount);
      car.checkpoints = 0;
      car.lastProgress = 0;
      car.deathTime = null;
      return car;
    });
    const seed = this.settings.varyTraffic
      ? this.settings.trafficSeed + this.evolution.generation * 7919
      : this.settings.trafficSeed;
    this.traffic = TrafficCar.spawn(w, this.settings.trafficCount, seed, w.start);
    this.env.borderGrid = w.borderGrid;
    this.env.traffic = this.traffic;
    this.alive = this.cars.length;
  }

  step(dt) {
    if (!this.ready || !this.cars.length) return;
    for (const t of this.traffic) t.update(dt, this.traffic);

    let alive = 0;
    for (const car of this.cars) {
      if (!car.alive) continue;
      car.update(dt, this.env);
      if (car.alive) {
        this._trackProgress(car);
        if (this.time - car.lastProgress > this.settings.stallTime) {
          car.alive = false;
          car.status = 'stalled';
        }
      }
      car.fitness = car.checkpoints + car.distance * 0.0005 - (car.status === 'crashed' ? 1.5 : 0);
      if (car.alive) alive++;
      else car.deathTime = this.time;
    }
    this.alive = alive;
    this.time += dt;
    this.totalTime += dt;

    if (alive === 0 || this.time >= this.settings.generationTime) this.endGeneration();
  }

  _trackProgress(car) {
    const w = this.world, r = w.checkpointRadius, r2 = r * r;
    const near = w.checkpointGrid.query(car.x - r, car.y - r, car.x + r, car.y + r, this._cpBuf);
    for (const cp of near) {
      if (car.visited[cp.i]) continue;
      const dx = cp.x - car.x, dy = cp.y - car.y;
      if (dx * dx + dy * dy <= r2) {
        car.visited[cp.i] = 1;
        car.checkpoints++;
        car.lastProgress = this.time;
      }
    }
  }

  endGeneration() {
    if (!this.cars.length) return null;
    const summary = this.evolution.evolve(this.cars.map((c) => c.fitness));
    summary.survivors = this.alive;
    summary.coverage = Math.max(...this.cars.map((c) => c.checkpoints)) / this.world.checkpoints.length;
    if (this.onGeneration) this.onGeneration(summary);
    this.startGeneration();
    return summary;
  }

  /** Highest-fitness car still driving (or overall if the generation is over). */
  leader() {
    let best = null;
    for (const c of this.cars) if (c.alive && (!best || c.fitness > best.fitness)) best = c;
    if (!best) for (const c of this.cars) if (!best || c.fitness > best.fitness) best = c;
    return best;
  }

  /** Best brain known so far: record holder, or the current leader in generation 1. */
  bestBrain() {
    return this.evolution.bestEver || this.leader()?.brain || null;
  }
}
