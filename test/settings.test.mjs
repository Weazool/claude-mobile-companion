import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, loadSettings, saveSettings, rotationFor, nextRotation, STORAGE_KEY } from '../src/web/settings.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEF = {
  mood: { warn: 50, low: 80, crit: 95, sleepAfterMin: 5, pinnedId: null },
  idle: { blinksPerMin: 26, glancesPerMin: 2, movingPct: 50 },
  rotation: 0, keepAwake: true,
};

test('defaults', () => {
  assert.deepEqual(validate({}), DEF);
  assert.deepEqual(validate(null), DEF);
});

test('clamps values and keeps thresholds ordered', () => {
  const v = validate({
    mood: { warn: 90, low: 50, crit: 10, sleepAfterMin: 0, pinnedId: 's9' },
    idle: { blinksPerMin: 999, glancesPerMin: -1, movingPct: 'x' },
    rotation: 45, keepAwake: false,
  });
  assert.deepEqual(v.mood, { warn: 90, low: 90, crit: 90, sleepAfterMin: 1, pinnedId: 's9' });
  assert.deepEqual(v.idle, { blinksPerMin: 60, glancesPerMin: 0, movingPct: 50 });
  assert.equal(v.rotation, 0);
  assert.equal(v.keepAwake, false);
  assert.deepEqual(validate({ mood: { warn: '', low: null } }).mood.warn, 50);
});

test('load and save through a storage; bad JSON gives defaults', () => {
  const mem = new Map();
  const storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.deepEqual(loadSettings(storage), DEF);
  const saved = saveSettings(storage, { ...DEF, rotation: 90, idle: { blinksPerMin: '30', glancesPerMin: 3, movingPct: 40 } });
  assert.deepEqual(saved.idle, { blinksPerMin: 30, glancesPerMin: 3, movingPct: 40 });
  assert.deepEqual(loadSettings(storage), saved);
  mem.set(STORAGE_KEY, '{nope');
  assert.deepEqual(loadSettings(storage), DEF);
  assert.deepEqual(loadSettings(null), DEF);
});

test('rotation geometry', () => {
  assert.deepEqual(rotationFor(0, 390, 844), { w: 390, h: 844, layout: 'portrait' });
  assert.deepEqual(rotationFor(90, 390, 844), { w: 844, h: 390, layout: 'landscape' });
  assert.deepEqual(rotationFor(180, 844, 390), { w: 844, h: 390, layout: 'landscape' });
  assert.deepEqual([0, 90, 180, 270].map(nextRotation), [90, 180, 270, 0]);
});

// selector -> merged declarations, for the flat rules of style.css (comments stripped).
function cssRules(css) {
  const rules = new Map();
  for (const [, sel, body] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = {};
    for (const d of body.split(';')) {
      const i = d.indexOf(':');
      if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim().replace(/\s+/g, ' ');
    }
    for (const s of sel.split(',').map(x => x.trim().replace(/\s+/g, ' '))) rules.set(s, { ...rules.get(s), ...decls });
  }
  return rules;
}
const styleRules = () => cssRules(fs.readFileSync(path.join(ROOT, 'src/web/style.css'), 'utf8'));

test('style: safe-area insets are mapped onto #app edges per rotation', () => {
  const r = styleRules();
  const side = { t: 'top', r: 'right', b: 'bottom', l: 'left' };
  // #app turns clockwise: at 90 deg its top edge faces the physical right, and so on.
  const faces = { rot0: 'trbl', rot90: 'rblt', rot180: 'bltr', rot270: 'ltrb' };
  for (const [cls, f] of Object.entries(faces)) {
    const d = r.get(`#app.${cls}`) || {};
    [...'trbl'].forEach((edge, i) => assert.equal(d[`--sa-${edge}`], `env(safe-area-inset-${side[f[i]]}, 0px)`, `${cls} --sa-${edge}`));
  }
  const app = r.get('#app');
  assert.equal(app['box-sizing'], 'border-box');
  assert.equal(app.padding, 'var(--sa-t) var(--sa-r) var(--sa-b) var(--sa-l)');
  assert.equal(r.get('.controls').top, 'calc(3cqmin + var(--sa-t))');
  assert.equal(r.get('.controls').right, 'calc(4cqmin + var(--sa-r))');
  assert.equal(r.get('#app.portrait .stage')['padding-top'], '12cqmin');
  for (const [sel, d] of r) {
    for (const [k, v] of Object.entries(d)) if (v.includes('env(')) assert.match(k, /^--sa-[trbl]$/, `raw env() in ${sel} { ${k} }`);
  }
});

test('style: controls above the offline overlay, blank above everything, no iOS zoom', () => {
  const r = styleRules();
  const z = sel => Number((r.get(sel) || {})['z-index']);
  assert.equal(z('.overlay'), 50);
  assert.equal(z('.controls'), 55);
  assert.equal(z('.panel'), 60);
  assert.equal(z('.overlay.blank'), 80);
  const html = fs.readFileSync(path.join(ROOT, 'src/web/index.html'), 'utf8');
  assert.match(html, /<div id="offline" class="overlay"/);
  assert.match(html, /<div id="blank" class="overlay blank"/);
  assert.equal(r.get('.panel input[type=number]')['font-size'], '16px');
  assert.equal(r.get('.panel select')['font-size'], '16px');
  assert.equal(r.get('html')['touch-action'], 'manipulation');
  assert.equal(r.get('body')['touch-action'], 'manipulation');
});

test('web manifest keeps the tokenised start URL (no start_url) and uses the icon', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/web/manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'fullscreen');
  assert.equal(m.start_url, undefined);
  assert.equal(m.icons[0].src, '/web/icon.png');
});
