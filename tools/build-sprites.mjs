#!/usr/bin/env node
// One-time sprite build (spec §9): re-cut clawdio's source sheets into normalised 256x256 frame strips.
// Usage: node tools/build-sprites.mjs          build, then check
//        node tools/build-sprites.mjs --check  check the committed output only
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './lib/png.mjs';
import {
  removeGridLines, cellRects, dominantColor, measureBody, frameMasks, anchors, renderFrame,
  blit, makeImage, measureFrame, median,
} from './lib/sprite-math.mjs';
import { SHEETS, MOTION_SHEETS, FRAME_SIZE, FRAMES } from '../src/web/anims.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'tools', '.cache');
const OUT = path.join(ROOT, 'src', 'web', 'sprites');
const REPO = 'cegware/clawdio';
const COMMIT = '76ee482fffa1cc602ca0dc524324a2880b9770e2';
const TARGET_WIDTH = 150; // body width incl. arms, in output px, for every sheet
const FEET_ROW = 214;     // output row of the feet line
// Source-px body width to use instead of the measured median, for a sheet whose body detection is wrong.
// Leave empty unless Step 4 says otherwise; overridden sheets skip the width check.
const BODY_WIDTH_OVERRIDE = {};

async function cached(rel) {
  const file = path.join(CACHE, rel.replace(/\//g, '_'));
  if (!fs.existsSync(file)) {
    const url = `https://raw.githubusercontent.com/${REPO}/${COMMIT}/${rel}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return fs.readFileSync(file);
}

function cropFrame(strip, i) {
  const f = makeImage(FRAME_SIZE, FRAME_SIZE);
  for (let y = 0; y < FRAME_SIZE; y++) {
    strip.data.copy(f.data, y * FRAME_SIZE * 3, (y * strip.width + i * FRAME_SIZE) * 3, (y * strip.width + (i + 1) * FRAME_SIZE) * 3);
  }
  return f;
}

function buildSheet(name, buf) {
  const img = decodePng(buf);
  const lines = removeGridLines(img);
  const cells = cellRects(img);
  const color = dominantColor(img);
  const bodies = cells.map(c => measureBody(img, c, color));
  const missing = bodies.findIndex(b => !b);
  if (missing >= 0) throw new Error(`${name}: no body found in frame ${missing}`);
  const masks = frameMasks(bodies, cells, img);
  const measured = median(bodies.map(b => b.width));
  const scale = TARGET_WIDTH / (BODY_WIDTH_OVERRIDE[name] || measured);
  const anc = anchors(bodies, MOTION_SHEETS.includes(name) ? 'row' : 'frame');
  const strip = makeImage(FRAME_SIZE * FRAMES, FRAME_SIZE);
  const frames = [];
  for (let i = 0; i < FRAMES; i++) {
    const f = renderFrame(img, masks[i], scale, anc[i].cx, anc[i].feet, FRAME_SIZE, FEET_ROW);
    frames.push(f);
    blit(f, strip, i * FRAME_SIZE);
  }
  return {
    strip, frames,
    meta: { source: `${img.width}x${img.height}`, color, lineCount: lines.cols.length + lines.rows.length, medianBodyWidth: measured, scale: +scale.toFixed(4) },
  };
}

// Acceptance (spec §9): median body width within ±2% of TARGET_WIDTH, resting feet within ±2 px, no line remnants.
function check(name, frames) {
  const bodies = frames.map(measureFrame);
  const problems = [];
  if (bodies.some(b => !b)) return { width: null, problems: ['body not found in an output frame'] };
  const width = median(bodies.map(b => b.width));
  if (!BODY_WIDTH_OVERRIDE[name] && Math.abs(width - TARGET_WIDTH) > TARGET_WIDTH * 0.02) problems.push(`median width ${width}, want ${TARGET_WIDTH} ±2%`);
  for (let row = 0; row < 2; row++) {
    const ground = Math.max(...bodies.slice(row * 4, row * 4 + 4).map(b => b.feet));
    if (Math.abs(ground - FEET_ROW) > 2) problems.push(`row ${row} ground at ${ground}, want ${FEET_ROW} ±2`);
  }
  frames.forEach((f, i) => {
    const l = removeGridLines({ ...f, data: Buffer.from(f.data) });
    if (l.cols.length || l.rows.length) problems.push(`frame ${i} has separator-line remnants`);
  });
  return { width, problems };
}

const checkOnly = process.argv.includes('--check');
fs.mkdirSync(OUT, { recursive: true });
const report = {};
let failed = false;
for (const name of SHEETS) {
  let frames;
  if (checkOnly) {
    const strip = decodePng(fs.readFileSync(path.join(OUT, `${name}.png`)));
    frames = Array.from({ length: FRAMES }, (_, i) => cropFrame(strip, i));
  } else {
    const built = buildSheet(name, await cached(`imgs/expr_${name}.png`));
    fs.writeFileSync(path.join(OUT, `${name}.png`), encodePng(built.strip));
    if (name === 'idle') fs.writeFileSync(path.join(ROOT, 'src', 'web', 'icon.png'), encodePng(built.frames[0]));
    report[name] = built.meta;
    frames = built.frames;
  }
  const c = check(name, frames);
  console.log(`${name.padEnd(12)} width ${String(c.width ?? '?').padStart(5)}  ${c.problems.length ? 'FAIL: ' + c.problems.join('; ') : 'ok'}`);
  if (c.problems.length) failed = true;
}
if (!checkOnly) {
  fs.writeFileSync(path.join(OUT, 'sprites.json'), JSON.stringify({
    source: { repo: REPO, commit: COMMIT, license: 'MIT' },
    frameSize: FRAME_SIZE, frames: FRAMES, targetBodyWidth: TARGET_WIDTH, feetRow: FEET_ROW, sheets: report,
  }, null, 2) + '\n');
  const licence = (await cached('LICENSE')).toString('utf8');
  fs.writeFileSync(path.join(OUT, 'LICENSE-clawdio.txt'), `Sprites derived from https://github.com/${REPO} (commit ${COMMIT}).\n\n${licence}`);
}
process.exit(failed ? 1 : 0);
