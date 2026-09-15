// The behaviours editor, served at /behaviours on the PC only (src/web/behaviours.html). Every behaviour Clawd
// reacts to, with the animation it plays and a live preview; a gallery of every clip; Save sends the map to the
// server, which applies it on every open dashboard at once (the SSE behaviours event).
// The helpers up to boot() are pure and tested in Node (test/behaviours-page.test.mjs). boot() wires the page and
// runs only in a browser. Text goes into the page with textContent, never as HTML.
import { ANIMS, NAMES, evalAnim, shapesAt, mountClawd, mixPose, loopTime, rest, ease } from './clawd/index.js';
import { BEHAVIOURS, GROUPS, DEFAULT_MAP, SLOTS, validateMap, clipsFrom, allowedClips } from './behaviours.js';

// How the previews play. A preview is a program: one continuous loop ({ loop: name }), or steps played in order
// and then again ({ steps: [{ clip, at, ms, blink? }], total }). A step with clip null holds still (a pause, or
// idle's hold with its blink in the middle).
export const PREVIEW = Object.freeze({
  fps: 30,
  blendMs: 220, // each step blends in from the last (the Player blends 130-450 ms)
  holdMs: 2600, // idle: he holds still, with calm idle's blink...
  blinkAt: 1100, // ...this far in
  holdTail: 500, // and at least this long after a long "blink" clip
  pauseMs: Object.freeze({ base: 1200, play: 1000, seq: 1400, pick: 800 }),
});

const REST = rest();
const SEP = Object.freeze({ alt: ' ↔ ', seq: ' → ' });

export const humanName = name => String(name).replace(/_/g, ' ');

export const formatSeconds = ms => `${+(ms / 1000).toFixed(2)} s`;

const chainOf = (name, anims) => {
  const d = anims[name];
  return d && !d.loop && d.next && anims[d.next] ? d.next : null;
};

// What a clip does when it plays: 'loop', 'once', '→ happy' (a one-shot that hands over to a loop), or, for
// idle, 'holds still'.
export function clipKind(name, anims = ANIMS) {
  if (name === 'idle') return 'holds still';
  const d = anims[name];
  if (!d) return '';
  if (d.loop) return 'loop';
  const next = chainOf(name, anims);
  return next ? `→ ${humanName(next)}` : 'once';
}

// A select option's text. One-shots say so in base slots, where everything else loops; a chained one-shot
// names its successor in every slot, because that successor then loops.
export function optionLabel(name, slotKind, anims = ANIMS) {
  const h = humanName(name);
  if (name === 'idle') return `${h} · holds still`;
  const d = anims[name];
  if (!d || d.loop) return h;
  const next = chainOf(name, anims);
  if (next) return `${h} → ${humanName(next)}`;
  return slotKind === 'base' ? `${h} · plays once` : h;
}

// A behaviour's value in words, the way its slot plays it.
export function describeValue(slotKind, value) {
  const names = [].concat(value).map(humanName);
  if (SEP[slotKind]) return names.join(SEP[slotKind]);
  if (slotKind === 'pick' && names.length > 1) return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
  return names[0] || '';
}

// The line under a behaviour's control: what its slot does with the current choice.
export function slotHint(slotKind, value, anims = ANIMS) {
  const max = SLOTS[slotKind] ? SLOTS[slotKind].max : 1;
  if (slotKind === 'alt') return `Takes turns · up to ${max}`;
  if (slotKind === 'seq') return `Plays in order · up to ${max}`;
  if (slotKind === 'pick') return `One at random each time · up to ${max}`;
  const name = [].concat(value)[0];
  if (name === 'idle') return 'He holds still, with calm idle on top';
  const next = chainOf(name, anims);
  if (next) return `Plays once, then ${humanName(next)} loops`;
  if (slotKind === 'play') return 'Plays once';
  const d = anims[name];
  return d && !d.loop ? 'Plays once, then he holds still' : 'Loops while this lasts';
}

