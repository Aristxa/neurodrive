'use strict';

function tracePolygon(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

/** Extruded building with a pseudo-3D projection relative to the camera. */
class Building {
  constructor(base, height, tint) {
    this.base = base;
    this.height = height;
    this.tint = tint;
    this.center = base.centroid();
    this.radius = Math.max(...base.points.map((p) => Vec.distance(p, this.center)));
    this._faces = this._computeFaces();
  }

  _computeFaces() {
    const pts = this.base.points;
    const light = Vec.normalize(new Point(-0.55, -0.85));
    return pts.map((a, i) => {
      const b = pts[(i + 1) % pts.length];
      const mid = Vec.average(a, b);
      let n = Vec.normalize(Vec.perp(Vec.sub(b, a)));
      if (Vec.dot(n, Vec.sub(mid, this.center)) < 0) n = Vec.scale(n, -1);
      const lit = (Vec.dot(n, light) + 1) / 2; // 0 (shadow) .. 1 (lit)
      return { a, b, mid, lightness: 14 + lit * 14 + this.tint * 4 };
    });
  }

  draw(ctx, viewPoint) {
    const pts = this.base.points;
    const top = pts.map((p) => fake3d(p, viewPoint, this.height));

    // contact shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    tracePolygon(ctx, pts);
    ctx.fill();

    const faces = this._faces
      .map((f, i) => ({ f, i, d: Vec.distance(f.mid, viewPoint) }))
      .sort((x, y) => y.d - x.d);
    ctx.lineWidth = 1;
    for (const { f, i } of faces) {
      const j = (i + 1) % pts.length;
      ctx.fillStyle = `hsl(216, 13%, ${f.lightness}%)`;
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      tracePolygon(ctx, [f.a, f.b, top[j], top[i]]);
      ctx.fill();
      ctx.stroke();
    }

    // roof
    ctx.fillStyle = `hsl(216, 14%, ${30 + this.tint * 6}%)`;
    tracePolygon(ctx, top);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // rooftop unit (small inset block) for a bit of detail
    const c = fake3d(this.center, viewPoint, this.height);
    const inset = top.map((p) => Vec.lerp(c, p, 0.42));
    ctx.fillStyle = `hsl(216, 12%, ${36 + this.tint * 6}%)`;
    tracePolygon(ctx, inset);
    ctx.fill();
  }
}

/** Layered, slightly irregular canopy. */
class Tree {
  constructor(center, size, rng) {
    this.center = center;
    this.size = size;
    this.radius = size / 2;
    this.height = size * rng.range(0.55, 0.85);
    this.hue = 150 + rng.range(-12, 10);
    const LEVELS = 6, SIDES = 14;
    this.levels = [];
    for (let i = 0; i < LEVELS; i++) {
      const noise = new Float32Array(SIDES);
      for (let k = 0; k < SIDES; k++) noise[k] = rng.range(0.78, 1.06);
      this.levels.push(noise);
    }
  }

  draw(ctx, viewPoint) {
    const top = fake3d(this.center, viewPoint, this.height);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.arc(this.center.x, this.center.y, this.radius * 0.9, 0, TAU);
    ctx.fill();

    const L = this.levels.length;
    for (let i = 0; i < L; i++) {
      const t = i / (L - 1);
      const cx = MathUtil.lerp(this.center.x, top.x, t);
      const cy = MathUtil.lerp(this.center.y, top.y, t);
      const r = MathUtil.lerp(this.radius, this.radius * 0.28, t);
      const noise = this.levels[i];
      ctx.fillStyle = `hsl(${this.hue}, 24%, ${MathUtil.lerp(14, 34, t)}%)`;
      ctx.beginPath();
      for (let k = 0; k < noise.length; k++) {
        const a = (k / noise.length) * TAU;
        const x = cx + Math.cos(a) * r * noise[k];
        const y = cy + Math.sin(a) * r * noise[k];
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
}
