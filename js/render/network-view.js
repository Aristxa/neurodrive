'use strict';

/** Live drawing of the focused car's network: signed weights as edges, activations as nodes. */
const NetworkView = {
  POSITIVE: [61, 139, 253],
  NEGATIVE: [194, 122, 34],

  draw(ctx, w, h, brain, inputs) {
    ctx.clearRect(0, 0, w, h);
    if (!brain) {
      ctx.fillStyle = 'rgba(200,208,220,0.5)';
      ctx.font = '12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No brain in control', w / 2, h / 2);
      return;
    }
    brain.forward(inputs); // refresh activations for exactly these inputs

    const padL = 34, padR = 64, padY = 12;
    const layers = [brain.levels[0].inputs, ...brain.levels.map((l) => l.outputs)];
    const colX = (i) => padL + ((w - padL - padR) * i) / (layers.length - 1);
    const rowY = (j, n) => (n === 1 ? h / 2 : padY + ((h - padY * 2) * j) / (n - 1));

    for (let li = 0; li < brain.levels.length; li++) {
      const level = brain.levels[li];
      const x0 = colX(li), x1 = colX(li + 1);
      for (let j = 0; j < level.outputCount; j++) {
        for (let i = 0; i < level.inputCount; i++) {
          const wt = level.weights[j * level.inputCount + i];
          const signal = Math.abs(wt) * (0.25 + Math.abs(level.inputs[i]) * 0.75);
          const alpha = Math.min(0.85, signal * 0.45);
          if (alpha < 0.03) continue;
          const c = wt >= 0 ? this.POSITIVE : this.NEGATIVE;
          ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
          ctx.lineWidth = 0.6 + Math.min(2, Math.abs(wt));
          ctx.beginPath();
          ctx.moveTo(x0, rowY(i, level.inputCount));
          ctx.lineTo(x1, rowY(j, level.outputCount));
          ctx.stroke();
        }
      }
    }

    ctx.font = '600 9px "JetBrains Mono", monospace';
    layers.forEach((values, li) => {
      const n = values.length;
      for (let j = 0; j < n; j++) {
        const x = colX(li), y = rowY(j, n), v = values[j];
        const c = v >= 0 ? this.POSITIVE : this.NEGATIVE;
        const r = li === 0 || li === layers.length - 1 ? 6 : 5;
        ctx.fillStyle = '#15181d';
        ctx.beginPath();
        ctx.arc(x, y, r + 2, 0, TAU);
        ctx.fill();
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.15 + Math.min(1, Math.abs(v)) * 0.85})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
      }
    });

    // labels
    ctx.fillStyle = 'rgba(200,208,220,0.6)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const nIn = layers[0].length;
    for (let j = 0; j < nIn; j++) ctx.fillText(j === nIn - 1 ? 'SPD' : `R${j + 1}`, padL - 10, rowY(j, nIn));
    const out = layers[layers.length - 1];
    const names = ['THR', 'STR'];
    ctx.textAlign = 'left';
    for (let j = 0; j < out.length; j++) {
      const y = rowY(j, out.length);
      ctx.fillStyle = 'rgba(200,208,220,0.6)';
      ctx.fillText(names[j] || `O${j}`, colX(layers.length - 1) + 12, y - 6);
      ctx.fillStyle = '#e8edf3';
      ctx.fillText((out[j] >= 0 ? '+' : '') + out[j].toFixed(2), colX(layers.length - 1) + 12, y + 6);
    }
  },
};
