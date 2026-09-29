'use strict';

/** Camera: world <-> screen transforms, zoom around the cursor, smooth follow. HiDPI aware. */
class Viewport {
  constructor(canvas) {
    this.canvas = canvas;
    this.scale = 0.6;
    this.center = { x: 0, y: 0 };
    this.minScale = 0.08;
    this.maxScale = 3.5;
    this.dpr = 1;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
  }

  apply(ctx) {
    const s = this.scale * this.dpr;
    ctx.setTransform(s, 0, 0, s, (this.width / 2 - this.center.x * this.scale) * this.dpr, (this.height / 2 - this.center.y * this.scale) * this.dpr);
  }

  applyScreen(ctx) {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  screenToWorld(sx, sy) {
    return new Point((sx - this.width / 2) / this.scale + this.center.x, (sy - this.height / 2) / this.scale + this.center.y);
  }

  visibleBounds() {
    const a = this.screenToWorld(0, 0), b = this.screenToWorld(this.width, this.height);
    return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
  }

  zoomAt(sx, sy, factor) {
    const before = this.screenToWorld(sx, sy);
    this.scale = MathUtil.clamp(this.scale * factor, this.minScale, this.maxScale);
    const after = this.screenToWorld(sx, sy);
    this.center.x += before.x - after.x;
    this.center.y += before.y - after.y;
  }

  panBy(dx, dy) {
    this.center.x -= dx / this.scale;
    this.center.y -= dy / this.scale;
  }

  follow(x, y, dt, stiffness = 4) {
    const k = 1 - Math.exp(-dt * stiffness);
    this.center.x += (x - this.center.x) * k;
    this.center.y += (y - this.center.y) * k;
  }

  fit(bounds, padding = 80) {
    const w = bounds.maxX - bounds.minX, h = bounds.maxY - bounds.minY;
    this.center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    this.scale = MathUtil.clamp(Math.min((this.width - padding * 2) / w, (this.height - padding * 2) / h), this.minScale, this.maxScale);
  }
}
