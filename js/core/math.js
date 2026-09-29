'use strict';

/**
 * Core math helpers.
 *
 * Everything under js/core, js/world, js/ai and js/sim is DOM-free so the full
 * engine can also run headless in Node (see tools/train.js).
 */
const TAU = Math.PI * 2;

const MathUtil = {
  lerp(a, b, t) {
    return a + (b - a) * t;
  },

  clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  },

  /** Wraps an angle into (-PI, PI]. */
  wrapAngle(a) {
    return Math.atan2(Math.sin(a), Math.cos(a));
  },

  approach(value, target, maxDelta) {
    if (value < target) return Math.min(value + maxDelta, target);
    return Math.max(value - maxDelta, target);
  },

  /**
   * Intersection of segment AB with segment CD.
   * Returns the parameter t along AB in [0, 1], or -1 when they don't cross.
   * This is the hottest function in the simulation (ray casting + collisions),
   * so it works on raw numbers and never allocates.
   */
  segmentIntersectT(ax, ay, bx, by, cx, cy, dx, dy) {
    const rx = bx - ax, ry = by - ay;
    const sx = dx - cx, sy = dy - cy;
    const denom = rx * sy - ry * sx;
    if (denom === 0) return -1;
    const qx = cx - ax, qy = cy - ay;
    const t = (qx * sy - qy * sx) / denom;
    if (t < 0 || t > 1) return -1;
    const u = (qx * ry - qy * rx) / denom;
    if (u < 0 || u > 1) return -1;
    return t;
  },

  distToSegmentSq(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay;
    const lenSq = vx * vx + vy * vy;
    let t = lenSq > 0 ? ((px - ax) * vx + (py - ay) * vy) / lenSq : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + vx * t - px, qy = ay + vy * t - py;
    return qx * qx + qy * qy;
  },
};

/**
 * Seedable PRNG (mulberry32). Worlds and traffic scenarios are generated from
 * seeds so every generation of the population faces the exact same situation,
 * which makes fitness comparisons fair and training reproducible.
 */
class Random {
  constructor(seed = 1) {
    this.state = (seed >>> 0) || 1;
    this._spare = null;
  }

  next() {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min, max) {
    return min + (max - min) * this.next();
  }

  int(n) {
    return Math.floor(this.next() * n);
  }

  pick(arr) {
    return arr[this.int(arr.length)];
  }

  /** Standard normal sample (Box–Muller). */
  gaussian() {
    return Random.boxMuller(() => this.next(), this);
  }

  static boxMuller(rand, holder) {
    if (holder._spare !== null) {
      const s = holder._spare;
      holder._spare = null;
      return s;
    }
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    const mag = Math.sqrt(-2 * Math.log(u));
    holder._spare = mag * Math.sin(TAU * v);
    return mag * Math.cos(TAU * v);
  }
}

/** Unseeded gaussian used by the genetic operators. */
const gaussianHolder = { _spare: null };
Random.gaussianUnseeded = () => Random.boxMuller(Math.random, gaussianHolder);
