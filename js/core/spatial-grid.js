'use strict';

/**
 * Uniform spatial hash.
 *
 * Every car casts ~9 rays and tests 4 hull edges each tick. Without a broad
 * phase that is O(cars × borders); with the grid each car only sees the handful
 * of border segments in its neighbourhood, which is what lets a population of
 * hundreds run at 10–30× real time.
 */
class SpatialGrid {
  constructor(cellSize = 128) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.size = 0;
    this._stamp = 0;
  }

  _key(ix, iy) {
    return (ix + 32768) * 65536 + (iy + 32768);
  }

  insert(item, minX, minY, maxX, maxY) {
    const cs = this.cellSize;
    const x0 = Math.floor(minX / cs), x1 = Math.floor(maxX / cs);
    const y0 = Math.floor(minY / cs), y1 = Math.floor(maxY / cs);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const key = this._key(ix, iy);
        let cell = this.cells.get(key);
        if (!cell) {
          cell = [];
          this.cells.set(key, cell);
        }
        cell.push(item);
      }
    }
    item._stamp = 0;
    this.size++;
  }

  /** Segments are stored as flat {ax, ay, bx, by} records for fast access. */
  insertSegment(seg) {
    this.insert(seg, Math.min(seg.ax, seg.bx), Math.min(seg.ay, seg.by), Math.max(seg.ax, seg.bx), Math.max(seg.ay, seg.by));
  }

  insertPoint(item) {
    this.insert(item, item.x, item.y, item.x, item.y);
  }

  /** Collects unique items whose cells overlap the box. Reuses `out`. */
  query(minX, minY, maxX, maxY, out = []) {
    out.length = 0;
    const stamp = ++this._stamp;
    const cs = this.cellSize;
    const x0 = Math.floor(minX / cs), x1 = Math.floor(maxX / cs);
    const y0 = Math.floor(minY / cs), y1 = Math.floor(maxY / cs);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const cell = this.cells.get(this._key(ix, iy));
        if (!cell) continue;
        for (let k = 0; k < cell.length; k++) {
          const item = cell[k];
          if (item._stamp !== stamp) {
            item._stamp = stamp;
            out.push(item);
          }
        }
      }
    }
    return out;
  }
}
