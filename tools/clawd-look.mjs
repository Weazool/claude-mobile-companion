#!/usr/bin/env node
// Look at Clawd's animations without a browser: renders contact sheets (or single frames) to PNG.
// Usage:
//   node tools/clawd-look.mjs <name ...|all> [--frames 10] [--scale 10] [--cols 5] [--seed 1] [--onion] [--dim] [--out DIR]
//       one contact sheet per clip: N frames sampled across one duration (loops: 0 .. dur minus a step;
//       one-shots: 0 .. dur inclusive), each labelled with its time in ms, on the dashboard's stage.
//       A loop with an intro (loopFrom) shows it first; its seam is the step from the last cell back to loopFrom.
//       --onion adds a cell with every sampled frame laid over each other, to judge arcs and spacing.
//       --span 400:1000 samples only that window (ms), to study one stride or one landing.
//       --dim draws the stage as the dashboard dims it while Clawd sleeps (brightness .32, saturate .8).
//   node tools/clawd-look.mjs --at <name>:<ms> [--scale 24] [--seed 1] [--out DIR]
//       one large frame.
//   node tools/clawd-look.mjs --switch <from>:<to>[:<ms>] [--scale 6] [--out DIR]
//       the real Player switching base from one clip to the other <ms> into the first (default 1200), every
//       second 60 fps frame through the blend: the way the dashboard changes state. "needs" is the needs-you
//       base (surprised and curious in turn); a one-shot <to> plays over the <from> base.
//   node tools/clawd-look.mjs --icon <px> [--out DIR]
//       DIR/icon.png: the rest pose centred on the stage colour, px square, his width (arms included) across
//       3/4 of it. The Home Screen icon is `--icon 256 --out src/web`.
// DIR defaults to <os tmp>/clawd-look. Prints every clip's duration and the files it wrote.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ANIMS, NAMES, INTERNAL, VIEW, PALETTE, Player, evalAnim, shapesAt, rest, corners } from '../src/web/clawd/index.js';
import { createImage, drawShapes, fillStage, fillRect, drawText, dimRect, toPng } from './lib/rast.mjs';

function parse(argv) {
  const o = { names: [], frames: 10, scale: null, cols: 5, seed: 1, onion: false, dim: false, out: path.join(os.tmpdir(), 'clawd-look'), at: [], switches: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--frames') o.frames = Math.max(1, parseInt(val(), 10));
    else if (a === '--scale') o.scale = Math.max(1, parseFloat(val()));
    else if (a === '--cols') o.cols = Math.max(1, parseInt(val(), 10));
    else if (a === '--seed') o.seed = parseInt(val(), 10) >>> 0;
    else if (a === '--out') o.out = val();
    else if (a === '--onion') o.onion = true;
    else if (a === '--dim') o.dim = true;
    else if (a === '--span') {
      const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(val());
      if (!m || +m[2] <= +m[1]) throw new Error('--span wants from:to in ms, e.g. --span 400:1000');
      o.span = [+m[1], +m[2]];
    }
    else if (a === '--at') {
      const m = /^([\w-]+):(\d+(?:\.\d+)?)$/.exec(val());
      if (!m) throw new Error('--at wants name:ms, e.g. --at hop:420');
      o.at.push({ name: m[1], ms: parseFloat(m[2]) });
    } else if (a === '--switch') {
      const m = /^([\w-]+):([\w-]+)(?::(\d+(?:\.\d+)?))?$/.exec(val());
      if (!m) throw new Error('--switch wants from:to[:ms], e.g. --switch thinking:working:1500');
      o.switches.push({ from: m[1], to: m[2], ms: m[3] ? parseFloat(m[3]) : 1200 });
    } else if (a === '--icon') {
      o.icon = parseInt(val(), 10);
      if (!(o.icon >= 16 && o.icon <= 2048)) throw new Error('--icon wants a size in px, e.g. --icon 256');
    } else if (a === '-h' || a === '--help') o.help = true;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else o.names.push(a);
  }
  return o;
}

const kind = d => `${d.loop ? `loop${d.loopFrom ? ` from ${d.loopFrom}` : ''}` : d.next ? `once -> ${d.next}` : 'once'}${d.grounded ? ', grounded' : ''}`;

