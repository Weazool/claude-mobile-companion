// Rasterizer for Clawd's shapesAt() output (src/web/clawd/core.js): each shape is a rect in its own frame
// plus a 2x3 matrix, so it lands as a convex quad. Quads are polygon-filled with 3x3 supersampling and
// blended with their opacity, back to front, into an 8-bit RGB image that png.mjs's encodePng() writes.
import { encodePng } from './png.mjs';

const rgbCache = new Map();
export function rgb(hex) {
  let c = rgbCache.get(hex);
  if (!c) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map(x => x + x).join('') : h;
    c = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
    rgbCache.set(hex, c);
  }
  return c;
}

export function createImage(width, height, bg = '#000000') {
  const data = Buffer.alloc(width * height * 3);
  const [r, g, b] = rgb(bg);
  for (let i = 0; i < width * height; i++) {
    data[i * 3] = r;
    data[i * 3 + 1] = g;
    data[i * 3 + 2] = b;
  }
  return { width, height, data };
}

function blend(img, x, y, [r, g, b], a) {
  const i = (y * img.width + x) * 3;
  const d = img.data;
  d[i] = Math.round(d[i] + (r - d[i]) * a);
  d[i + 1] = Math.round(d[i + 1] + (g - d[i + 1]) * a);
  d[i + 2] = Math.round(d[i + 2] + (b - d[i + 2]) * a);
}

// A filled axis-aligned pixel rect, clipped to the image.
export function fillRect(img, x, y, w, h, color, a = 1) {
  const c = rgb(color);
  for (let py = Math.max(0, y); py < Math.min(img.height, y + h); py++) {
    for (let px = Math.max(0, x); px < Math.min(img.width, x + w); px++) blend(img, px, py, c, a);
  }
}

const SUB = [1 / 6, 1 / 2, 5 / 6];

// Draw shapes. The world point (view.x, view.y) lands on pixel (ox, oy); scale = pixels per unit.
// clip = { x0, y0, x1, y1 } in pixels keeps a contact-sheet cell from spilling into its neighbours.
export function drawShapes(img, shapes, { view, scale, ox = 0, oy = 0, clip = null, alpha = 1 }) {
  const cx0 = clip ? Math.max(0, clip.x0) : 0;
  const cy0 = clip ? Math.max(0, clip.y0) : 0;
  const cx1 = clip ? Math.min(img.width, clip.x1) : img.width;
  const cy1 = clip ? Math.min(img.height, clip.y1) : img.height;
  const X = new Float64Array(4);
  const Y = new Float64Array(4);
  for (const s of shapes) {
    const a = s.o * alpha;
    if (!(a > 0)) continue;
    const m = s.m;
    const lx = [s.x, s.x + s.w, s.x + s.w, s.x];
    const ly = [s.y, s.y, s.y + s.h, s.y + s.h];
    for (let k = 0; k < 4; k++) {
      X[k] = ox + (m[0] * lx[k] + m[2] * ly[k] + m[4] - view.x) * scale;
      Y[k] = oy + (m[1] * lx[k] + m[3] * ly[k] + m[5] - view.y) * scale;
    }
    // Orientation of the quad, so "inside" is the same side of every edge whichever way the matrix turns.
    const area = (X[1] - X[0]) * (Y[2] - Y[0]) - (Y[1] - Y[0]) * (X[2] - X[0]);
    if (Math.abs(area) < 1e-12) continue;
    const sg = area > 0 ? 1 : -1;
    const x0 = Math.max(cx0, Math.floor(Math.min(X[0], X[1], X[2], X[3])));
    const x1 = Math.min(cx1, Math.ceil(Math.max(X[0], X[1], X[2], X[3])));
    const y0 = Math.max(cy0, Math.floor(Math.min(Y[0], Y[1], Y[2], Y[3])));
    const y1 = Math.min(cy1, Math.ceil(Math.max(Y[0], Y[1], Y[2], Y[3])));
    const c = rgb(s.fill);
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        let hit = 0;
        for (const sy of SUB) {
          const qy = py + sy;
          for (const sx of SUB) {
            const qx = px + sx;
            let inside = true;
            for (let k = 0; k < 4 && inside; k++) {
              const j = (k + 1) & 3;
              inside = sg * ((X[j] - X[k]) * (qy - Y[k]) - (Y[j] - Y[k]) * (qx - X[k])) >= 0;
            }
            if (inside) hit++;
          }
        }
        if (hit) blend(img, px, py, c, (a * hit) / 9);
      }
    }
  }
  return img;
}

