'use strict';

/**
 * Scripted traffic: random-walks the road graph in the right-hand lane using a
 * pure-pursuit controller along a lane polyline, keeps its distance to the car
 * ahead, and slows down for corners. AI cars must learn to avoid these.
 */
class TrafficCar {
  constructor(world, from, to, t, rng) {
    this.world = world;
    this.rng = rng;
    this.length = 40;
    this.width = 20;
    this.lane = world.laneOffset;
    this.cruise = rng.range(80, 120);
    this.speed = this.cruise * 0.6;
    this.color = rng.pick(THEME.trafficPalette);
    this.wait = 0;

    const dir = Vec.normalize(Vec.sub(to, from));
    const p = Vec.add(Vec.lerp(from, to, t), Vec.scale(Vec.perp(dir), this.lane));
    this.x = p.x;
    this.y = p.y;
    this.angle = Vec.angle(dir);

    this.path = [new Point(this.x, this.y), this._laneEnd(from, to)];
    this.seg = 0;
    this.prev = from;
    this.node = to;
    this.poly = new Float64Array(8);
    this._extend();
    this.updatePolygon();
  }

  _inset(node, len) {
    return this.world.degree(node) >= 2 ? Math.min(this.world.options.roadWidth * 0.55, len * 0.35) : 0;
  }

  _laneEnd(a, b) {
    const len = Vec.distance(a, b);
    const d = Vec.normalize(Vec.sub(b, a));
    return Vec.add(Vec.sub(b, Vec.scale(d, this._inset(b, len))), Vec.scale(Vec.perp(d), this.lane));
  }

  _laneStart(a, b) {
    const len = Vec.distance(a, b);
    const d = Vec.normalize(Vec.sub(b, a));
    return Vec.add(Vec.add(a, Vec.scale(d, this._inset(a, len))), Vec.scale(Vec.perp(d), this.lane));
  }

  /** Keeps a few route legs queued ahead and drops the ones already driven. */
  _extend() {
    while (this.path.length - this.seg < 6) {
      const nbrs = this.world.adjacency.get(this.node) || [];
      if (!nbrs.length) break;
      let options = nbrs.filter((n) => n !== this.prev);
      if (!options.length) options = nbrs;
      const next = this.rng.pick(options);
      this.path.push(this._laneStart(this.node, next), this._laneEnd(this.node, next));
      this.prev = this.node;
      this.node = next;
    }
    if (this.seg > 8) {
      this.path.splice(0, this.seg);
      this.seg = 0;
    }
  }

  update(dt, obstacles) {
    const path = this.path;
    let t = 0;
    for (;;) {
      const a = path[this.seg], b = path[this.seg + 1];
      if (!b) break;
      const vx = b.x - a.x, vy = b.y - a.y;
      const lenSq = vx * vx + vy * vy;
      t = lenSq > 0 ? ((this.x - a.x) * vx + (this.y - a.y) * vy) / lenSq : 1;
      if (t >= 1 && this.seg < path.length - 2) this.seg++;
      else break;
    }
    this._extend();

    // pure pursuit: aim at a point `lookahead` further along the lane polyline
    let remaining = 38 + this.speed * 0.25;
    const a = path[this.seg], b = path[this.seg + 1] || a;
    const tc = MathUtil.clamp(t, 0, 1);
    let px = a.x + (b.x - a.x) * tc, py = a.y + (b.y - a.y) * tc;
    let i = this.seg, tx = px, ty = py;
    while (i + 1 < path.length) {
      const nb = path[i + 1];
      const d = Math.hypot(nb.x - px, nb.y - py);
      if (d >= remaining) {
        tx = px + ((nb.x - px) * remaining) / d;
        ty = py + ((nb.y - py) * remaining) / d;
        break;
      }
      remaining -= d;
      px = tx = nb.x;
      py = ty = nb.y;
      i++;
    }

    const diff = MathUtil.wrapAngle(Math.atan2(ty - this.y, tx - this.x) - this.angle);
    const maxTurn = 3.2 * dt;
    this.angle += MathUtil.clamp(diff, -maxTurn, maxTurn);

    let target = this.cruise * (1 - Math.min(0.65, Math.abs(diff) * 0.9));
    if (this._blocked(obstacles)) {
      this.wait += dt;
      if (this.wait < 4) target = 0;
    } else {
      this.wait = 0;
    }
    this.speed = MathUtil.approach(this.speed, target, (target > this.speed ? 90 : 320) * dt);

    this.x += Math.cos(this.angle) * this.speed * dt;
    this.y += Math.sin(this.angle) * this.speed * dt;
    this.updatePolygon();
  }

  _blocked(obstacles) {
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    for (const o of obstacles) {
      if (o === this || o.alive === false) continue;
      const dx = o.x - this.x, dy = o.y - this.y;
      if (Math.abs(dx) > 80 || Math.abs(dy) > 80) continue;
      const fwd = dx * c + dy * s;
      if (fwd <= 0 || fwd > 62) continue;
      if (Math.abs(-dx * s + dy * c) < 17) return true;
    }
    return false;
  }

  updatePolygon() {
    writeBoxCorners(this.poly, this.x, this.y, this.angle, this.length, this.width);
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    Car.drawBody(ctx, this.length, this.width, this.color, this.speed < this.cruise * 0.4);
    ctx.restore();
  }

  /** Deterministic spawn: the same seed always produces the same scenario. */
  static spawn(world, count, seed, avoid = null) {
    const rng = new Random(seed);
    const segs = world.graph.segments.filter((s) => s.length() > 90);
    const cars = [];
    if (!segs.length) return cars;
    let attempts = 0;
    while (cars.length < count && attempts < count * 50) {
      attempts++;
      const s = rng.pick(segs);
      const forward = rng.next() < 0.5;
      const car = new TrafficCar(world, forward ? s.p1 : s.p2, forward ? s.p2 : s.p1, rng.range(0.2, 0.8), new Random(rng.int(1e9) + 1));
      if (avoid && Math.hypot(car.x - avoid.x, car.y - avoid.y) < 280) continue;
      if (cars.some((o) => Math.hypot(o.x - car.x, o.y - car.y) < 100)) continue;
      cars.push(car);
    }
    return cars;
  }
}
