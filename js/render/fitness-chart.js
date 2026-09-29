'use strict';

/**
 * Best vs. average fitness per generation. Two series, one y axis, a recessive
 * grid, direct end labels plus a legend (in the DOM), and a crosshair tooltip.
 */
class FitnessChart {
  static SERIES = [
    { key: 'best', label: 'Best', color: '#3d8bfd' },
    { key: 'avg', label: 'Average', color: '#c27a22' },
  ];

  constructor(canvas, tooltip) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tooltip = tooltip;
    this.history = [];
    this.hoverIndex = -1;
    canvas.addEventListener('pointermove', (e) => this._onHover(e));
    canvas.addEventListener('pointerleave', () => {
      this.hoverIndex = -1;
      this.tooltip.hidden = true;
      this.draw(this.history);
    });
  }

  _layout() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    return { w, h, left: 34, right: w - 56, top: 10, bottom: h - 20 };
  }

  _onHover(e) {
    const n = this.history.length;
    if (n < 1) return;
    const L = this._layout();
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const idx = n === 1 ? 0 : Math.round(((x - L.left) / (L.right - L.left)) * (n - 1));
    this.hoverIndex = MathUtil.clamp(idx, 0, n - 1);
    const d = this.history[this.hoverIndex];
    this.tooltip.hidden = false;
    this.tooltip.innerHTML =
      `<div class="tt-title">Generation ${d.generation}</div>` +
      FitnessChart.SERIES.map((s) => `<div class="tt-row"><i style="background:${s.color}"></i>${s.label}<b>${d[s.key].toFixed(1)}</b></div>`).join('');
    const px = this._x(this.hoverIndex, L);
    this.tooltip.style.left = `${Math.min(px + 12, L.w - 130)}px`;
    this.tooltip.style.top = `${L.top + 4}px`;
    this.draw(this.history);
  }

  _x(i, L) {
    const n = this.history.length;
    return n <= 1 ? (L.left + L.right) / 2 : L.left + ((L.right - L.left) * i) / (n - 1);
  }

  draw(history) {
    this.history = history;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const L = this._layout();
    if (this.canvas.width !== Math.round(L.w * dpr)) {
      this.canvas.width = Math.round(L.w * dpr);
      this.canvas.height = Math.round(L.h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, L.w, L.h);
    ctx.font = '10px "JetBrains Mono", monospace';

    if (!history.length) {
      ctx.fillStyle = 'rgba(200,208,220,0.45)';
      ctx.textAlign = 'center';
      ctx.fillText('Completes after generation 1', L.w / 2, L.h / 2);
      return;
    }

    const max = niceCeil(Math.max(1, ...history.map((d) => d.best)));
    const y = (v) => L.bottom - (Math.max(0, v) / max) * (L.bottom - L.top);

    // recessive grid + y ticks
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let k = 0; k <= 3; k++) {
      const v = (max * k) / 3, yy = Math.round(y(v)) + 0.5;
      ctx.strokeStyle = k === 0 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(L.left, yy);
      ctx.lineTo(L.right, yy);
      ctx.stroke();
      ctx.fillStyle = 'rgba(200,208,220,0.5)';
      ctx.fillText(formatCompact(v), L.left - 6, yy);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`gen ${history[0].generation}`, L.left + 14, L.bottom + 6);
    if (history.length > 1) ctx.fillText(`${history[history.length - 1].generation}`, L.right, L.bottom + 6);

    // lines (average first so best sits on top)
    for (const s of [...FitnessChart.SERIES].reverse()) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      history.forEach((d, i) => (i ? ctx.lineTo(this._x(i, L), y(d[s.key])) : ctx.moveTo(this._x(i, L), y(d[s.key]))));
      ctx.stroke();
      if (history.length === 1) {
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(this._x(0, L), y(history[0][s.key]), 4, 0, TAU);
        ctx.fill();
      }
    }

    // direct end labels (text in ink, colored marker carries identity)
    const last = history[history.length - 1];
    const yb = y(last.best), ya = y(last.avg);
    const spread = Math.max(0, 12 - Math.abs(yb - ya)) / 2;
    [[FitnessChart.SERIES[0], yb - spread], [FitnessChart.SERIES[1], ya + spread]].forEach(([s, yy]) => {
      ctx.fillStyle = s.color;
      ctx.fillRect(L.right + 6, yy - 1, 6, 2);
      ctx.fillStyle = 'rgba(232,237,243,0.85)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(formatCompact(last[s.key]), L.right + 15, yy);
    });

    // crosshair
    if (this.hoverIndex >= 0 && this.hoverIndex < history.length) {
      const x = this._x(this.hoverIndex, L);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.moveTo(x + 0.5, L.top);
      ctx.lineTo(x + 0.5, L.bottom);
      ctx.stroke();
      for (const s of FitnessChart.SERIES) {
        const d = history[this.hoverIndex];
        ctx.fillStyle = '#15181d';
        ctx.beginPath();
        ctx.arc(x, y(d[s.key]), 6, 0, TAU);
        ctx.fill();
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(x, y(d[s.key]), 4, 0, TAU);
        ctx.fill();
      }
    }
  }
}

function niceCeil(v) {
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 3, 5, 10]) if (m * mag >= v) return m * mag;
  return 10 * mag;
}

function formatCompact(v) {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v >= 100 ? v.toFixed(0) : v.toFixed(v < 10 ? 1 : 0);
}