// The preview of a behaviour's value. base: its loop plays on (a one-shot replays after a pause); alt: one pass
// of each, taking turns; play: once, then a pause; seq: in order, then a pause; pick: each in turn, with a pause
// after each. A chained one-shot is followed by one pass of its successor; idle is a hold with `blink` in it.
export function previewProgram(slotKind, value, { anims = ANIMS, blink = DEFAULT_MAP.idleBlink } = {}) {
  const names = [].concat(value).filter(n => n === 'idle' || anims[n]);
  if (!names.length) names.push('idle');
  const only = names.length === 1 ? names[0] : null;
  if (only && only !== 'idle' && anims[only].loop && (slotKind === 'base' || slotKind === 'alt')) return { loop: only };
  const steps = [];
  let at = 0;
  const push = (clip, ms, extra) => { steps.push({ clip, at, ms, ...extra }); at += ms; };
  const play = n => {
    if (n === 'idle') {
      const b = anims[blink] ? blink : null;
      push(null, Math.max(PREVIEW.holdMs, b ? PREVIEW.blinkAt + anims[b].dur + PREVIEW.holdTail : 0), { blink: b });
      return;
    }
    push(n, anims[n].dur);
    const next = chainOf(n, anims);
    if (next) push(next, anims[next].dur);
  };
  const pause = kind => push(null, PREVIEW.pauseMs[kind]);
  if (slotKind === 'alt') names.forEach(play);
  else if (slotKind === 'seq') { names.forEach(play); pause('seq'); }
  else if (slotKind === 'pick') for (const n of names) { play(n); pause('pick'); }
  else {
    play(names[0]);
    if (names[0] !== 'idle') pause(slotKind === 'play' ? 'play' : 'base');
  }
  return { steps, total: at };
}

// A gallery card's program: the clip on its own. Loops play on; one-shots (chained ones too) replay after a pause.
export function galleryProgram(name, anims = ANIMS) {
  const d = anims[name];
  if (name === 'idle' || !d || d.loop) return { loop: d ? name : 'idle' };
  return { steps: [{ clip: name, at: 0, ms: d.dur }, { clip: null, at: d.dur, ms: PREVIEW.pauseMs.play }], total: d.dur + PREVIEW.pauseMs.play };
}

function stepPose(step, local, seed, anims) {
  if (step.clip) return evalAnim(step.clip, local, seed, anims);
  if (step.blink && local >= PREVIEW.blinkAt && local - PREVIEW.blinkAt <= anims[step.blink].dur) {
    return evalAnim(step.blink, local - PREVIEW.blinkAt, seed, anims);
  }
  return REST;
}

// The pose of a program t ms after it started. Each pass of a step has its own seed (1, 2, 3... in play order),
// so a walk or a hop varies from pass to pass; a step blends in from where the previous one ended.
export function previewPose(prog, t, anims = ANIMS) {
  if (prog.loop) return evalAnim(prog.loop, loopTime(anims[prog.loop], Math.max(0, t)), 1, anims);
  const { steps, total } = prog;
  const n = steps.length;
  const time = Math.max(0, t);
  const cycle = Math.floor(time / total);
  const u = time - cycle * total;
  let i = 0;
  while (i < n - 1 && u >= steps[i + 1].at) i++;
  const s = steps[i];
  const local = u - s.at;
  const seed = 1 + cycle * n + i;
  const pose = stepPose(s, local, seed, anims);
  if (local >= PREVIEW.blendMs || (cycle === 0 && i === 0)) return pose;
  const prev = steps[i > 0 ? i - 1 : n - 1];
  return mixPose(stepPose(prev, prev.ms, seed - 1, anims), pose, ease.sineInOut(local / PREVIEW.blendMs));
}

// The behaviours whose value plays `name`, in table order.
export function usedBy(name, map) {
  return BEHAVIOURS.filter(b => [].concat(map[b.key] ?? []).includes(name)).map(b => b.key);
}

// One name, or a list in order.
export function sameValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((n, i) => n === b[i]);
  }
  return a === b;
}

export function unsavedKeys(draft, saved) {
  return BEHAVIOURS.filter(b => !sameValue(draft[b.key], saved[b.key])).map(b => b.key);
}

