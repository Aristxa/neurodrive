'use strict';

/**
 * Turns a road Graph into a drivable, renderable world:
 *   graph ─► road envelopes ─► polygon union ─► road borders (collision + sensors)
 *         ─► lane markings, crosswalks
 *         ─► checkpoints (progress measure for the fitness function)
 *         ─► procedural buildings and trees
 */
class World {
  static DEFAULTS = {
    roadWidth: 100,
    roadRoundness: 10,
    sidewalk: 12,
    buildingWidth: 95,
    buildingMinLength: 100,
    buildingHeight: [110, 260],
    spacing: 30,
    treeSize: 90,
    checkpointSpacing: 35,
    seed: 7,
  };

  constructor(graph, options = {}, start = null) {
    this.graph = graph;
    this.options = Object.assign({}, World.DEFAULTS, options);
    this.start = start;
    this.version = 0;
    this.detailed = false;
    this.envelopes = [];
    this.sidewalks = [];
    this.roadBorders = [];
    this.laneLines = [];
    this.crosswalks = [];
    this.checkpoints = [];
    this.buildings = [];
    this.trees = [];
    this.adjacency = new Map();
    this.bounds = { minX: -500, minY: -500, maxX: 500, maxY: 500 };
  }

  get laneOffset() {
    return this.options.roadWidth / 4;
  }

  generate({ detail = true } = {}) {
    const o = this.options;
    const segs = this.graph.segments;
    this.envelopes = segs.map((s) => createEnvelope(s, o.roadWidth, o.roadRoundness));
    this.sidewalks = segs.map((s) => createEnvelope(s, o.roadWidth + o.sidewalk * 2, o.roadRoundness));
    this.roadBorders = Polygon.union(this.envelopes);

    this._buildAdjacency();
    this._buildMarkings();
    this._buildCheckpoints();
    this._buildBorderGrid();

    this.detailed = detail;
    this.buildings = detail ? this._generateBuildings() : [];
    this.trees = detail ? this._generateTrees() : [];

    this._computeBounds();
    this.start = this.isOnRoad(this.start) ? this.start : this.defaultStart();
    this._paths = null;
    this.version++;
    return this;
  }

  // ---------------------------------------------------------------- topology

  _buildAdjacency() {
    this.adjacency = new Map();
    for (const p of this.graph.points) this.adjacency.set(p, []);
    for (const s of this.graph.segments) {
      this.adjacency.get(s.p1)?.push(s.p2);
      this.adjacency.get(s.p2)?.push(s.p1);
    }
  }

  degree(p) {
    return this.adjacency.get(p)?.length ?? 0;
  }

  // ---------------------------------------------------------------- markings

  _buildMarkings() {
    const rw = this.options.roadWidth;
    this.laneLines = [];
    this.crosswalks = [];
    for (const s of this.graph.segments) {
      const len = s.length();
      if (len < 1) continue;
      const dir = s.direction();
      const trim1 = this.degree(s.p1) >= 3 ? rw * 0.6 : 0;
      const trim2 = this.degree(s.p2) >= 3 ? rw * 0.6 : 0;
      if (len > trim1 + trim2 + 10) {
        this.laneLines.push([Vec.add(s.p1, Vec.scale(dir, trim1)), Vec.sub(s.p2, Vec.scale(dir, trim2))]);
      }
      if (len < rw * 2.2) continue;
      for (const [node, outward] of [[s.p1, dir], [s.p2, Vec.scale(dir, -1)]]) {
        if (this.degree(node) < 3) continue;
        this._addCrosswalk(node, outward);
      }
    }
  }

  _addCrosswalk(node, outward) {
    const rw = this.options.roadWidth;
    const side = Vec.perp(outward);
    const d0 = rw * 0.6 + 4, d1 = d0 + 18;
    for (let o = -rw / 2 + 9; o <= rw / 2 - 12; o += 11) {
      const a = Vec.add(node, Vec.add(Vec.scale(outward, d0), Vec.scale(side, o)));
      const b = Vec.add(node, Vec.add(Vec.scale(outward, d1), Vec.scale(side, o)));
      const c = Vec.add(b, Vec.scale(side, 5));
      const d = Vec.add(a, Vec.scale(side, 5));
      this.crosswalks.push([a, b, c, d]);
    }
  }

  // ------------------------------------------------------------ checkpoints