// Stage, a faint ground line and a centre tick, so feet, walks and hops can be judged against the floor.
function drawCell(img, x0, y0, scale, shapesList, { label, alpha = 1, dim = false } = {}) {
  const w = Math.round(VIEW.w * scale);
  const h = Math.round(VIEW.h * scale);
  fillStage(img, x0, y0, w, h, { stage: PALETTE.stage, glow: PALETTE.glow });
  const gy = y0 + Math.round((0 - VIEW.y) * scale);
  fillRect(img, x0, gy, w, 1, '#2a2a36');
  const cx = x0 + Math.round((0 - VIEW.x) * scale);
  fillRect(img, cx, gy + 1, 1, Math.max(2, Math.round(scale / 2)), '#3a3a48');
  for (const shapes of shapesList) {
    drawShapes(img, shapes, { view: VIEW, scale, ox: x0, oy: y0, clip: { x0, y0, x1: x0 + w, y1: y0 + h }, alpha });
  }
  if (dim) dimRect(img, x0, y0, w, h);
  if (label) drawText(img, x0 + 6, y0 + 6, label, '#8a8a93', Math.max(1, Math.round(scale / 5)));
  return { w, h };
}

function grid(title, cells, scale, cols, dim) {
  cols = Math.min(cols, cells.length);
  const rows = Math.ceil(cells.length / cols);
  const cw = Math.round(VIEW.w * scale);
  const ch = Math.round(VIEW.h * scale);
  const gap = 2;
  const head = Math.max(14, Math.round(scale * 2.2));
  const img = createImage(cols * cw + (cols + 1) * gap, head + rows * ch + (rows + 1) * gap, '#1e1e26');
  const ts = Math.max(2, Math.round(scale / 4));
  drawText(img, gap + 4, Math.round((head - 5 * ts) / 2), title, '#c9c3ba', ts);
  cells.forEach((c, i) => {
    const x0 = gap + (i % cols) * (cw + gap);
    const y0 = head + gap + Math.floor(i / cols) * (ch + gap);
    drawCell(img, x0, y0, scale, c.shapes, { label: c.label, alpha: c.alpha, dim });
  });
  return img;
}

function sheet(name, o) {
  const def = ANIMS[name];
  const scale = o.scale || 10;
  const n = o.frames;
  const [a, b] = o.span ? [Math.min(o.span[0], def.dur), Math.min(o.span[1], def.dur)] : [0, def.dur];
  const times = Array.from({ length: n }, (_, i) => a + (def.loop && !o.span ? ((b - a) * i) / n : n === 1 ? 0 : ((b - a) * i) / (n - 1)));
  const frames = times.map(t => shapesAt(evalAnim(name, t, o.seed)).map(s => ({ ...s, m: [...s.m] })));
  const cells = frames.map((shapes, i) => ({ shapes: [shapes], label: `${Math.round(times[i])}` }));
  if (o.onion) cells.push({ shapes: frames, label: 'onion', alpha: Math.max(0.12, 1.6 / n) });
  const spanText = o.span ? `  span ${a}-${b}` : '';
  return grid(`${name}  ${def.dur}ms  ${kind(def)}  seed ${o.seed}${spanText}${o.dim ? '  dimmed' : ''}`, cells, scale, o.cols, o.dim);
}

function single(name, ms, o) {
  const scale = o.scale || 24;
  const img = createImage(Math.round(VIEW.w * scale), Math.round(VIEW.h * scale), PALETTE.stage);
  drawCell(img, 0, 0, scale, [shapesAt(evalAnim(name, ms, o.seed))], { label: `${name} ${ms}`, dim: o.dim });
  return img;
}

// The Home Screen icon: the rest pose on the flat stage colour, centred on his own bounding box and scaled so
// his width (arms included, 16 units) spans 3/4 of the icon: 12 px per unit at 256, which keeps his edges on
// whole pixels.
function icon(px) {
  const shapes = shapesAt(rest());
  const pts = shapes.flatMap(s => corners(s));
  const x0 = Math.min(...pts.map(p => p[0]));
  const x1 = Math.max(...pts.map(p => p[0]));
  const y0 = Math.min(...pts.map(p => p[1]));
  const y1 = Math.max(...pts.map(p => p[1]));
  const scale = (0.75 * px) / (x1 - x0);
  const view = { x: (x0 + x1) / 2 - px / 2 / scale, y: (y0 + y1) / 2 - px / 2 / scale };
  return drawShapes(createImage(px, px, PALETTE.stage), shapes, { view, scale });
}

