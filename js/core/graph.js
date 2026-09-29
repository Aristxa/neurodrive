'use strict';

/** The road network: nodes (intersections / bends) and undirected segments (roads). */
class Graph {
  constructor(points = [], segments = []) {
    this.points = points;
    this.segments = segments;
  }

  static fromJSON(json) {
    const points = (json.points || []).map(([x, y]) => new Point(x, y));
    const segments = [];
    for (const [i, j] of json.segments || []) {
      if (points[i] && points[j] && i !== j) segments.push(new Segment(points[i], points[j]));
    }
    return new Graph(points, segments);
  }

  toJSON() {
    const index = new Map(this.points.map((p, i) => [p, i]));
    return {
      points: this.points.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]),
      segments: this.segments.map((s) => [index.get(s.p1), index.get(s.p2)]),
    };
  }

  addPoint(p) {
    this.points.push(p);
    return p;
  }

  removePoint(p) {
    for (const seg of this.getSegmentsWithPoint(p)) this.removeSegment(seg);
    this.points.splice(this.points.indexOf(p), 1);
  }

  containsSegment(seg) {
    return this.segments.some((s) => s.equals(seg));
  }

  tryAddSegment(seg) {
    if (seg.p1.equals(seg.p2) || this.containsSegment(seg)) return false;
    this.segments.push(seg);
    return true;
  }

  removeSegment(seg) {
    const i = this.segments.indexOf(seg);
    if (i >= 0) this.segments.splice(i, 1);
  }

  getSegmentsWithPoint(p) {
    return this.segments.filter((s) => s.includes(p));
  }

  /** Inserts `point` into `seg`, turning one road into two (used to create T-junctions). */
  splitSegment(seg, point) {
    this.removeSegment(seg);
    this.addPoint(point);
    this.segments.push(new Segment(seg.p1, point), new Segment(point, seg.p2));
    return point;
  }

  /** Removes nodes no road uses. */
  prune() {
    const used = new Set();
    for (const s of this.segments) {
      used.add(s.p1);
      used.add(s.p2);
    }
    this.points = this.points.filter((p) => used.has(p));
  }

  clear() {
    this.points.length = 0;
    this.segments.length = 0;
  }
}