  /** Points sampled along every road. A car's progress = unique checkpoints reached. */
  _buildCheckpoints() {
    const spacing = this.options.checkpointSpacing;
    this.checkpointRadius = this.options.roadWidth / 2;
    this.checkpointGrid = new SpatialGrid(128);
    this.checkpoints = [];
    const tooClose = (x, y) => {
      const near = this.checkpointGrid.query(x - 8, y - 8, x + 8, y + 8, []);
      return near.some((c) => Math.hypot(c.x - x, c.y - y) < spacing * 0.3);
    };
    for (const s of this.graph.segments) {
      const n = Math.max(1, Math.round(s.length() / spacing));
      for (let k = 0; k <= n; k++) {
        const p = Vec.lerp(s.p1, s.p2, k / n);
        if (tooClose(p.x, p.y)) continue;
        const cp = { x: p.x, y: p.y, i: this.checkpoints.length };
        this.checkpoints.push(cp);
        this.checkpointGrid.insertPoint(cp);
      }
    }
  }

  _buildBorderGrid() {
    this.borderGrid = new SpatialGrid(128);
    for (const s of this.roadBorders) {
      this.borderGrid.insertSegment({ ax: s.p1.x, ay: s.p1.y, bx: s.p2.x, by: s.p2.y });
    }
  }

  // ------------------------------------------------------- procedural decor

  _generateBuildings() {
    const o = this.options;
    const rng = new Random(o.seed * 7919 + 1);
    const guideWidth = o.roadWidth + o.sidewalk * 2 + o.buildingWidth + o.spacing * 2;
    const guides = Polygon.union(this.graph.segments.map((s) => createEnvelope(s, guideWidth, o.roadRoundness)));

    const supports = [];
    for (const seg of guides) {
      const len = seg.length() + o.spacing;
      const count = Math.floor(len / (o.buildingMinLength + o.spacing));
      if (count < 1) continue;
      const bl = len / count - o.spacing;
      const dir = seg.direction();
      let q1 = seg.p1;
      let q2 = Vec.add(q1, Vec.scale(dir, bl));
      supports.push(new Segment(q1, q2));
      for (let i = 2; i <= count; i++) {
        q1 = Vec.add(q2, Vec.scale(dir, o.spacing));
        q2 = Vec.add(q1, Vec.scale(dir, bl));
        supports.push(new Segment(q1, q2));
      }
    }

    const bases = supports.map((s) => createEnvelope(s, o.buildingWidth, 1));
    for (let i = 0; i < bases.length - 1; i++) {
      for (let j = i + 1; j < bases.length; j++) {
        if (
          Polygon.boundsOverlap(bases[i].bounds, bases[j].bounds, o.spacing) &&
          (bases[i].intersectsPoly(bases[j]) || bases[i].distanceToPoly(bases[j]) < o.spacing - 0.001)
        ) {
          bases.splice(j, 1);
          j--;
        }
      }
    }
    return bases
      .filter((b) => !this.sidewalks.some((e) => e.intersectsPoly(b) || e.containsPoint(b.points[0])))
      .map((b) => new Building(b, rng.range(o.buildingHeight[0], o.buildingHeight[1]), rng.next()));
  }

  _generateTrees() {
    const o = this.options;
    const rng = new Random(o.seed * 104729 + 3);
    const illegal = [...this.buildings.map((b) => b.base), ...this.sidewalks];
    if (!illegal.length) return [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of illegal) {
      minX = Math.min(minX, p.bounds.minX);
      minY = Math.min(minY, p.bounds.minY);
      maxX = Math.max(maxX, p.bounds.maxX);
      maxY = Math.max(maxY, p.bounds.maxY);
    }
    const pad = o.treeSize;
    const trees = [];
    const MAX_TREES = 450;
    let tries = 0;
    while (tries < 150 && trees.length < MAX_TREES) {
      tries++;
      const p = new Point(rng.range(minX - pad, maxX + pad), rng.range(minY - pad, maxY + pad));
      let ok = true, near = false;
      for (const poly of illegal) {
        const b = poly.bounds, m = o.treeSize * 1.6;
        if (p.x < b.minX - m || p.x > b.maxX + m || p.y < b.minY - m || p.y > b.maxY + m) continue;
        if (poly.containsPoint(p)) { ok = false; break; }
        const d = poly.distanceToPoint(p);
        if (d < o.treeSize / 2) { ok = false; break; }
        if (d < m) near = true;
      }
      if (!ok || !near) continue;
      if (trees.some((t) => Vec.distance(t.center, p) < o.treeSize * 0.95)) continue;
      trees.push(new Tree(p, o.treeSize * rng.range(0.8, 1.1), rng));
      tries = 0;
    }
    return trees;
  }

