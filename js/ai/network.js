'use strict';

/**
 * Minimal fully-connected feed-forward network with tanh activations.
 * Weights live in Float32Arrays so forward passes for hundreds of cars per
 * tick stay cheap and allocation-free. Trained by neuro-evolution, not backprop.
 */
class Level {
  constructor(inputCount, outputCount, randomize = true) {
    this.inputCount = inputCount;
    this.outputCount = outputCount;
    this.inputs = new Float32Array(inputCount);
    this.outputs = new Float32Array(outputCount);
    this.biases = new Float32Array(outputCount);
    // row-major: weights[j * inputCount + i] connects input i -> output j
    this.weights = new Float32Array(inputCount * outputCount);
    if (randomize) {
      // Xavier-ish uniform init keeps early activations out of tanh saturation
      const limit = Math.sqrt(6 / (inputCount + outputCount));
      for (let k = 0; k < this.weights.length; k++) this.weights[k] = (Math.random() * 2 - 1) * limit;
      for (let j = 0; j < outputCount; j++) this.biases[j] = (Math.random() * 2 - 1) * 0.2;
    }
  }

  forward(input) {
    const nIn = this.inputCount, w = this.weights;
    this.inputs.set(input);
    for (let j = 0; j < this.outputCount; j++) {
      let sum = this.biases[j];
      const row = j * nIn;
      for (let i = 0; i < nIn; i++) sum += input[i] * w[row + i];
      this.outputs[j] = Math.tanh(sum);
    }
    return this.outputs;
  }
}

class NeuralNetwork {
  constructor(sizes, randomize = true) {
    this.sizes = sizes.slice();
    this.levels = [];
    for (let i = 0; i < sizes.length - 1; i++) this.levels.push(new Level(sizes[i], sizes[i + 1], randomize));
  }

  forward(inputs) {
    let out = inputs;
    for (const level of this.levels) out = level.forward(out);
    return out;
  }

  get parameterCount() {
    return this.levels.reduce((n, l) => n + l.weights.length + l.biases.length, 0);
  }

  clone() {
    const copy = new NeuralNetwork(this.sizes, false);
    copy.levels.forEach((l, i) => {
      l.weights.set(this.levels[i].weights);
      l.biases.set(this.levels[i].biases);
    });
    return copy;
  }

  /** Gaussian perturbation of a random subset of parameters. */
  mutate(rate, strength) {
    const perturb = (arr) => {
      for (let k = 0; k < arr.length; k++) {
        if (Math.random() < rate) {
          arr[k] = MathUtil.clamp(arr[k] + Random.gaussianUnseeded() * strength, -4, 4);
        }
      }
    };
    for (const l of this.levels) {
      perturb(l.weights);
      perturb(l.biases);
    }
    return this;
  }

  /**
   * Neuron-level crossover: each neuron (its bias + incoming weights) is inherited
   * as a unit from one parent, which preserves learned feature detectors far
   * better than mixing individual weights.
   */
  static crossover(a, b) {
    const child = new NeuralNetwork(a.sizes, false);
    child.levels.forEach((l, li) => {
      const la = a.levels[li], lb = b.levels[li];
      for (let j = 0; j < l.outputCount; j++) {
        const src = Math.random() < 0.5 ? la : lb;
        l.biases[j] = src.biases[j];
        const row = j * l.inputCount;
        l.weights.set(src.weights.subarray(row, row + l.inputCount), row);
      }
    });
    return child;
  }

  toJSON() {
    return {
      type: 'neurodrive-brain',
      version: 1,
      sizes: this.sizes,
      levels: this.levels.map((l) => ({
        biases: Array.from(l.biases, (v) => +v.toFixed(5)),
        weights: Array.from(l.weights, (v) => +v.toFixed(5)),
      })),
    };
  }

  static fromJSON(json, expectedSizes = null) {
    if (!json || !Array.isArray(json.sizes) || !Array.isArray(json.levels)) throw new Error('Not a NeuroDrive brain file');
    if (expectedSizes && json.sizes.join() !== expectedSizes.join()) {
      throw new Error(`Brain topology ${json.sizes.join('-')} does not match ${expectedSizes.join('-')}`);
    }
    const net = new NeuralNetwork(json.sizes, false);
    net.levels.forEach((l, i) => {
      l.biases.set(json.levels[i].biases);
      l.weights.set(json.levels[i].weights);
    });
    return net;
  }
}
