'use strict';

/**
 * Ray-cast "lidar". Each ray reports proximity in [0, 1]
 * (0 = nothing within range, 1 = touching), against road borders and traffic.
 */
class Sensor {
  static DEFAULTS = { rayCount: 9, rayLength: 220, raySpread: Math.PI * 0.85 };

  constructor(options = {}) {
    Object.assign(this, Sensor.DEFAULTS, options);
    this.readings = new Float32Array(this.rayCount);
    // per ray: end x, end y, hit t (or 1)
    this.rays = new Float32Array(this.rayCount * 3);
  }

  update(car, borders, traffic) {
    const n = this.rayCount, len = this.rayLength;
    for (let i = 0; i < n; i++) {
      const offset = n === 1 ? 0 : MathUtil.lerp(-this.raySpread / 2, this.raySpread / 2, i / (n - 1));
      const a = car.angle + offset;
      const ax = car.x, ay = car.y;
      const bx = ax + Math.cos(a) * len, by = ay + Math.sin(a) * len;
      let minT = 2;

      for (let k = 0; k < borders.length; k++) {
        const s = borders[k];
        const t = MathUtil.segmentIntersectT(ax, ay, bx, by, s.ax, s.ay, s.bx, s.by);
        if (t >= 0 && t < minT) minT = t;
      }

      for (let k = 0; k < traffic.length; k++) {
        const o = traffic[k];
        if (Math.abs(o.x - ax) > len + 30 || Math.abs(o.y - ay) > len + 30) continue;
        const p = o.poly;
        for (let e = 0; e < 4; e++) {
          const f = (e + 1) & 3;
          const t = MathUtil.segmentIntersectT(ax, ay, bx, by, p[e * 2], p[e * 2 + 1], p[f * 2], p[f * 2 + 1]);
          if (t >= 0 && t < minT) minT = t;
        }
      }

      this.readings[i] = minT <= 1 ? 1 - minT : 0;
      this.rays[i * 3] = bx;
      this.rays[i * 3 + 1] = by;
      this.rays[i * 3 + 2] = minT <= 1 ? minT : 1;
    }
  }

  draw(ctx, car) {
    ctx.lineWidth = 2;
    for (let i = 0; i < this.rayCount; i++) {
      const bx = this.rays[i * 3], by = this.rays[i * 3 + 1], t = this.rays[i * 3 + 2];
      const hx = car.x + (bx - car.x) * t, hy = car.y + (by - car.y) * t;
      ctx.strokeStyle = THEME.sensorRay;
      ctx.beginPath();
      ctx.moveTo(car.x, car.y);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      if (t < 1) {
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.fillStyle = THEME.sensorHit;
        ctx.beginPath();
        ctx.arc(hx, hy, 4, 0, TAU);
        ctx.fill();
      }
    }
  }
}
