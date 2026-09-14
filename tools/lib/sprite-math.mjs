// Pure image maths for tools/build-sprites.mjs. Image = {width, height, data: RGB Buffer}.
// Rects are {x0, y0, x1, y1} with exclusive x1/y1.

export const median = arr => {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function makeImage(width, height) {
  return { width, height, data: Buffer.alloc(width * height * 3) };
}

export function fillRect(img, x0, y0, x1, y1, [r, g, b]) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 3;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
    }
  }
}

export function getPixel(img, x, y) {
  const i = (y * img.width + x) * 3;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

// Threshold 10, not 30: the dry run showed faint anti-aliased line edges (values 10–30) otherwise survive as boxes.
const isLinePixel = (r, g, b) => Math.min(r, g, b) >= 10 && Math.max(r, g, b) - Math.min(r, g, b) <= 24;

// Separator lines in clawdio's sheets are neutral grey/white and run the full width or height.
// Detected lines are painted black together with `halo` px on each side.
export function removeGridLines(img, share = 0.85, halo = 2) {
  const { width: W, height: H, data } = img;
  const cols = [];
  const rows = [];
  for (let x = 0; x < W; x++) {
    let n = 0;
    for (let y = 0; y < H; y++) { const i = (y * W + x) * 3; if (isLinePixel(data[i], data[i + 1], data[i + 2])) n++; }
    if (n >= share * H) cols.push(x);
  }
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; if (isLinePixel(data[i], data[i + 1], data[i + 2])) n++; }
    if (n >= share * W) rows.push(y);
  }
  for (const x of cols) fillRect(img, Math.max(0, x - halo), 0, Math.min(W, x + halo + 1), H, [0, 0, 0]);
  for (const y of rows) fillRect(img, 0, Math.max(0, y - halo), W, Math.min(H, y + halo + 1), [0, 0, 0]);
  return { cols, rows };
}

// Most frequent bright, saturated colour, as the centre of a 16-level bucket: the body colour.
export function dominantColor(img, rect = { x0: 0, y0: 0, x1: img.width, y1: img.height }) {
  const hist = new Map();
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) {
      const [r, g, b] = getPixel(img, x, y);
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if (mx < 90 || mx - mn < 60) continue;
      const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      hist.set(k, (hist.get(k) || 0) + 1);
    }
  }
  let best = -1;
  let bestN = 0;
  for (const [k, n] of hist) if (n > bestN) { best = k; bestN = n; }
  if (best < 0) return null;
  return [((best >> 8) & 15) * 16 + 8, ((best >> 4) & 15) * 16 + 8, (best & 15) * 16 + 8];
}

export function colorMask(img, rect, color, tol = 70) {
  const w = rect.x1 - rect.x0;
  const h = rect.y1 - rect.y0;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = getPixel(img, rect.x0 + x, rect.y0 + y);
      if (Math.abs(r - color[0]) + Math.abs(g - color[1]) + Math.abs(b - color[2]) < tol) mask[y * w + x] = 1;
    }
  }
  return { mask, w, h };
}

// Largest 4-connected component: the body (arms and legs attached); floating effects are smaller.
export function largestComponent(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let best = null;
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue;
    let head = 0;
    let tail = 0;
    let n = 0;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    queue[tail++] = s;
    seen[s] = 1;
    while (head < tail) {
      const p = queue[head++];
      const x = p % w;
      const y = (p / w) | 0;
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; queue[tail++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; queue[tail++] = p + 1; }
      if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; queue[tail++] = p - w; }
      if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; queue[tail++] = p + w; }
    }
    if (!best || n > best.count) best = { count: n, x0, y0, x1, y1 };
  }
  return best;
}

export function measureBody(img, rect, color) {
  if (!color) return null;
  const { mask, w, h } = colorMask(img, rect, color);
  const c = largestComponent(mask, w, h);
  if (!c || c.count < 50) return null;
  const x0 = rect.x0 + c.x0;
  const x1 = rect.x0 + c.x1;
  const y0 = rect.y0 + c.y0;
  const y1 = rect.y0 + c.y1;
  return { x0, x1, y0, y1, width: x1 - x0 + 1, height: y1 - y0 + 1, cx: (x0 + x1 + 1) / 2, feet: y1 + 1 };
}

export function measureFrame(img) {
  return measureBody(img, { x0: 0, y0: 0, x1: img.width, y1: img.height }, dominantColor(img));
}

export function cellRects(img, cols = 4, rows = 2) {
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({
        x0: Math.round((c * img.width) / cols), x1: Math.round(((c + 1) * img.width) / cols),
        y0: Math.round((r * img.height) / rows), y1: Math.round(((r + 1) * img.height) / rows),
        row: r, col: c,
      });
    }
  }
  return out;
}

// A frame may use pixels between the midpoints to its row neighbours' body centres, so neighbours never bleed in.
export function frameMasks(bodies, cells, img, cols = 4) {
  return cells.map((cell, i) => ({
    x0: cell.col === 0 ? 0 : Math.round((bodies[i - 1].cx + bodies[i].cx) / 2),
    x1: cell.col === cols - 1 ? img.width : Math.round((bodies[i].cx + bodies[i + 1].cx) / 2),
    y0: cell.y0,
    y1: cell.y1,
  }));
}

export function sheetScale(bodies, targetWidth) {
  return targetWidth / median(bodies.map(b => b.width));
}

// 'frame': each frame on its own feet line. 'row': a row shares its lowest feet line (the ground), so drawn hops survive.
export function anchors(bodies, mode, cols = 4) {
  return bodies.map((b, i) => {
    if (mode !== 'row') return { cx: b.cx, feet: b.feet };
    const start = Math.floor(i / cols) * cols;
    return { cx: b.cx, feet: Math.max(...bodies.slice(start, start + cols).map(o => o.feet)) };
  });
}

// Body centre lands on column size/2, the feet line on row feetRow; samples x samples supersampling.
export function renderFrame(img, maskRect, scale, cx, feet, size = 256, feetRow = 214, samples = 3) {
  const out = makeImage(size, size);
  const inv = 1 / scale;
  const n = samples * samples;
  for (let v = 0; v < size; v++) {
    for (let u = 0; u < size; u++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < samples; sy++) {
        const y = Math.floor(feet + (v + (sy + 0.5) / samples - feetRow) * inv);
        if (y < maskRect.y0 || y >= maskRect.y1 || y < 0 || y >= img.height) continue;
        for (let sx = 0; sx < samples; sx++) {
          const x = Math.floor(cx + (u + (sx + 0.5) / samples - size / 2) * inv);
          if (x < maskRect.x0 || x >= maskRect.x1 || x < 0 || x >= img.width) continue;
          const i = (y * img.width + x) * 3;
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
        }
      }
      const o = (v * size + u) * 3;
      const R = Math.round(r / n);
      const G = Math.round(g / n);
      const B = Math.round(b / n);
      const floor = Math.max(R, G, B) < 12; // near-black noise and line halos become pure black
      out.data[o] = floor ? 0 : R;
      out.data[o + 1] = floor ? 0 : G;
      out.data[o + 2] = floor ? 0 : B;
    }
  }
  return out;
}

export function blit(src, dst, dx) {
  for (let y = 0; y < src.height; y++) src.data.copy(dst.data, (y * dst.width + dx) * 3, y * src.width * 3, (y + 1) * src.width * 3);
}
