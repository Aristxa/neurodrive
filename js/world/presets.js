'use strict';

/** Hand-designed and procedurally generated starter worlds. */
const Presets = (() => {
  function pack(name, points, edges, startEdge = 0, options = {}) {
    const graph = Graph.fromJSON({ points, segments: edges });
    const world = new World(graph, options);
    world._buildAdjacency();
    const seg = graph.segments[startEdge];
    const start = seg ? world.poseOnSegment(seg, seg.p1, 90) : null;
    return { version: 1, name, graph: graph.toJSON(), start, options };
  }

  function downtown() {
    const cols = 5, rows = 4, dx = 480, dy = 430;
    const points = [];
    const idx = (c, r) => r * cols + c;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) points.push([c * dx, r * dy]);
    const removed = new Set(['v1,1', 'h2,2', 'v3,0']);
    const edges = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (c < cols - 1 && !removed.has(`h${c},${r}`)) edges.push([idx(c, r), idx(c + 1, r)]);
        if (r < rows - 1 && !removed.has(`v${c},${r}`)) edges.push([idx(c, r), idx(c, r + 1)]);
      }
    }
    // curved ring road on the east side
    const cx = (cols - 1) * dx, cy = ((rows - 1) * dy) / 2, ry = cy, rx = 420;
    let prev = idx(cols - 1, 0);
    const STEPS = 8;
    for (let k = 1; k < STEPS; k++) {
      const a = -Math.PI / 2 + (k / STEPS) * Math.PI;
      points.push([Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry)]);
      edges.push([prev, points.length - 1]);
      prev = points.length - 1;
    }
    edges.push([prev, idx(cols - 1, rows - 1)]);
    return pack('Downtown', points, edges, 0);
  }

  function circuit() {
    const N = 34, points = [], edges = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      const r = 1 + 0.2 * Math.sin(3 * a + 0.6) + 0.1 * Math.sin(5 * a + 1.4) + 0.07 * Math.cos(2 * a);
      points.push([Math.round(Math.cos(a) * 1150 * r), Math.round(Math.sin(a) * 760 * r)]);
      edges.push([i, (i + 1) % N]);
    }
    return pack('Grand Prix circuit', points, edges, 0);
  }

  function ringRoad() {
    const points = [], edges = [];
    const OUT = 20, IN = 10;
    for (let i = 0; i < OUT; i++) {
      const a = (i / OUT) * TAU;
      points.push([Math.round(Math.cos(a) * 1200), Math.round(Math.sin(a) * 950)]);
      edges.push([i, (i + 1) % OUT]);
    }
    for (let i = 0; i < IN; i++) {
      const a = (i / IN) * TAU;
      points.push([Math.round(Math.cos(a) * 480), Math.round(Math.sin(a) * 400)]);
      edges.push([OUT + i, OUT + ((i + 1) % IN)]);
    }
    for (let k = 0; k < 5; k++) edges.push([OUT + k * 2, k * 4]);
    return pack('Ring & spokes', points, edges, 0);
  }

  function blank() {
    return { version: 1, name: 'Blank canvas', graph: { points: [], segments: [] }, start: null, options: {} };
  }

  const list = [
    { id: 'downtown', name: 'Downtown grid', build: downtown },
    { id: 'circuit', name: 'Grand Prix circuit', build: circuit },
    { id: 'ring', name: 'Ring & spokes', build: ringRoad },
    { id: 'blank', name: 'Blank canvas', build: blank },
  ];

  return {
    list,
    get: (id) => list.find((p) => p.id === id) || list[0],
  };
})();
