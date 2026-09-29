'use strict';

/**
 * Road network editor.
 *   Road tool:  click = add node (chained from the selected one) · click a road = T-junction
 *               drag = move node · right-click = deselect / delete node / delete road
 *   Start tool: click a lane to place the spawn point (direction follows the lane)
 *   Erase tool: click a node or road to delete it (the touch-friendly way to delete)
 */
class GraphEditor {
  constructor(app) {
    this.app = app;
    this.tool = 'road';
    this.hovered = null;
    this.hoveredSegment = null;
    this.selected = null;
    this.dragging = false;
    this.moved = false;
    this.mouse = null;
    this.touch = false; // set by the app per pointer event; fingers get bigger hit targets
    this.undoStack = [];
  }

  get graph() {
    return this.app.world.graph;
  }

  // ------------------------------------------------------------------ undo

  snapshot() {
    this.undoStack.push(JSON.stringify(this.app.world.toJSON()));
    if (this.undoStack.length > 80) this.undoStack.shift();
  }

  undo() {
    const s = this.undoStack.pop();
    if (!s) return false;
    this.selected = this.hovered = this.hoveredSegment = null;
    this.app.loadWorldData(JSON.parse(s), { keepCamera: true, recordUndo: false, silent: true });
    return true;
  }

  // ------------------------------------------------------------------ input

  _thresholds() {
    return { point: (this.touch ? 28 : 14) / this.app.viewport.scale, road: this.app.world.options.roadWidth / 2 };
  }

  _updateHover(p) {
    const th = this._thresholds();
    this.hovered = null;
    let best = th.point;
    for (const pt of this.graph.points) {
      const d = Vec.distance(pt, p);
      if (d < best && pt !== (this.dragging ? this.selected : null)) {
        best = d;
        this.hovered = pt;
      }
    }
    this.hoveredSegment = null;
    if (!this.hovered) {
      let bestS = th.road;
      for (const s of this.graph.segments) {
        const d = s.distanceToPoint(p);
        if (d < bestS) {
          bestS = d;
          this.hoveredSegment = s;
        }
      }
    }
  }

  pointerDown(button, p) {
    this.mouse = p;
    this._updateHover(p);

    if (this.tool === 'start') {
      if (button !== 0) return;
      const pose = this.app.world.laneFromPoint(p, this.app.world.options.roadWidth);
      if (!pose) return this.app.toast('Click on a road to place the start point');
      this.snapshot();
      this.app.world.start = pose;
      this.app.onWorldEdited(true);
      return;
    }

    const erase = this.tool === 'erase' && button === 0;
    if (button === 2 || erase) {
      if (this.selected && !erase) {
        this.selected = null;
      } else if (this.hovered) {
        if (this.hovered === this.selected) this.selected = null;
        this.snapshot();
        this.graph.removePoint(this.hovered);
        this.hovered = null;
        this.app.onWorldEdited(true);
      } else if (this.hoveredSegment) {
        this.snapshot();
        this.graph.removeSegment(this.hoveredSegment);
        this.graph.prune();
        this.hoveredSegment = null;
        this.app.onWorldEdited(true);
      }
      return;
    }
    if (button !== 0) return;

    if (this.hovered) {
      this.snapshot();
      let changed = false;
      if (this.selected && this.selected !== this.hovered) {
        changed = this.graph.tryAddSegment(new Segment(this.selected, this.hovered));
      }
      if (!changed) this.undoStack.pop(); // selecting alone is not an edit (a drag re-snapshots)
      this.tapToDeselect = !changed && this.selected === this.hovered;
      this.selected = this.hovered;
      this.dragging = true;
      this.moved = false;
      if (changed) this.app.onWorldEdited(true);
      return;
    }

    this.snapshot();
    let point;
    if (this.hoveredSegment) {
      const proj = this.hoveredSegment.projectPoint(p);
      point = this.graph.splitSegment(this.hoveredSegment, Vec.lerp(this.hoveredSegment.p1, this.hoveredSegment.p2, MathUtil.clamp(proj.offset, 0.05, 0.95)));
    } else {
      point = this.graph.addPoint(new Point(Math.round(p.x), Math.round(p.y)));
    }
    if (this.selected) this.graph.tryAddSegment(new Segment(this.selected, point));
    this.selected = point;
    this.app.onWorldEdited(true);
  }

  pointerMove(p) {
    this.mouse = p;
    if (this.dragging && this.selected) {
      if (!this.moved) this.snapshot();
      this.moved = true;
      this.selected.x = Math.round(p.x);
      this.selected.y = Math.round(p.y);
      this.app.onWorldEdited(false);
    }
    this._updateHover(p);
  }

  pointerUp() {
    if (this.dragging && this.moved) this.app.onWorldEdited(true);
    else if (this.dragging && this.tapToDeselect) this.selected = null; // tap the selected node again = done
    this.tapToDeselect = false;
    this.dragging = false;
    this.moved = false;
  }

  deleteSelected() {
    if (!this.selected) return;
    this.snapshot();
    this.graph.removePoint(this.selected);
    this.selected = null;
    this.app.onWorldEdited(true);
  }

  // ----------------------------------------------------------------- render

  draw(ctx, scale) {
    const g = this.graph;
    const px = 1 / scale;

    // skeleton
    ctx.lineWidth = 2 * px;
    ctx.strokeStyle = 'rgba(61,139,253,0.55)';
    ctx.beginPath();
    for (const s of g.segments) {
      ctx.moveTo(s.p1.x, s.p1.y);
      ctx.lineTo(s.p2.x, s.p2.y);
    }
    ctx.stroke();

    if (this.tool !== 'start' && this.hoveredSegment && !this.dragging && !this.touch) {
      ctx.strokeStyle = this.tool === 'erase' ? THEME.danger : 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 3 * px;
      ctx.beginPath();
      ctx.moveTo(this.hoveredSegment.p1.x, this.hoveredSegment.p1.y);
      ctx.lineTo(this.hoveredSegment.p2.x, this.hoveredSegment.p2.y);
      ctx.stroke();
    }

    // preview of the next road
    if (this.tool === 'road' && this.selected && this.mouse && !this.dragging) {
      const target = this.hovered || this.mouse;
      ctx.setLineDash([8 * px, 6 * px]);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      ctx.moveTo(this.selected.x, this.selected.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const p of g.points) {
      const r = (p === this.selected ? 8 : 6) * px;
      ctx.fillStyle = '#15181d';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 2 * px, 0, TAU);
      ctx.fill();
      const hot = p === this.hovered && !this.touch;
      ctx.fillStyle = p === this.selected ? '#ffffff' : hot ? (this.tool === 'erase' ? THEME.danger : '#9cc5ff') : THEME.accent;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fill();
    }

    this.drawStart(ctx, scale);
  }

  drawStart(ctx, scale) {
    const s = this.app.world.start;
    if (!s) return;
    const px = 1 / scale;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    ctx.fillStyle = 'rgba(61,139,253,0.18)';
    ctx.strokeStyle = THEME.accent;
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-8, -9);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