// The dashboard stage: near-black with a soft radial glow (style.css: circle at 50% 62%, glow -> stage by 70%).
export function fillStage(img, x0, y0, w, h, { stage = '#0a0a0f', glow = '#1a1622' } = {}) {
  const S = rgb(stage);
  const G = rgb(glow);
  const cx = x0 + w * 0.5;
  const cy = y0 + h * 0.62;
  const R = Math.hypot(w * 0.5, h * 0.62) * 0.7;
  for (let y = Math.max(0, y0); y < Math.min(img.height, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(img.width, x0 + w); x++) {
      const k = Math.min(1, Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / R);
      const i = (y * img.width + x) * 3;
      for (let ch = 0; ch < 3; ch++) img.data[i + ch] = Math.round(G[ch] + (S[ch] - G[ch]) * k);
    }
  }
}

// CSS filter: brightness(b) saturate(s) over a pixel rect, as the dashboard dims its stage while Clawd sleeps
// (style.css: .dim { filter: brightness(.32) saturate(.8) }).
export function dimRect(img, x0, y0, w, h, { brightness = 0.32, saturate = 0.8 } = {}) {
  const s = saturate;
  const M = [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
  ];
  const d = img.data;
  for (let y = Math.max(0, y0); y < Math.min(img.height, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(img.width, x0 + w); x++) {
      const i = (y * img.width + x) * 3;
      const r = d[i] * brightness;
      const g = d[i + 1] * brightness;
      const b = d[i + 2] * brightness;
      d[i] = Math.min(255, Math.round(M[0] * r + M[1] * g + M[2] * b));
      d[i + 1] = Math.min(255, Math.round(M[3] * r + M[4] * g + M[5] * b));
      d[i + 2] = Math.min(255, Math.round(M[6] * r + M[7] * g + M[8] * b));
    }
  }
}

// A 3x5 pixel font for labels: digits, lower-case letters and a little punctuation.
const FONT = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001111',
  a: '010101111101101', b: '110101110101110', c: '011100100100011', d: '110101101101110', e: '111100110100111',
  f: '111100110100100', g: '011100101101011', h: '101101111101101', i: '111010010010111', j: '001001001101010',
  k: '101101110101101', l: '100100100100111', m: '101111111101101', n: '110101101101101', o: '010101101101010',
  p: '110101110100100', q: '010101101110011', r: '110101110101101', s: '011100010001110', t: '111010010010010',
  u: '101101101101111', v: '101101101101010', w: '101101111111101', x: '101101010101101', y: '101101010010010',
  z: '111001010100111', '.': '000000000000010', ':': '000010000010000', '-': '000000111000000', _: '000000000000111',
  '/': '001001010100100', '@': '010101111100011', '(': '010100100100010', ')': '010001001001010', '=': '000111000111000',
  '+': '000010111010000', ' ': '000000000000000', '%': '101001010100101',
  '>': '100010001010100', '<': '001010100010001',
};
export function drawText(img, x, y, text, color = '#8a8a93', size = 2) {
  let cx = x;
  for (const ch of String(text).toLowerCase()) {
    const f = FONT[ch] || FONT[' '];
    for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) if (f[r * 3 + q] === '1') fillRect(img, cx + q * size, y + r * size, size, size, color);
    cx += 4 * size;
  }
  return cx;
}
export const textWidth = (text, size = 2) => String(text).length * 4 * size;

export const toPng = img => encodePng(img);
