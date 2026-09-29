'use strict';

/**
 * Genetic algorithm over NeuralNetwork genomes.
 *
 *   evaluate ─► rank ─► elitism (top k survive unchanged)
 *                     ─► tournament selection ─► neuron crossover ─► gaussian mutation
 */
class Evolution {
  static DEFAULTS = {
    populationSize: 150,
    layers: [10, 12, 8, 2],
    mutationRate: 0.1,
    mutationStrength: 0.3,
    eliteRatio: 0.04,
    tournamentSize: 4,
    crossoverRate: 0.7,
  };

  constructor(options = {}, seedBrain = null) {
    Object.assign(this, Evolution.DEFAULTS, options);
    this.generation = 1;
    this.history = [];
    this.bestEver = null;
    this.bestEverFitness = -Infinity;
    this.bestEverGeneration = 0;
    this.brains = this._initialPopulation(seedBrain);
  }

  _initialPopulation(seed) {
    const brains = [];
    if (seed) {
      brains.push(seed.clone());
      while (brains.length < this.populationSize) {
        // spread the seeded population: some near-copies, some bolder variants
        const t = brains.length / this.populationSize;
        brains.push(seed.clone().mutate(this.mutationRate + 0.2 * t, this.mutationStrength * (0.3 + t)));
      }
    } else {
      while (brains.length < this.populationSize) brains.push(new NeuralNetwork(this.layers));
    }
    return brains;
  }

  /** Re-seeds the whole population around a known brain (e.g. a saved or pretrained one). */
  seed(brain) {
    this.brains = this._initialPopulation(brain);
  }

  _tournament(order, fitnesses) {
    let best = -1;
    for (let k = 0; k < this.tournamentSize; k++) {
      // bias sampling towards the top half so weak genomes rarely reproduce
      const idx = order[Math.floor(Math.pow(Math.random(), 1.5) * order.length)];
      if (best < 0 || fitnesses[idx] > fitnesses[best]) best = idx;
    }
    return this.brains[best];
  }

  /** Consumes the fitness of every genome and produces the next generation. */
  evolve(fitnesses) {
    const n = this.brains.length;
    const order = [...Array(n).keys()].sort((a, b) => fitnesses[b] - fitnesses[a]);
    const best = fitnesses[order[0]];
    const avg = fitnesses.reduce((s, f) => s + f, 0) / n;
    const summary = { generation: this.generation, best, avg, median: fitnesses[order[Math.floor(n / 2)]] };
    this.history.push(summary);

    if (best > this.bestEverFitness) {
      this.bestEverFitness = best;
      this.bestEver = this.brains[order[0]].clone();
      this.bestEverGeneration = this.generation;
      summary.record = true;
    }

    const next = [];
    const elites = Math.max(1, Math.round(this.populationSize * this.eliteRatio));
    for (let k = 0; k < elites && k < n; k++) next.push(this.brains[order[k]].clone());
    if (this.bestEver && best < this.bestEverFitness) next.push(this.bestEver.clone());

    while (next.length < this.populationSize) {
      const a = this._tournament(order, fitnesses);
      const child = Math.random() < this.crossoverRate
        ? NeuralNetwork.crossover(a, this._tournament(order, fitnesses))
        : a.clone();
      next.push(child.mutate(this.mutationRate, this.mutationStrength));
    }

    this.brains = next.slice(0, this.populationSize);
    this.generation++;
    return summary;
  }
}