// The real Player switching base, sampled every second 60 fps frame from just before the switch to the end of the blend.
function switchStrip({ from, to, ms }, o) {
  const FRAME = 1000 / 60;
  let s = o.seed || 1;
  const rand = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const pl = new Player({ rand, idle: { blinksPerMin: 0, glancesPerMin: 0, movingPct: 5 } });
  const base = n => (n === 'needs' ? ['surprised', 'curious'] : n);
  pl.setBase(base(from));
  const cells = [];
  let end = Infinity;
  for (let t = 0, i = 0; t < end; t += FRAME, i++) {
    if (t < ms && t + FRAME >= ms) {
      if (to === 'needs' || (ANIMS[to] && ANIMS[to].loop)) pl.setBase(base(to));
      else pl.play(to);
      end = t + (pl.blend ? pl.blend.dur : 0) + 300;
    }
    pl.update(FRAME);
    const shapes = pl.shapes().map(x => ({ ...x, m: [...x.m] }));
    if (t >= ms - 3 * FRAME && i % 2 === 0) cells.push({ shapes: [shapes], label: `${Math.round(t - ms)} ${pl.cur.hold ? 'idle' : pl.cur.name}${pl.blend ? ' b' : ''}` });
  }
  return grid(`${from} -> ${to} at ${ms} ms  (ms after the switch; b = blending)`, cells, o.scale || 6, 12, o.dim);
}

function main() {
  const o = parse(process.argv.slice(2));
  const known = Object.keys(ANIMS);
  if (o.help || (!o.names.length && !o.at.length && !o.switches.length && !o.icon)) {
    console.log('usage: node tools/clawd-look.mjs <name ...|all> [--frames 10] [--scale 10] [--cols 5] [--seed 1] [--onion] [--span from:to] [--dim] [--out DIR]');
    console.log('       node tools/clawd-look.mjs --at <name>:<ms> [--scale 24] [--out DIR]');
    console.log('       node tools/clawd-look.mjs --switch <from>:<to>[:<ms>] [--scale 6] [--out DIR]');
    console.log('       node tools/clawd-look.mjs --icon <px> [--out DIR]     (the Home Screen icon: --icon 256 --out src/web)');
    console.log(`clips: ${known.join(', ')}`);
    return;
  }
  const names = o.names.includes('all') ? known : o.names;
  for (const n of [...names, ...o.at.map(a => a.name), ...o.switches.flatMap(s => [s.from, s.to]).filter(x => x !== 'needs')]) {
    if (!ANIMS[n]) throw new Error(`unknown clip ${n}${NAMES.includes(n) ? ' (named in the brief, not registered yet)' : ''}`);
  }
  fs.mkdirSync(o.out, { recursive: true });
  const pad = Math.max(...known.map(n => n.length));
  for (const n of names) {
    const file = path.join(o.out, `${n}.png`);
    fs.writeFileSync(file, toPng(sheet(n, o)));
    console.log(`${n.padEnd(pad)}  ${String(ANIMS[n].dur).padStart(5)} ms  ${kind(ANIMS[n]).padEnd(22)}  ${file}`);
  }
  for (const { name, ms } of o.at) {
    const file = path.join(o.out, `${name}@${ms}.png`);
    fs.writeFileSync(file, toPng(single(name, ms, o)));
    console.log(`${name.padEnd(pad)}  ${String(ANIMS[name].dur).padStart(5)} ms  at ${ms} ms  ${file}`);
  }
  for (const sw of o.switches) {
    const file = path.join(o.out, `switch_${sw.from}_${sw.to}.png`);
    fs.writeFileSync(file, toPng(switchStrip(sw, o)));
    console.log(`${`${sw.from} -> ${sw.to}`.padEnd(pad)}  at ${sw.ms} ms  ${file}`);
  }
  if (o.icon) {
    const file = path.join(o.out, 'icon.png');
    fs.writeFileSync(file, toPng(icon(o.icon)));
    console.log(`${'icon'.padEnd(pad)}  ${o.icon}x${o.icon}  ${file}`);
  }
  const pending = NAMES.filter(n => !ANIMS[n]);
  if (o.names.includes('all') && pending.length) console.log(`not registered yet: ${pending.join(', ')}`);
  if (o.names.includes('all')) console.log(`internal: ${INTERNAL.filter(n => ANIMS[n]).join(', ') || 'none'}`);
}

try {
  main();
} catch (e) {
  console.error(`clawd-look: ${e.message}`);
  process.exit(1);
}
