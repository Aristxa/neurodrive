'use strict';

/**
 * 2D geometry primitives used to turn a road graph into drivable geometry:
 * points, segments, polygons, polygon union and "envelopes" (the rounded
 * capsule shape around a road skeleton).
 */

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  equals(p) {
    return this.x === p.x && this.y === p.y;
  }
}

const Vec = {
  add: (a, b) => new Point(a.x + b.x, a.y + b.y),
  sub: (a, b) => new Point(a.x - b.x, a.y - b.y),
  scale: (a, s) => new Point(a.x * s, a.y * s),
  dot: (a, b) => a.x * b.x + a.y * b.y,
  cross: (a, b) => a.x * b.y - a.y * b.x,
  length: (a) => Math.hypot(a.x, a.y),
  distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
  angle: (a) => Math.atan2(a.y, a.x),
  lerp: (a, b, t) => new Point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t),
  average: (a, b) => new Point((a.x + b.x) / 2, (a.y + b.y) / 2),
  translate: (p, angle, d) => new Point(p.x + Math.cos(angle) * d, p.y + Math.sin(angle) * d),
  normalize(a) {
    const l = Math.hypot(a.x, a.y) || 1;
    return new Point(a.x / l, a.y / l);
  },
  /** Right-hand normal in screen space (y axis points down). */
  perp: (a) => new Point(-a.y, a.x),
};

/** Segment/segment intersection with both parameters (t on AB, u on CD). */
function getIntersection(A, B, C, D) {
  const rx = B.x - A.x, ry = B.y - A.y;
  const sx = D.x - C.x, sy = D.y - C.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const qx = C.x - A.x, qy = C.y - A.y;
  const t = (qx * sy - qy * sx) / denom;
  const u = (qx * ry - qy * rx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: A.x + rx * t, y: A.y + ry * t, t, u };
}

/**
 * Pseudo-3D projection: lifts a ground point "towards the camera" so extruded
 * shapes (buildings, trees) get perspective without a 3D pipeline.
 */
function fake3d(p, viewPoint, height) {
  const dx = p.x - viewPoint.x, dy = p.y - viewPoint.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return new Point(p.x, p.y);
  const s = ((Math.atan(d / 300) / (Math.PI / 2)) * height) / d;
  return new Point(p.x + dx * s, p.y + dy * s);
}

class Segment {
  constructor(p1, p2) {
    this.p1 = p1;
    this.p2 = p2;
  }

  length() {
    return Vec.distance(this.p1, this.p2);
  }

  direction() {
    return Vec.normalize(Vec.sub(this.p2, this.p1));
  }

  includes(p) {
    return this.p1.equals(p) || this.p2.equals(p);
  }

  equals(seg) {
    return this.includes(seg.p1) && this.includes(seg.p2);
  }

  projectPoint(p) {
    const a = Vec.sub(p, this.p1);
    const b = Vec.sub(this.p2, this.p1);
    const lenSq = Vec.dot(b, b);
    const t = lenSq > 0 ? Vec.dot(a, b) / lenSq : 0;
    return { point: Vec.add(this.p1, Vec.scale(b, t)), offset: t };
  }

  distanceToPoint(p) {
    return Math.sqrt(MathUtil.distToSegmentSq(p.x, p.y, this.p1.x, this.p1.y, this.p2.x, this.p2.y));
  }
}

class Polygon {
  constructor(points) {
    this.points = points;
    this.segments = points.map((p, i) => new Segment(p, points[(i + 1) % points.length]));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    this.bounds = { minX, minY, maxX, maxY };
  }

  static boundsOverlap(a, b, margin = 0) {
    return (
      a.minX - margin <= b.maxX && a.maxX + margin >= b.minX &&
      a.minY - margin <= b.maxY && a.maxY + margin >= b.minY
    );
  }

  /**
   * Union of polygons, returned as the outline segments.
   * 1. split every edge wherever it crosses an edge of another polygon
   * 2. keep only the pieces that are not inside any other polygon
   */
  static union(polys) {
    Polygon.multiBreak(polys);
    const kept = [];
    for (let i = 0; i < polys.length; i++) {
      for (const seg of polys[i].segments) {
        const mid = Vec.average(seg.p1, seg.p2);
        let inside = false;
        for (let j = 0; j < polys.length; j++) {
          if (i !== j && polys[j].containsPoint(mid)) {
            inside = true;
            break;
          }
        }
        if (!inside) kept.push(seg);
      }
    }
    return kept;
  }

