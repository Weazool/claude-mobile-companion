import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, loadSettings, saveSettings, rotationFor, nextRotation, STORAGE_KEY } from '../src/web/settings.js';
import { VIEW, PALETTE } from '../src/web/clawd/index.js';
import { decodePng } from '../tools/lib/png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEF = {
  mood: { warn: 50, low: 80, crit: 95, sleepAfterMin: 2, pinnedId: null },
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
  for (const [sel, d] of r) {
    for (const [k, v] of Object.entries(d)) if (v.includes('env(')) assert.match(k, /^--sa-[trbl]$/, `raw env() in ${sel} { ${k} }`);
  }
});

test('style: controls above the offline overlay, blank above everything, no settings panel', () => {
  const r = styleRules();
  const z = sel => Number((r.get(sel) || {})['z-index']);
  assert.equal(z('.overlay'), 50);
  assert.equal(z('.controls'), 55);
  assert.equal(z('.overlay.blank'), 80);
  const html = fs.readFileSync(path.join(ROOT, 'src/web/index.html'), 'utf8');
  assert.match(html, /<div id="offline" class="overlay"/);
  assert.match(html, /<div id="blank" class="overlay blank"/);
  assert.equal(r.get('.panel'), undefined, 'there is no settings panel');
  assert.doesNotMatch(html, /btnSettings|id="settings"/, 'no settings button or form');
  assert.equal(r.get('html')['touch-action'], 'manipulation');
  assert.equal(r.get('body')['touch-action'], 'manipulation');
});

test('style: the screensaver is black, inside #app, above the dashboard and below the overlays; the old dim is gone', () => {
  const r = styleRules();
  const saver = r.get('#saver');
  assert.equal(saver.background, '#000');
  assert.ok(Number(saver['z-index']) < 50, 'offline and blank overlays stay on top');
  assert.equal(r.get('#app.saver .controls').visibility, 'hidden');
  assert.equal(r.get('#app.dim'), undefined, 'asleep is the screensaver now, not a dimmed dashboard');
  assert.match(r.get('#app').transition, /translate 2s/, 'the burn-in drift is eased');
  const html = fs.readFileSync(path.join(ROOT, 'src/web/index.html'), 'utf8');
  const app = html.slice(html.indexOf('<main id="app"'), html.indexOf('</main>'));
  assert.match(app, /<div id="saver" hidden>.*class="saver-card".*id="saverLimits"/, '#saver rotates with #app');
});

// A length from style.css, in px, for a W x H #app: sums of cqw / cqh / cqmin / px, optionally inside min().
function lengthPx(expr, W, H) {
  const unit = { cqw: W / 100, cqh: H / 100, cqmin: Math.min(W, H) / 100, px: 1 };
  const sum = s => {
    const terms = [...s.matchAll(/([+-]?)\s*(\d*\.?\d+)(cqw|cqh|cqmin|px)\b/g)];
    assert.ok(terms.length, `no length in "${s}"`);
    return terms.reduce((t, [, sign, n, u]) => t + (sign === '-' ? -1 : 1) * Number(n) * unit[u], 0);
  };
  const m = /^min\((.*)\)$/.exec(expr.trim());
  return m ? Math.min(...m[1].split(',').map(a => sum(a.replace(/calc\(|\)/g, '')))) : sum(expr);
}

