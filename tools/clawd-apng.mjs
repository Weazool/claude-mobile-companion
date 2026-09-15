#!/usr/bin/env node
// Renders Clawd's animations to transparent animated PNGs (APNG), e.g. for the README.
// Usage: node tools/clawd-apng.mjs <name ...|all> [--height 96] [--fps 15] [--out docs/images/clawd]
// Each file is cropped to what the clip draws (flag, confetti and Zzz included) and loops forever; a one-shot
// rests for a moment before it plays again. Transparency comes from rendering every frame on black and on
// white: the difference is the coverage, so edges stay smooth on light and dark pages alike.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { ANIMS, NAMES, evalAnim, shapesAt, corners } from '../src/web/clawd/index.js';
import { createImage, drawShapes } from './lib/rast.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : d; };
const HEIGHT = Number(opt('height', 96));
const FPS = Number(opt('fps', 15));
const OUT = path.resolve(ROOT, opt('out', 'docs/images/clawd'));
const names = args.includes('all') ? NAMES : args;
if (!names.length) { console.error('usage: node tools/clawd-apng.mjs <name ...|all> [--height 96] [--fps 15] [--out dir]'); process.exit(2); }

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = buf => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

function apng(frames, w, h, delays) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(frames.length, 0); actl.writeUInt32BE(0, 4); // loop forever
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('acTL', actl)];
  let seq = 0;
  frames.forEach((rgba, i) => {
    const fc = Buffer.alloc(26);
    fc.writeUInt32BE(seq++, 0); fc.writeUInt32BE(w, 4); fc.writeUInt32BE(h, 8);
    fc.writeUInt16BE(Math.round(delays[i]), 20); fc.writeUInt16BE(1000, 22); // delay in ms
    fc[24] = 1; fc[25] = 0; // dispose to transparent, replace (no blending with the previous frame)
    parts.push(chunk('fcTL', fc));
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
    const z = zlib.deflateSync(raw, { level: 9 });
    if (i === 0) parts.push(chunk('IDAT', z));
    else { const s = Buffer.alloc(4); s.writeUInt32BE(seq++); parts.push(chunk('fdAT', Buffer.concat([s, z]))); }
  });
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

// The times to sample: a loop runs its cycle (after any intro); a one-shot plays through, then rests.
function times(def) {
  const step = 1000 / FPS;
  const t0 = def.loop ? def.loopFrom || 0 : 0;
  const out = [];
  for (let t = t0; t < def.dur - 1e-6; t += step) out.push(t);
  if (!def.loop) out.push(def.dur);
  return out;
}

fs.mkdirSync(OUT, { recursive: true });
for (const name of names) {
  const def = ANIMS[name];
  if (!def) { console.error(`unknown clip: ${name}`); process.exitCode = 1; continue; }
  const ts = times(def);
  const poses = ts.map(t => shapesAt(evalAnim(name, t, 1)).map(s => ({ ...s, m: [...s.m] })));
  // Crop to everything the clip draws, with a little air.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const shapes of poses) for (const s of shapes) if (s.o > 0.02) for (const [x, y] of corners(s)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const pad = 0.6;
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const scale = HEIGHT / (y1 - y0);
  const W = Math.ceil((x1 - x0) * scale);
  const H = Math.ceil((y1 - y0) * scale);
  const frames = poses.map(shapes => {
    const dark = drawShapes(createImage(W, H, '#000000'), shapes, { view: { x: x0, y: y0 }, scale });
    const light = drawShapes(createImage(W, H, '#ffffff'), shapes, { view: { x: x0, y: y0 }, scale });
    const rgba = Buffer.alloc(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const d = [dark.data[i * 3], dark.data[i * 3 + 1], dark.data[i * 3 + 2]];
      const l = [light.data[i * 3], light.data[i * 3 + 1], light.data[i * 3 + 2]];
      const a = 1 - (l[0] - d[0] + l[1] - d[1] + l[2] - d[2]) / (3 * 255);
      rgba[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
      for (let c = 0; c < 3; c++) rgba[i * 4 + c] = a > 0.004 ? Math.min(255, Math.round(d[c] / a)) : 0;
    }
    return rgba;
  });
  const delays = ts.map(() => 1000 / FPS);
  if (!def.loop) delays[delays.length - 1] = 900; // rest before the one-shot plays again
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, apng(frames, W, H, delays));
  console.log(`${name.padEnd(12)} ${String(frames.length).padStart(3)} frames  ${W}x${H}  ${(fs.statSync(file).size / 1024).toFixed(0)} KB  ${path.relative(ROOT, file)}`);
}