// The status after a save (or a reset). pages: how many dashboards the server has open (/api/pair-info), or
// null when that is unknown.
export function savedMessage(pages, { reset = false } = {}) {
  const head = reset ? 'Back to the defaults' : 'Saved';
  if (!Number.isFinite(pages)) return `${head}: your phone switches over at once.`;
  if (pages > 0) return `${head}: your phone switched over.`;
  return `${head}. No dashboard is open right now: your phone picks it up when it connects.`;
}

// The status after a failed save. status 0: the request never got an answer.
export function saveError(status, text, { port = '<port>', verb = 'save' } = {}) {
  const head = `Couldn’t ${verb}:`;
  if (!status) return `${head} the server can’t be reached. Is desk-companion running?`;
  if (status === 403) return `${head} saving works only in a browser on this PC, at http://localhost:${port}/behaviours.`;
  const t = String(text || '').trim().slice(0, 200);
  return t ? `${head} ${t}` : `${head} the server answered ${status}.`;
}

// ---------- the page ----------

// The colour of each behaviour's bubble on the phone (src/web/mood.js): amber, green, red, or plain.
const TONE = Object.freeze({
  needsYou: 'need', yourTurn: 'good', freshLimitsAfter: 'good', wakeUp: 'good',
  fiveHourLow: 'bad', fiveHourCritical: 'bad', weeklyNearlyUsed: 'bad', limitReached: 'bad',
  weeklyLimitReached: 'bad', rateLimited: 'bad', error: 'bad', errorRepeated: 'bad',
});
const DIMMED = new Set(['asleep']); // the dashboard dims the screen while he sleeps
const CHIP_SEP = Object.freeze({ alt: '↔', seq: '→', pick: 'or' });
const SVG_NS = 'http://www.w3.org/2000/svg';
const copy = v => (Array.isArray(v) ? [...v] : v);
const copyMap = m => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, copy(v)]));

