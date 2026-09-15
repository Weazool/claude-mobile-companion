import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server/http.mjs';
import { BEHAVIOURS, DEFAULT_MAP, allowedClips, clipsFrom } from '../src/web/behaviours.js';
import { ANIMS, NAMES, shapesAt, evalAnim, loopTime, mixPose } from '../src/web/clawd/index.js';
import {
  PREVIEW, humanName, formatSeconds, clipKind, optionLabel, describeValue, slotHint,
  previewProgram, previewPose, galleryProgram, usedBy, sameValue, unsavedKeys, savedMessage, saveError,
} from '../src/web/behaviours-page.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const CLIPS = clipsFrom(ANIMS, NAMES);
const TOKEN = 'e'.repeat(32);

// ---------- static checks: the page, its module and the pair page's link ----------

test('the behaviours page loads its module from /web/, and nothing from the network', () => {
  const html = read('src/web/behaviours.html');
  assert.match(html, /<script type="module" src="\/web\/behaviours-page\.js"><\/script>/);
  assert.match(html, /<title>Clawd’s behaviours/);
  assert.doesNotMatch(html, /(?:src|href)="(?:https?:)?\/\//, 'offline: no external scripts, styles or fonts');
  assert.doesNotMatch(html, /@import|url\(\s*["']?https?:/, 'offline: no external CSS');
});

test('the page has its header controls: a disabled Save, Reset to defaults and a live status line', () => {
  const html = read('src/web/behaviours.html');
  assert.match(html, /<h1[^>]*>Clawd’s behaviours<\/h1>/);
  assert.match(html, /<button id="save"[^>]*\bdisabled\b[^>]*>Save<\/button>/);
  assert.match(html, /<button id="reset"[^>]*>Reset to defaults<\/button>/);
  assert.match(html, /id="status"[^>]*role="status"/);
  // Every element the module looks up by id.
  const ids = [...read('src/web/behaviours-page.js').matchAll(/\$\('([a-z]+)'\)/g)].map(m => m[1]);
  assert.deepEqual([...new Set(ids)].sort(), ['gallery', 'groups', 'jump', 'logo', 'reset', 'save', 'status', 'top']);
  for (const id of ids) assert.match(html, new RegExp(`id="${id}"`), id);
});

test('the page module imports the rig and the behaviour table by relative paths that resolve under /web/', () => {
  const js = read('src/web/behaviours-page.js');
  const imports = [...js.matchAll(/^import [^;]* from '([^']+)';$/mg)].map(m => m[1]);
  assert.deepEqual(imports.sort(), ['./behaviours.js', './clawd/index.js']);
  for (const p of imports) assert.ok(fs.existsSync(path.join(ROOT, 'src/web', p)), p);
});

test('the page builds text with textContent only: no HTML is ever parsed from data', () => {
  const js = read('src/web/behaviours-page.js');
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(read('src/web/behaviours.html'), /innerHTML/);
});

test('the page loads with GET and saves with POST /api/behaviours, as JSON', () => {
  const js = read('src/web/behaviours-page.js');
  assert.match(js, /fetch\('\/api\/behaviours'\)/);
  assert.match(js, /fetch\('\/api\/behaviours', \{ method: 'POST'/);
  assert.match(js, /'content-type': 'application\/json'/);
  assert.match(js, /reset: true/);
});

test('the pair page links to the behaviours editor', () => {
  const html = read('src/web/pair.html');
  assert.match(html, /<a href="\/behaviours"[^>]*>Customise Clawd’s behaviours →<\/a>/);
});

test('the README explains how to customise Clawd', () => {
  const md = read('README.md');
  assert.match(md, /\n## Customise Clawd\n/);
  assert.ok(md.includes('http://localhost:<port>/behaviours'));
  assert.ok(md.includes('~/.desk-companion/behaviours.json'));
});

// ---------- the real page through the real server: loopback only, and its modules are served ----------

function get(port, p, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method: 'GET', path: p, headers }, res => {
      let b = '';
      res.on('data', d => { b += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.setTimeout(3000, () => r.destroy(new Error(`no response to GET ${p}`)));
    r.on('error', reject);
    r.end();
  });
}

test('/behaviours is loopback only, and on loopback it serves the page and every module it imports', async t => {
  let loop = false;
  const app = createApp({
    token: TOKEN, webRoot: path.join(ROOT, 'src/web'),
    getSnapshot: () => ({ v: 1 }), onHook() {}, onDevLimits() {}, getPairInfo: () => ({ urls: [] }),
    getBehaviours: () => ({ ...DEFAULT_MAP }), setBehaviours: m => m,
    isLoopbackReq: () => loop,
  });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(() => app.close());
  const port = app.server.address().port;
  assert.equal((await get(port, `/behaviours?k=${TOKEN}`)).status, 403, 'a LAN client, even with the token');
  loop = true;
  assert.equal((await get(port, '/behaviours', { host: `evil.example:${port}` })).status, 403, 'a foreign Host');
  const page = await get(port, '/behaviours', { host: `localhost:${port}` });
  assert.equal(page.status, 200);
  assert.equal(page.body, read('src/web/behaviours.html'));
  // The module graph, resolved from the page's URL as a browser does.
  const seen = new Set();
  const walk = async url => {
    if (seen.has(url)) return;
    seen.add(url);
    const r = await get(port, url, { host: `localhost:${port}` });
    assert.equal(r.status, 200, url);
    assert.match(r.headers['content-type'], /text\/javascript/, url);
    for (const m of r.body.matchAll(/^(?:import|export)\b[^;'"]*?from '([^']+)'|^import '([^']+)'/mg)) {
      await walk(new URL(m[1] || m[2], `http://x${url}`).pathname);
    }
  };
  await walk('/web/behaviours-page.js');
  for (const p of ['/web/behaviours.js', '/web/clawd/index.js', '/web/clawd/core.js', '/web/clawd/svg.js', '/web/clawd/anims/feelings.js']) {
    assert.ok(seen.has(p), p);
  }
});

// ---------- labels ----------

test('clip names read as words, and durations as seconds', () => {
  assert.equal(humanName('look_left'), 'look left');
  assert.equal(humanName('happy_eyes'), 'happy eyes');
  assert.equal(humanName('love'), 'love');
  assert.equal(formatSeconds(160), '0.16 s');
  assert.equal(formatSeconds(900), '0.9 s');
  assert.equal(formatSeconds(1230), '1.23 s');
  assert.equal(formatSeconds(2000), '2 s');
});

test('clipKind names what a clip does: loop, once, → its successor, or holds still', () => {
  assert.equal(clipKind('thinking'), 'loop');
  assert.equal(clipKind('sleeping'), 'loop');
  assert.equal(clipKind('surprised'), 'once');
  assert.equal(clipKind('jumping_joy'), '→ happy');
  assert.equal(clipKind('celebration'), '→ happy');
  assert.equal(clipKind('idle'), 'holds still');
});

test('options: one-shots say "plays once" in base slots only, chained clips name their successor everywhere', () => {
  assert.equal(optionLabel('thinking', 'base'), 'thinking');
  assert.equal(optionLabel('yawning', 'base'), 'yawning · plays once');
  assert.equal(optionLabel('look_left', 'base'), 'look left · plays once');
  assert.equal(optionLabel('idle', 'base'), 'idle · holds still');
  assert.equal(optionLabel('jumping_joy', 'base'), 'jumping joy → happy');
  assert.equal(optionLabel('surprised', 'play'), 'surprised');
  assert.equal(optionLabel('surprised', 'alt'), 'surprised');
  assert.equal(optionLabel('celebration', 'pick'), 'celebration → happy');
  assert.equal(optionLabel('love', 'seq'), 'love');
});

test('a value reads as its slot plays it', () => {
  assert.equal(describeValue('base', 'happy_eyes'), 'happy eyes');
  assert.equal(describeValue('alt', ['surprised', 'curious']), 'surprised ↔ curious');
  assert.equal(describeValue('seq', ['yawning', 'surprised', 'love']), 'yawning → surprised → love');
  assert.equal(describeValue('pick', ['love', 'surprised', 'curious']), 'love, surprised or curious');
  assert.equal(describeValue('pick', ['walk', 'hop']), 'walk or hop');
  assert.equal(describeValue('pick', ['hop']), 'hop');
});

test('the slot hint explains what the slot does with the current choice', () => {
  assert.equal(slotHint('base', 'thinking'), 'Loops while this lasts');
  assert.equal(slotHint('base', 'yawning'), 'Plays once, then he holds still');
  assert.equal(slotHint('base', 'jumping_joy'), 'Plays once, then happy loops');
  assert.equal(slotHint('base', 'idle'), 'He holds still, with calm idle on top');
  assert.equal(slotHint('play', 'surprised'), 'Plays once');
  assert.equal(slotHint('play', 'celebration'), 'Plays once, then happy loops');
  assert.equal(slotHint('alt', ['surprised']), 'Takes turns · up to 3');
  assert.equal(slotHint('seq', ['love']), 'Plays in order · up to 3');
  assert.equal(slotHint('pick', ['love']), 'One at random each time · up to 4');
});

// ---------- previews ----------

const clipsOf = prog => (prog.loop ? [prog.loop] : prog.steps.map(s => s.clip));

test('previews: a base loop plays on, with its intro once', () => {
  assert.deepEqual(previewProgram('base', 'thinking'), { loop: 'thinking' });
  assert.deepEqual(previewProgram('base', 'cool'), { loop: 'cool' });
  const p = previewPose({ loop: 'cool' }, ANIMS.cool.dur + 1000);
  assert.deepEqual(p, evalAnim('cool', loopTime(ANIMS.cool, ANIMS.cool.dur + 1000), 1));
});

test('previews: a one-shot replays after a short pause, in base and play slots', () => {
  const base = previewProgram('base', 'yawning');
  assert.deepEqual(clipsOf(base), ['yawning', null]);
  assert.deepEqual(base.steps.map(s => s.ms), [ANIMS.yawning.dur, PREVIEW.pauseMs.base]);
  const play = previewProgram('play', 'surprised');
  assert.deepEqual(clipsOf(play), ['surprised', null]);
  assert.equal(play.steps[1].ms, PREVIEW.pauseMs.play);
  assert.equal(play.total, ANIMS.surprised.dur + PREVIEW.pauseMs.play);
});

test('previews: alt takes turns with no pause, one pass of each', () => {
  const prog = previewProgram('alt', ['surprised', 'thinking']);
  assert.deepEqual(clipsOf(prog), ['surprised', 'thinking']);
  assert.deepEqual(prog.steps.map(s => [s.at, s.ms]), [[0, ANIMS.surprised.dur], [ANIMS.surprised.dur, ANIMS.thinking.dur]]);
});

test('previews: seq plays in order, then pauses; pick cycles through its entries with a pause after each', () => {
  assert.deepEqual(clipsOf(previewProgram('seq', ['yawning', 'surprised', 'love'])), ['yawning', 'surprised', 'love', null]);
  assert.equal(previewProgram('seq', ['love']).steps.at(-1).ms, PREVIEW.pauseMs.seq);
  assert.deepEqual(clipsOf(previewProgram('pick', ['love', 'hop'])), ['love', null, 'hop', null]);
  assert.equal(previewProgram('pick', ['love']).steps[1].ms, PREVIEW.pauseMs.pick);
});

test('previews: a chained one-shot shows one pass of its successor', () => {
  const prog = previewProgram('play', 'jumping_joy');
  assert.deepEqual(clipsOf(prog), ['jumping_joy', 'happy', null]);
  assert.equal(prog.steps[1].ms, ANIMS.happy.dur);
  assert.deepEqual(clipsOf(previewProgram('seq', ['celebration', 'love'])), ['celebration', 'happy', 'love', null]);
});

test('previews: idle holds still with the configured blink in the middle of the hold', () => {
  assert.deepEqual(previewProgram('base', 'idle').steps, [{ clip: null, at: 0, ms: PREVIEW.holdMs, blink: 'blink' }]);
  const prog = previewProgram('base', 'idle', { blink: 'hop' });
  assert.equal(prog.steps.length, 1);
  assert.equal(prog.steps[0].blink, 'hop');
  const mid = PREVIEW.blinkAt + ANIMS.hop.dur / 2;
  assert.deepEqual(previewPose(prog, mid), evalAnim('hop', ANIMS.hop.dur / 2, 1));
  assert.deepEqual(shapesAt(previewPose(prog, 10)), shapesAt(evalAnim('idle', 0)), 'rest before the blink');
  const long = previewProgram('base', 'idle', { blink: 'walk' });
  assert.ok(long.steps[0].ms >= PREVIEW.blinkAt + ANIMS.walk.dur + 300, 'a long clip finishes inside the hold');
  assert.deepEqual(clipsOf(previewProgram('alt', ['idle', 'love'])), [null, 'love']);
});

test('previews: a step blends in from the previous one, then plays the clip itself', () => {
  const prog = previewProgram('alt', ['thinking', 'curious']);
  const at = ANIMS.thinking.dur;
  const end = evalAnim('thinking', ANIMS.thinking.dur, 1);
  assert.deepEqual(previewPose(prog, at), mixPose(end, evalAnim('curious', 0, 2), 0));
  assert.deepEqual(previewPose(prog, at + PREVIEW.blendMs + 50), evalAnim('curious', PREVIEW.blendMs + 50, 2));
  const mid = previewPose(prog, at + PREVIEW.blendMs / 2);
  assert.notDeepEqual(mid, evalAnim('curious', PREVIEW.blendMs / 2, 2));
  // The second cycle blends from the last step back into the first, with fresh seeds.
  const cycle2 = previewPose(prog, prog.total + PREVIEW.blendMs + 10);
  assert.deepEqual(cycle2, evalAnim('thinking', PREVIEW.blendMs + 10, 3));
});

test('the gallery plays each clip on its own: loops loop, one-shots replay after a pause, idle holds still', () => {
  assert.deepEqual(galleryProgram('thinking'), { loop: 'thinking' });
  assert.deepEqual(galleryProgram('idle'), { loop: 'idle' });
  assert.deepEqual(clipsOf(galleryProgram('love')), ['love', null]);
  const j = galleryProgram('jumping_joy');
  assert.deepEqual(clipsOf(j), ['jumping_joy', null], 'without its successor: the card is about the clip itself');
  assert.equal(j.total, ANIMS.jumping_joy.dur + PREVIEW.pauseMs.play);
});

test('every behaviour previews every clip its slot allows, across two cycles, as finite rects', () => {
  for (const b of BEHAVIOURS) {
    const values = [DEFAULT_MAP[b.key], ...allowedClips(b.slot, CLIPS).map(n => (Array.isArray(b.default) ? [n] : n))];
    for (const v of values) {
      const prog = previewProgram(b.slot, v, { blink: DEFAULT_MAP.idleBlink });
      const span = prog.loop ? ANIMS[prog.loop].dur * 2 : prog.total * 2;
      for (let t = 0; t <= span; t += 131) {
        for (const s of shapesAt(previewPose(prog, t))) {
          assert.ok([s.x, s.y, s.w, s.h, s.o, ...s.m].every(Number.isFinite), `${b.key} ${JSON.stringify(v)} @${t}`);
        }
      }
    }
  }
});

// ---------- the map ----------

test('usedBy lists the behaviours that play a clip, in table order', () => {
  assert.deepEqual(usedBy('surprised', DEFAULT_MAP),
    ['startle', 'needsYou', 'turnDone', 'lowWarning', 'firstPromptOfDay', 'tap', 'wakeUp']);
  assert.deepEqual(usedBy('sleeping', DEFAULT_MAP), ['asleep', 'offline']);
  assert.deepEqual(usedBy('celebration', DEFAULT_MAP), []);
  assert.deepEqual(usedBy('hop', { ...DEFAULT_MAP, tap: ['hop'] }), ['tap', 'idleLife']);
});

test('sameValue compares one name or a list, in order', () => {
  assert.equal(sameValue('love', 'love'), true);
  assert.equal(sameValue(['a', 'b'], ['a', 'b']), true);
  assert.equal(sameValue(['a', 'b'], ['b', 'a']), false);
  assert.equal(sameValue('a', ['a']), false);
  assert.equal(sameValue(['a'], undefined), false);
});

test('unsavedKeys lists the behaviours whose value differs, in table order', () => {
  assert.deepEqual(unsavedKeys(DEFAULT_MAP, DEFAULT_MAP), []);
  const draft = { ...DEFAULT_MAP, tap: ['hop'], thinking: 'reading' };
  assert.deepEqual(unsavedKeys(draft, DEFAULT_MAP), ['thinking', 'tap']);
});

test('the save message says whether a dashboard took the change', () => {
  assert.equal(savedMessage(1), 'Saved: your phone switched over.');
  assert.equal(savedMessage(3), 'Saved: your phone switched over.');
  assert.equal(savedMessage(0), 'Saved. No dashboard is open right now: your phone picks it up when it connects.');
  assert.equal(savedMessage(null), 'Saved: your phone switches over at once.');
  assert.equal(savedMessage(2, { reset: true }), 'Back to the defaults: your phone switched over.');
  assert.equal(savedMessage(0, { reset: true }), 'Back to the defaults. No dashboard is open right now: your phone picks it up when it connects.');
});

test('a failed save explains itself, with the server\'s own text when it has one', () => {
  assert.equal(saveError(500, 'disk full'), 'Couldn’t save: disk full');
  assert.equal(saveError(413, ''), 'Couldn’t save: the server answered 413.');
  assert.match(saveError(403, 'Forbidden'), /^Couldn’t save: saving works only in a browser on this PC, at http:\/\/localhost:/);
  assert.equal(saveError(0, 'Failed to fetch'), 'Couldn’t save: the server can’t be reached. Is desk-companion running?');
});