  _computeBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (b) => {
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    };
    for (const p of this.sidewalks) grow(p.bounds);
    for (const b of this.buildings) grow(b.base.bounds);
    for (const t of this.trees) grow({ minX: t.center.x - t.radius, minY: t.center.y - t.radius, maxX: t.center.x + t.radius, maxY: t.center.y + t.radius });
    this.bounds = minX === Infinity ? { minX: -500, minY: -500, maxX: 500, maxY: 500 } : { minX, minY, maxX, maxY };
  }

  // -------------------------------------------------------------- spawning

  isOnRoad(p) {
    return !!p && this.envelopes.some((e) => e.containsPoint(p));
  }

  /** Pose in the right-hand lane of `seg`, facing from `from` to the other end. */
  poseOnSegment(seg, from, along = 70) {
    const to = seg.p1 === from ? seg.p2 : seg.p1;
    const len = Vec.distance(from, to);
    const dir = Vec.normalize(Vec.sub(to, from));
    const p = Vec.add(Vec.add(from, Vec.scale(dir, Math.min(along, len / 2))), Vec.scale(Vec.perp(dir), this.laneOffset));
    return { x: p.x, y: p.y, angle: Vec.angle(dir) };
  }

  defaultStart() {
    const seg = this.graph.segments.find((s) => s.length() > 1);
    return seg ? this.poseOnSegment(seg, seg.p1) : null;
  }

  /** Snaps an arbitrary point to the nearest lane, facing the lane's travel direction. */
  laneFromPoint(p, maxDist = Infinity) {
    let best = null, bestD = maxDist;
    for (const s of this.graph.segments) {
      const d = s.distanceToPoint(p);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (!best) return null;
    const proj = best.projectPoint(p);
    const t = MathUtil.clamp(proj.offset, 0, 1);
    const on = Vec.lerp(best.p1, best.p2, t);
    let dir = best.direction();
    if (Vec.cross(dir, Vec.sub(p, on)) < 0) dir = Vec.scale(dir, -1);
    const pos = Vec.add(on, Vec.scale(Vec.perp(dir), this.laneOffset));
    return { x: pos.x, y: pos.y, angle: Vec.angle(dir) };
  }

  // --------------------------------------------------------------- serialize

  toJSON(name = 'Custom world') {
    return {
      version: 1,
      name,
      graph: this.graph.toJSON(),
      start: this.start ? { x: Math.round(this.start.x), y: Math.round(this.start.y), angle: +this.start.angle.toFixed(4) } : null,
      options: { roadWidth: this.options.roadWidth, seed: this.options.seed },
    };
  }

  static fromJSON(data) {
    return new World(Graph.fromJSON(data.graph || {}), data.options || {}, data.start || null);
  }

  // ------------------------------------------------------------------ render

  _ensurePaths() {
    if (this._paths || typeof Path2D === 'undefined') return;
    const polyPath = (polys) => {
      const path = new Path2D();
      for (const poly of polys) {
        const pts = poly.points || poly;
        path.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
        path.closePath();
      }
      return path;
    };
    const linePath = (lines) => {
      const path = new Path2D();
      for (const [a, b] of lines) {
        path.moveTo(a.x, a.y);
        path.lineTo(b.x, b.y);
      }
      return path;
    };
    this._paths = {
      sidewalk: polyPath(this.sidewalks),
      road: polyPath(this.envelopes),
      crosswalks: polyPath(this.crosswalks),
      lanes: linePath(this.laneLines),
      borders: linePath(this.roadBorders.map((s) => [s.p1, s.p2])),
    };
  }

  drawRoads(ctx) {
    this._ensurePaths();
    const p = this._paths;
    ctx.fillStyle = THEME.sidewalk;
    ctx.fill(p.sidewalk);
    ctx.fillStyle = THEME.road;
    ctx.fill(p.road);
    ctx.fillStyle = THEME.crosswalk;
    ctx.fill(p.crosswalks);

    ctx.lineCap = 'butt';
    ctx.strokeStyle = THEME.laneMarking;
    ctx.lineWidth = 3;
    ctx.setLineDash([22, 18]);
    ctx.stroke(p.lanes);
    ctx.setLineDash([]);

    ctx.lineCap = 'round';
    ctx.strokeStyle = THEME.roadBorder;
    ctx.lineWidth = 3;
    ctx.stroke(p.borders);
  }

  /** Buildings and trees, painter-sorted from the viewer outwards, culled to the view. */
  drawItems(ctx, viewPoint, view) {
    const margin = 300;
    const items = [];
    for (const list of [this.buildings, this.trees]) {
      for (const it of list) {
        const c = it.center;
        if (c.x < view.minX - margin || c.x > view.maxX + margin || c.y < view.minY - margin || c.y > view.maxY + margin) continue;
        items.push(it);
      }
    }
    items.sort((a, b) => Vec.distance(b.center, viewPoint) - b.radius - (Vec.distance(a.center, viewPoint) - a.radius));
    for (const it of items) it.draw(ctx, viewPoint);
  }
}