  static multiBreak(polys) {
    for (let i = 0; i < polys.length - 1; i++) {
      for (let j = i + 1; j < polys.length; j++) {
        Polygon.break(polys[i], polys[j]);
      }
    }
  }

  static break(poly1, poly2) {
    if (!Polygon.boundsOverlap(poly1.bounds, poly2.bounds, 1)) return;
    const segs1 = poly1.segments, segs2 = poly2.segments;
    const EPS = 1e-7;
    for (let i = 0; i < segs1.length; i++) {
      for (let j = 0; j < segs2.length; j++) {
        const hit = getIntersection(segs1[i].p1, segs1[i].p2, segs2[j].p1, segs2[j].p2);
        if (!hit) continue;
        const split1 = hit.t > EPS && hit.t < 1 - EPS;
        const split2 = hit.u > EPS && hit.u < 1 - EPS;
        if (!split1 && !split2) continue;
        const point = new Point(hit.x, hit.y);
        if (split1) {
          const aux = segs1[i].p2;
          segs1[i].p2 = point;
          segs1.splice(i + 1, 0, new Segment(point, aux));
        }
        if (split2) {
          const aux = segs2[j].p2;
          segs2[j].p2 = point;
          segs2.splice(j + 1, 0, new Segment(point, aux));
        }
      }
    }
  }

  /** Even-odd ray casting against the original vertices. */
  containsPoint(p) {
    const b = this.bounds;
    if (p.x < b.minX || p.x > b.maxX || p.y < b.minY || p.y > b.maxY) return false;
    const pts = this.points;
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], c = pts[j];
      if ((a.y > p.y) !== (c.y > p.y) && p.x < ((c.x - a.x) * (p.y - a.y)) / (c.y - a.y) + a.x) {
        inside = !inside;
      }
    }
    return inside;
  }

  distanceToPoint(p) {
    let min = Infinity;
    for (const s of this.segments) {
      const d = s.distanceToPoint(p);
      if (d < min) min = d;
    }
    return min;
  }

  distanceToPoly(poly) {
    let min = Infinity;
    for (const p of this.points) {
      const d = poly.distanceToPoint(p);
      if (d < min) min = d;
    }
    return min;
  }

  intersectsPoly(poly) {
    if (!Polygon.boundsOverlap(this.bounds, poly.bounds)) return false;
    for (const s1 of this.segments) {
      for (const s2 of poly.segments) {
        if (getIntersection(s1.p1, s1.p2, s2.p1, s2.p2)) return true;
      }
    }
    return false;
  }

  centroid() {
    let x = 0, y = 0;
    for (const p of this.points) {
      x += p.x;
      y += p.y;
    }
    return new Point(x / this.points.length, y / this.points.length);
  }
}

/**
 * Capsule polygon around a skeleton segment: two half-circles joined by the
 * road sides. roundness = number of steps per half circle (1 => rectangle).
 */
function createEnvelope(skeleton, width, roundness = 1) {
  const { p1, p2 } = skeleton;
  const radius = width / 2;
  const alpha = Vec.angle(Vec.sub(p1, p2));
  const alphaCw = alpha + Math.PI / 2;
  const alphaCcw = alpha - Math.PI / 2;
  const step = Math.PI / Math.max(1, roundness);
  const eps = step / 2;
  const points = [];
  for (let a = alphaCcw; a <= alphaCw + eps; a += step) points.push(Vec.translate(p1, a, radius));
  for (let a = alphaCcw; a <= alphaCw + eps; a += step) points.push(Vec.translate(p2, Math.PI + a, radius));
  return new Polygon(points);
}

/** Writes the 4 corners of an oriented box into `out` (Float64Array(8)). */
function writeBoxCorners(out, x, y, angle, length, width) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const hl = length / 2, hw = width / 2;
  const lx = [hl, hl, -hl, -hl];
  const ly = [hw, -hw, -hw, hw];
  for (let i = 0; i < 4; i++) {
    out[i * 2] = x + c * lx[i] - s * ly[i];
    out[i * 2 + 1] = y + s * lx[i] + c * ly[i];
  }
  return out;
}