test('style: Clawd stands in the middle of the stage, as large as it allows, with the bubble as a caption under his feet', () => {
  const r = styleRules();
  const m = r.get('#mascot');
  assert.equal(m['mix-blend-mode'], undefined, 'an SVG has no black square to blend away');
  assert.equal(m['aspect-ratio'], '1');
  assert.deepEqual([m.width, m.height], ['var(--mascot)', 'var(--mascot)'], 'both set, so the square never depends on how a browser sizes an SVG');
  // His middle (y -5 of the viewBox -28..4) is 23/32 = 71.875% down the square; that point is the stage centre.
  assert.deepEqual([m.position, m.top], ['absolute', 'calc(50% - 0.71875 * var(--mascot))'], 'his middle is the stage centre');
  const b = r.get('.bubble');
  assert.equal(b.position, 'absolute', 'the bubble never pushes Clawd around when it comes and goes');
  assert.equal(b.top, 'calc(50% + 0.18 * var(--mascot))', 'a caption just under his feet (15.6% of the square below his middle)');
  // The bubble with text: line-height normal (at most 1.35 for these fonts), padding top and bottom, 1px borders.
  const bubbleH = (W, H) => 1.35 * lengthPx(b['font-size'], W, H) + 2 * lengthPx(b.padding.split(' ')[0], W, H) + 2;
  const FLAG_TIP = 0.19; // share of the square, from its top, that only Zzz and confetti tails ever reach
  const FEET = 0.875;    // the ground line, as a share of the square from its top
  const place = (S, M) => ({ top: S / 2 - 0.71875 * M, feet: S / 2 - 0.71875 * M + FEET * M, caption: S / 2 + 0.18 * M });
  const check = (label, S, M, W, H) => {
    const p = place(S, M);
    assert.ok(p.top + FLAG_TIP * M >= 0, `${label}: the flag's tip stays in view`);
    assert.ok(p.caption > p.feet, `${label}: the caption sits under his feet`);
    assert.ok(p.caption + bubbleH(W, H) <= S, `${label}: the caption stays inside the stage`);
  };
  // Landscape: the stage is the full-height 40% column.
  assert.equal(r.get('#app.landscape')['grid-template-columns'], '40% 60%');
  for (const [W, H] of [[844, 390], [667, 375], [932, 430], [1024, 768]]) {
    const M = lengthPx(r.get('#app.landscape .stage')['--mascot'], W, H);
    assert.ok(M <= 0.4 * W + 0.5 && M <= H, `${W}x${H}: the ${M.toFixed(1)}px square fits the column`);
    assert.ok(M >= 0.9 * Math.min(0.4 * W, H), `${W}x${H}: the square uses the column`);
    check(`${W}x${H}`, H, M, W, H);
  }
  // Portrait: the stage is the top 42%, and the controls sit in its top-right corner.
  assert.equal(r.get('#app.portrait')['grid-template-rows'], '42% minmax(0, 1fr)');
  for (const [W, H] of [[390, 844], [375, 667], [360, 800], [430, 932], [768, 1024], [800, 969]]) {
    const S = 0.42 * H, cq = Math.min(W, H) / 100;
    const M = lengthPx(r.get('#app.portrait .stage')['--mascot'], W, H);
    assert.ok(M >= 0.95 * Math.min(0.8 * W, S - 10 * cq), `${W}x${H}: the square uses the stage`);
    check(`${W}x${H}`, S, M, W, H);
    // The flag rises on his right (x +2..+8 of 32 units): it must stay left of the ✕ ⟲ row where the two meet.
    const flagRight = W / 2 + (8 / 32) * M, controlsLeft = W - 4 * cq - (2 * (4.4 + 2) + 1 * 3) * cq;
    if (place(S, M).top + FLAG_TIP * M < 9.4 * cq) assert.ok(flagRight <= controlsLeft, `${W}x${H}: the flag clears the controls`);
  }
});

test('page: Clawd is an inline SVG with the rig\'s viewBox, and every module the page loads exists', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/web/index.html'), 'utf8');
  const tag = /<svg id="mascot"[^>]*>/.exec(html);
  assert.ok(tag, 'svg#mascot');
  assert.match(tag[0], new RegExp(`viewBox="${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}"`));
  assert.match(tag[0], /role="img"/);
  assert.match(tag[0], /aria-label="Clawd"/);
  assert.doesNotMatch(html, /<canvas/);
  for (const [, p] of html.matchAll(/(?:src|href)="\/web\/([^"?]+)"/g)) assert.ok(fs.existsSync(path.join(ROOT, 'src/web', p)), `index.html loads missing /web/${p}`);
  const seen = new Set();
  const visit = file => {
    if (seen.has(file)) return;
    seen.add(file);
    assert.ok(fs.existsSync(file), `${path.relative(ROOT, file)} is imported but missing`);
    const src = fs.readFileSync(file, 'utf8');
    for (const [, spec] of src.matchAll(/\bimport\s*(?:[\w*{}\s,]+?\bfrom\s*)?['"](\.[^'"]+)['"]/g)) visit(path.resolve(path.dirname(file), spec));
  };
  visit(path.join(ROOT, 'src/web/app.js'));
  assert.ok(seen.has(path.join(ROOT, 'src/web/clawd/index.js')), 'app.js draws Clawd through clawd/index.js');
});

test('web manifest keeps the tokenised start URL (no start_url) and uses the icon', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/web/manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'fullscreen');
  assert.equal(m.start_url, undefined);
  assert.equal(m.icons[0].src, '/web/icon.png');
  assert.equal(m.icons[0].sizes, '256x256');
});

test('the Home Screen icon is Clawd at rest, centred on the stage colour', () => {
  const icon = decodePng(fs.readFileSync(path.join(ROOT, 'src/web/icon.png')));
  assert.deepEqual([icon.width, icon.height], [256, 256]);
  const at = (x, y) => [...icon.data.subarray((y * 256 + x) * 3, (y * 256 + x) * 3 + 3)];
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  for (const [x, y] of [[0, 0], [255, 0], [0, 255], [255, 255]]) assert.deepEqual(at(x, y), rgb(PALETTE.stage), `corner ${x},${y}`);
  assert.deepEqual(at(128, 128), rgb(PALETTE.body), 'his body in the middle');
});

test('the root background is the dashboard colour, so the strip iOS will not let a Home Screen app draw into blends in', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/web/style.css'), 'utf8');
  const r = styleRules();
  assert.equal(r.get('html').background, 'var(--bg)');
  assert.equal(r.get('#app').background, 'var(--bg)');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/web/manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.background_color, /--bg: (#[0-9a-f]{6})/i.exec(css)[1]);
});