function boot() {
  const doc = document;
  const $ = id => doc.getElementById(id);
  const el = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const button = (cls, text, label) => {
    const b = el('button', cls, text);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    return b;
  };
  const saveBtn = $('save');
  const resetBtn = $('reset');
  const statusEl = $('status');
  const top = $('top');
  const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const clips = clipsFrom(ANIMS, NAMES); // not ANIMS alone: that has the Player's internal breath
  const byKey = Object.fromEntries(BEHAVIOURS.map(b => [b.key, b]));
  let defaults = validateMap(DEFAULT_MAP, clips);
  let saved = copyMap(defaults); // what the server has
  let draft = copyMap(defaults); // what the page shows
  let loaded = false;
  let busy = null; // 'save' or 'reset' while the server answers
  let note = { text: 'Loading your behaviours…', tone: '' }; // the last action's message
  const port = location.port || '80';

  // ---------- previews: one frame loop, ~30 fps, draws the previews that are on screen ----------
  const previews = [];
  const watched = new Map(); // host element -> preview
  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(entries => {
      for (const e of entries) {
        const p = watched.get(e.target);
        if (!p || p.broken) continue;
        if (e.isIntersecting && !p.visible) p.t = 0; // back on screen: start over
        p.visible = e.isIntersecting;
      }
    }, { rootMargin: '120px 0px' })
    : null;

  function preview(host, { watch = true } = {}) {
    const svg = doc.createElementNS(SVG_NS, 'svg');
    if (watch) svg.setAttribute('role', 'img');
    else svg.setAttribute('aria-hidden', 'true');
    host.appendChild(svg);
    const p = { svg, view: mountClawd(svg), prog: { loop: 'idle' }, key: '', t: 0, visible: !(io && watch), broken: false, buf: [] };
    previews.push(p);
    if (io && watch) watched.set(host, p);
    return p;
  }

  function draw(p) {
    try {
      p.view.render(shapesAt(previewPose(p.prog, p.t), p.buf));
    } catch (e) {
      p.broken = true; // keep the other previews running
      p.visible = false;
      console.error(`behaviours: preview ${p.key} failed`, e);
    }
  }

  // Give a preview a program; the same program again changes nothing, so unrelated refreshes do not restart it.
  function program(p, prog, label) {
    if (label) p.svg.setAttribute('aria-label', label);
    const key = JSON.stringify(prog);
    if (key === p.key) return;
    p.key = key;
    p.prog = prog;
    p.t = 0;
    p.broken = false;
    draw(p);
  }

  const FRAME_MS = 1000 / PREVIEW.fps;
  let last = null;
  function frame(now) {
    requestAnimationFrame(frame);
    if (last === null) last = now;
    if (now - last < FRAME_MS - 2) return;
    const dt = Math.min(100, now - last);
    last = now;
    for (const p of previews) {
      if (!p.visible) continue;
      p.t += dt;
      draw(p);
    }
  }

  // ---------- the header's Clawd: the idle you chose; tap him for one of your Tapped clips ----------
  const logo = preview($('logo'), { watch: false });
  let logoTimer = null;
  function logoIdle() {
    if (!logoTimer) program(logo, previewProgram('base', draft.idle, { blink: draft.idleBlink }));
  }
  function logoPlay(name) {
    if (!ANIMS[name]) return;
    clearTimeout(logoTimer);
    logo.key = ''; // replay, even the same clip
    const prog = previewProgram('play', name);
    program(logo, prog);
    logoTimer = setTimeout(() => { logoTimer = null; logoIdle(); }, prog.total - PREVIEW.pauseMs.play + 150);
  }
  $('logo').addEventListener('click', () => {
    const tap = [].concat(draft.tap);
    logoPlay(tap[Math.floor(Math.random() * tap.length)]);
  });

  // ---------- the behaviours ----------
  const rows = new Map();
  const groupCounts = new Map();

  // The clips a slot accepts, as options: idle first, then loops and one-shots in two groups (base and alt), or a
  // flat list of one-shots (play, seq, pick). Returns the options.
  function fillOptions(sel, slot) {
    const names = allowedClips(slot, clips);
    const out = [];
    const option = (parent, n) => {
      const o = el('option', null, optionLabel(n, slot));
      o.value = n;
      parent.appendChild(o);
      out.push(o);
    };
    if (slot === 'base' || slot === 'alt') {
      if (names.includes('idle')) option(sel, 'idle');
      const others = names.filter(n => n !== 'idle');
      for (const [label, list] of [['Loops', others.filter(n => ANIMS[n].loop)], ['One-shots', others.filter(n => !ANIMS[n].loop)]]) {
        if (!list.length) continue;
        const g = el('optgroup');
        g.setAttribute('label', label);
        for (const n of list) option(g, n);
        sel.appendChild(g);
      }
    } else {
      for (const n of names) option(sel, n);
    }
    return out;
  }

  function buildRow(b) {
    const row = el('div', 'row');
    row.id = `b-${b.key}`;
    const stage = el('div', DIMMED.has(b.key) ? 'stage dim' : 'stage');
    const info = el('div', 'info');
    const head = el('div', 'head');
    const changed = el('span', 'pill', 'Changed');
    const reset = button('link', 'Reset', `Reset ${b.label} to its default`);
    head.append(el('span', 'label', b.label), changed, reset);
    info.append(head, el('p', 'when', b.when));
    if (b.bubble) {
      const bubble = el('span', TONE[b.key] ? `bubble ${TONE[b.key]}` : 'bubble', b.bubble);
      bubble.title = 'What the bubble on the phone says meanwhile';
      info.appendChild(bubble);
    }
    const edit = el('div', 'edit');
    const r = { b, row, changed, reset, hint: el('p', 'hint'), preview: preview(stage), xs: [], flashTimer: null };
    if (SLOTS[b.slot].list) {
      r.chips = el('div', 'chips');
      r.add = el('select', 'add');
      r.add.setAttribute('aria-label', `Add an animation to ${b.label}`);
      const first = el('option', null, '+ Add');
      first.value = '';
      r.add.appendChild(first);
      r.addOptions = fillOptions(r.add, b.slot);
      r.add.addEventListener('change', () => {
        const name = r.add.value;
        r.add.value = '';
        if (name) setValue(b.key, [...draft[b.key], name], true);
      });
      edit.append(r.chips, r.hint);
    } else {
      r.select = el('select', 'one');
      r.select.setAttribute('aria-label', `Animation for ${b.label}`);
      r.options = fillOptions(r.select, b.slot);
      r.select.addEventListener('change', () => setValue(b.key, r.select.value));
      edit.append(r.select, r.hint);
    }
    reset.addEventListener('click', () => setValue(b.key, copy(defaults[b.key]), true));
    row.append(stage, info, edit);
    rows.set(b.key, r);
    return row;
  }

  function buildGroups() {
    const box = $('groups');
    const jump = $('jump');
    for (const g of GROUPS) {
      const sec = el('section');
      sec.id = `group-${g.key}`;
      const h = el('h2', null, g.label);
      const count = el('span', 'count');
      h.appendChild(count);
      groupCounts.set(g.key, count);
      const list = el('div', 'rows');
      for (const b of BEHAVIOURS) if (b.group === g.key) list.appendChild(buildRow(b));
      sec.append(h, list);
      box.appendChild(sec);
      const a = el('a', null, g.label);
      a.href = `#${sec.id}`;
      jump.appendChild(a);
    }
    const a = el('a', null, 'All animations');
    a.href = '#animations';
    jump.appendChild(a);
  }

  // A list slot's chips, each with a remove ×, then the add select (hidden at the slot's longest list). A list
  // keeps at least one name. alt and pick offer each clip once; seq may repeat one.
  function renderChips(r, v) {
    const { b } = r;
    r.chips.replaceChildren();
    r.xs = [];
    v.forEach((n, i) => {
      if (i) r.chips.appendChild(el('span', 'sep', CHIP_SEP[b.slot]));
      const chip = el('span', v.length > 1 ? 'chip' : 'chip solo', humanName(n));
      const next = chainOf(n, ANIMS);
      if (next) chip.appendChild(el('small', null, `→ ${humanName(next)}`));
      if (v.length > 1) {
        const x = button('chip-x', '×', `Remove ${humanName(n)} from ${b.label}`);
        x.title = 'Remove';
        x.addEventListener('click', () => setValue(b.key, draft[b.key].filter((_, j) => j !== i), true));
        chip.appendChild(x);
        r.xs.push(x);
      }
      r.chips.appendChild(chip);
    });
    r.add.hidden = v.length >= SLOTS[b.slot].max;
    r.chips.appendChild(r.add);
    for (const o of r.addOptions) o.disabled = b.slot !== 'seq' && v.includes(o.value);
  }

  function refreshRow(key) {
    const r = rows.get(key);
    const { b } = r;
    const v = draft[key];
    if (r.select) {
      r.select.value = v;
      for (const o of r.options) o.selected = o.value === v;
    } else {
      renderChips(r, v);
    }
    const changed = !sameValue(v, defaults[key]);
    r.changed.hidden = !changed;
    r.reset.hidden = !changed;
    r.reset.title = `Back to the default: ${describeValue(b.slot, defaults[key])}`;
    r.row.classList.toggle('unsaved', !sameValue(v, saved[key]));
    r.hint.textContent = slotHint(b.slot, v) + (changed ? ` · default: ${describeValue(b.slot, defaults[key])}` : '');
    program(r.preview, previewProgram(b.slot, v, { blink: draft.idleBlink }), `${b.label}: ${describeValue(b.slot, v)}`);
  }

  // The row's control, for the keyboard: its select, or its add select (else its last remove button).
  function control(r) {
    return r.select || (r.add.hidden ? r.xs[r.xs.length - 1] : r.add);
  }

  function setValue(key, value, refocus = false) {
    cancelConfirm();
    draft = { ...draft, [key]: copy(value) };
    note = { text: '', tone: '' }; // an edit replaces the last save's message with the count of unsaved changes
    refreshRow(key);
    if (key === 'idleBlink') {
      for (const r of rows.values()) if (r.b.key !== key && [].concat(draft[r.b.key]).includes('idle')) refreshRow(r.b.key);
    }
    if (key === 'idle' || key === 'idleBlink') logoIdle();
    refreshHeader();
    refreshGallery();
    if (refocus) {
      const c = control(rows.get(key));
      if (c && c.focus) c.focus();
    }
  }

  function goTo(key) {
    const r = rows.get(key);
    const c = control(r);
    if (c && c.focus) c.focus({ preventScroll: true });
    r.row.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
    r.row.classList.remove('flash');
    void r.row.offsetWidth; // restart the highlight
    r.row.classList.add('flash');
    clearTimeout(r.flashTimer);
    r.flashTimer = setTimeout(() => r.row.classList.remove('flash'), 1900);
  }

  // ---------- all animations ----------
  const cards = new Map();
  let selected = null;

  function buildGallery() {
    const box = $('gallery');
    for (const name of NAMES) {
      const d = ANIMS[name];
      if (!d) continue;
      const card = el('div', 'card');
      const main = button('card-main');
      main.setAttribute('aria-expanded', 'false');
      const stage = el('div', 'stage');
      const count = el('span', 'card-count');
      const meta = name === 'idle' ? 'holds still' : `${clipKind(name)} · ${formatSeconds(d.dur)}`;
      main.append(stage, el('span', 'card-name', humanName(name)), el('span', 'card-meta', meta), count);
      const uses = el('div', 'uses');
      uses.hidden = true;
      card.append(main, uses);
      box.appendChild(card);
      program(preview(stage), galleryProgram(name), `${humanName(name)}: ${meta}`);
      main.addEventListener('click', () => select(selected === name ? null : name));
      cards.set(name, { card, main, uses, count });
    }
  }

  function select(name) {
    selected = name;
    for (const [n, c] of cards) {
      const on = n === name;
      c.card.classList.toggle('on', on);
      c.main.setAttribute('aria-expanded', String(on));
      c.uses.hidden = !on;
    }
    refreshGallery();
  }

  function refreshGallery() {
    for (const [n, c] of cards) {
      const keys = usedBy(n, draft);
      c.count.textContent = keys.length ? `Used by ${keys.length}` : 'Not used';
      if (n !== selected) continue;
      c.uses.replaceChildren();
      if (!keys.length) c.uses.appendChild(el('p', 'none', 'No behaviour plays it yet.'));
      for (const k of keys) {
        const u = button('use', byKey[k].label, `Go to ${byKey[k].label}`);
        u.addEventListener('click', () => goTo(k));
        c.uses.appendChild(u);
      }
    }
  }

  // ---------- header: Save, Reset to defaults, status ----------
  function setStatus(text, tone) {
    statusEl.textContent = text;
    statusEl.className = tone ? `status ${tone}` : 'status';
  }

  function refreshHeader() {
    const unsaved = unsavedKeys(draft, saved).length;
    const custom = unsavedKeys(saved, defaults).length + unsavedKeys(draft, defaults).length;
    saveBtn.disabled = !loaded || !!busy || unsaved === 0;
    saveBtn.textContent = busy === 'save' ? 'Saving…' : 'Save';
    resetBtn.disabled = !loaded || !!busy || custom === 0;
    if (unsaved && !busy && note.tone !== 'bad' && note.tone !== 'warn') {
      setStatus(`${unsaved} unsaved change${unsaved === 1 ? '' : 's'}`, 'dirty');
    } else {
      setStatus(note.text, note.tone);
    }
    for (const g of GROUPS) {
      const n = BEHAVIOURS.filter(b => b.group === g.key && !sameValue(draft[b.key], defaults[b.key])).length;
      groupCounts.get(g.key).textContent = n ? `${n} changed` : '';
    }
  }

  function adopt(map) {
    saved = map;
    draft = copyMap(map);
    for (const key of rows.keys()) refreshRow(key);
    logoIdle();
    refreshGallery();
  }

  // POST a map (or { reset: true }): { ok, map } with the server's validated map, or { ok: false, error }.
  async function send(body, verb) {
    let res;
    try {
      res = await fetch('/api/behaviours', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
      return { ok: false, error: saveError(0, '', { port, verb }) };
    }
    let text = '';
    try { text = await res.text(); } catch { /* no body */ }
    if (!res.ok) return { ok: false, error: saveError(res.status, text, { port, verb }) };
    try {
      const j = JSON.parse(text);
      return { ok: true, map: validateMap(j && j.map, clips) };
    } catch {
      return { ok: false, error: saveError(res.status, 'the server’s answer was not JSON.', { port, verb }) };
    }
  }

  // How many dashboards are open, to say whether one switched over (null when unknown).
  async function dashboards() {
    try {
      const res = await fetch('/api/pair-info');
      const j = res.ok ? await res.json() : null;
      return j && Number.isFinite(j.pages) ? j.pages : null;
    } catch {
      return null;
    }
  }

  async function save() {
    if (!loaded || busy || !unsavedKeys(draft, saved).length) return;
    cancelConfirm();
    busy = 'save';
    note = { text: 'Saving…', tone: '' };
    refreshHeader();
    // A map equal to the defaults is a reset: the file goes, so future defaults apply.
    const r = await send(unsavedKeys(draft, defaults).length ? draft : { reset: true }, 'save');
    busy = null;
    if (r.ok) {
      adopt(r.map);
      note = { text: savedMessage(await dashboards()), tone: 'good' };
      logoPlay('love');
    } else {
      note = { text: r.error, tone: 'bad' };
    }
    refreshHeader();
  }

  // Reset to defaults asks once more (the button says so for 5 s), then applies at once, like Save.
  let confirmTimer = null;
  function cancelConfirm() {
    if (!confirmTimer) return;
    clearTimeout(confirmTimer);
    confirmTimer = null;
    resetBtn.textContent = 'Reset to defaults';
    resetBtn.classList.remove('confirm');
    if (note.tone === 'warn') note = { text: '', tone: '' };
  }

  async function reset() {
    if (!loaded || busy) return;
    if (!confirmTimer) {
      resetBtn.textContent = 'Click again to reset';
      resetBtn.classList.add('confirm');
      note = { text: `This puts all ${BEHAVIOURS.length} behaviours back to their defaults, on your phone too.`, tone: 'warn' };
      confirmTimer = setTimeout(() => { cancelConfirm(); refreshHeader(); }, 5000);
      refreshHeader();
      return;
    }
    cancelConfirm();
    busy = 'reset';
    note = { text: 'Resetting…', tone: '' };
    refreshHeader();
    const r = await send({ reset: true }, 'reset');
    busy = null;
    if (r.ok) {
      adopt(r.map);
      note = { text: savedMessage(await dashboards(), { reset: true }), tone: 'good' };
    } else {
      note = { text: r.error, tone: 'bad' };
    }
    refreshHeader();
  }

  async function load() {
    try {
      const res = await fetch('/api/behaviours');
      if (!res.ok) throw new Error(`the server answered ${res.status}`);
      const j = await res.json();
      defaults = validateMap(j && j.defaults ? j.defaults : DEFAULT_MAP, clips);
      note = { text: '', tone: '' };
      loaded = true;
      adopt(validateMap(j && j.map, clips));
    } catch (e) {
      const why = e instanceof TypeError ? 'the server can’t be reached' : e.message;
      note = { text: `Couldn’t load your saved behaviours (${why}). Showing the defaults.`, tone: 'bad' };
      loaded = true;
    }
    refreshHeader();
  }

  // ---------- start ----------
  buildGroups();
  buildGallery();
  for (const key of rows.keys()) refreshRow(key);
  logoIdle();
  refreshGallery();
  refreshHeader();

  saveBtn.addEventListener('click', save);
  resetBtn.addEventListener('click', reset);
  addEventListener('keydown', e => {
    const k = String(e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey && k === 's') { e.preventDefault(); save(); }
    else if (k === 'escape' && confirmTimer) { cancelConfirm(); refreshHeader(); }
  });
  addEventListener('beforeunload', e => {
    if (!unsavedKeys(draft, saved).length) return;
    e.preventDefault();
    e.returnValue = ''; // older browsers need it to ask
  });

  // Sections scroll clear of the sticky header.
  const setHead = () => doc.documentElement.style.setProperty('--head', `${top.offsetHeight || 88}px`);
  if (typeof ResizeObserver === 'function') new ResizeObserver(setHead).observe(top);
  else addEventListener('resize', setHead);
  setHead();

  if (io) for (const host of watched.keys()) io.observe(host);
  requestAnimationFrame(frame);
  load();
}

if (typeof document !== 'undefined' && document.getElementById('groups')) boot();
