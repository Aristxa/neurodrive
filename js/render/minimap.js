'use strict';

/** Overview map: cached road layer + live car dots + the camera frustum. Click to jump. */
class Minimap {
  constructor(canvas, onJump) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cache = document.createElement('canvas');
    this.worldVersion = -1;
    this.onJump = onJump;
    canvas.addEventListener('pointerdown', (e) => {
      const r = canvas.getBoundingClientRect();
      if (this.map) this.onJump(this._toWorld(e.clientX - r.left, e.clientY - r.top));
    });
  }

  _prepare(world) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.canvas.width = this.cache.width = Math.round(w * dpr);
    this.canvas.height = this.cache.height = Math.round(h * dpr);
    const b = world.bounds, pad = 10;
    const s = Math.min((w - pad * 2) / (b.maxX - b.minX || 1), (h - pad * 2) / (b.maxY - b.minY || 1));
    this.map = {
      s, dpr, w, h,
      ox: w / 2 - ((b.minX + b.maxX) / 2) * s,
      oy: h / 2 - ((b.minY + b.maxY) / 2) * s,
    };
    const c = this.cache.getContext('2d');
    c.setTransform(dpr * s, 0, 0, dpr * s, this.map.ox * dpr, this.map.oy * dpr);
    c.fillStyle = 'rgba(255,255,255,0.06)';
    for (const bd of world.buildings) {
      tracePolygon(c, bd.base.points);
      c.fill();
    }
    c.fillStyle = '#4a515c';
    for (const e of world.envelopes) {
      tracePolygon(c, e.points);
      c.fill();
    }
    this.worldVersion = world.version;
  }

  _toWorld(x, y) {
    return new Point((x - this.map.ox) / this.map.s, (y - this.map.oy) / this.map.s);
  }

  draw(world, viewport, { cars = [], traffic = [], focus = null }) {
    // Hidden on phones (display: none): a 0x0 canvas makes drawImage throw, which would stop the frame loop.
    if (!this.canvas.clientWidth || !this.canvas.clientHeight) return;
    if (world.version !== this.worldVersion || this.canvas.clientWidth !== this.map?.w) this._prepare(world);
    const { s, dpr, ox, oy, w, h } = this.map;
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.cache, 0, 0, w, h);

    const dot = (x, y, r, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(ox + x * s, oy + y * s, r, 0, TAU);
      ctx.fill();
    };
    for (const t of traffic) dot(t.x, t.y, 2, '#a3abb6');
    for (const c of cars) if (c.alive && c !== focus) dot(c.x, c.y, 1.5, 'rgba(61,139,253,0.7)');
    if (focus) {
      dot(focus.x, focus.y, 5, 'rgba(61,139,253,0.35)');
      dot(focus.x, focus.y, 3, '#ffffff');
    }

    const v = viewport.visibleBounds();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + v.minX * s, oy + v.minY * s, (v.maxX - v.minX) * s, (v.maxY - v.minY) * s);
  }
}
