import { formatReset } from './format.js';
import { DEFAULT_MAP } from './behaviours.js';

// The companion's state machine (spec §7), adapted from clawdio's state_machine.cpp (cegware/clawdio, MIT).
// Modes are what is going on (thinking, needs, sleep...); which animation each one plays comes from the
// behaviour map (behaviours.js), so the user can remap them without touching this file.
export const DEFAULT_MOOD = { warn: 50, low: 80, crit: 95, sleepAfterMin: 2, pinnedId: null };

// The active modes are named after their behaviour keys: B[mode] is the mode's animation.
const ACTIVE = new Set(['thinking', 'reading', 'working', 'compiling']);
const IDLEISH = new Set(['idle', 'low', 'sad', 'ending', 'weekEnding', 'weekOver', 'done', 'cool', 'celebrate', 'sleep', 'yawn', 'wake', 'error']);
// Quiet modes fall asleep after sleepAfterMin without activity; that includes a used-up 5-hour limit or a rate
// limit: nothing is going to happen until it resets, so the screensaver takes over. So do a turn that has ended
// or failed (spotlight mode): they wait on you, and the screen must not stay lit for hours meanwhile.
const QUIET = new Set(['idle', 'low', 'sad', 'ending', 'weekEnding', 'weekOver', 'overloaded', 'done', 'error']);
const DWELL_MS = 1500;
const pctOf = w => (w && Number.isFinite(w.pct) ? w.pct : null);
const dayOf = t => new Date(t).toDateString();

// The defaults, with every behaviour the map sets. The server validates maps against the rig (validateMap);
// here a value only has to be a name or a non-empty list, else the default stays.
const usable = v => (typeof v === 'string' && v !== '') || (Array.isArray(v) && v.length > 0);
function mapOf(behaviours) {
  const B = { ...DEFAULT_MAP };
  if (behaviours && typeof behaviours === 'object') for (const k of Object.keys(B)) if (usable(behaviours[k])) B[k] = behaviours[k];
  return B;
}
const list = v => [].concat(v); // a fresh list, from one name or a list

export function createMood(settings = {}, { rand = Math.random, behaviours } = {}) {
  let S = { ...DEFAULT_MOOD, ...settings };
  let B = mapOf(behaviours);
  // A base as the Player takes it: one name, or a fresh copy of an alternating list.
  const base = k => (Array.isArray(B[k]) ? [...B[k]] : B[k]);
  let snap = null;
  let lastKey = null;
  let offline = false;
  const st = {
    mode: null, since: 0, escalated: false, lastActiveAt: null, asleep: false,
    transient: null, plays: [], errors: 0, loveDay: null, pendingCelebrate: false,
  };

  const init = now => { if (st.lastActiveAt === null) { st.lastActiveAt = now; st.since = now; } };
  const touch = now => { st.lastActiveAt = now; };
  const live = now => (st.transient && st.transient.until > now ? st.transient : null);

  function focus() {
    if (!snap) return null;
    const id = S.pinnedId && snap.sessions.some(s => s.id === S.pinnedId) ? S.pinnedId : snap.focusId;
    return snap.sessions.find(s => s.id === id) || null;
  }
  const busy = f => !!f && (ACTIVE.has(f.activity) || f.needsYou);
  // Any session at work or waiting on you: the page's spotlight may show an idle one meanwhile, and he must not
  // doze off while another works.
  const anyBusy = () => !!snap && snap.sessions.some(busy);

  function target(now) {
    if (offline) return { mode: 'offline', base: base('offline'), bubble: null, dim: false };
    const f = focus();
    const L = (snap && snap.limits) || {};
    const p5 = pctOf(L.fiveHour);
    const pw = pctOf(L.week);
    const pf = pctOf(L.fable);
    let tr = live(now);
    const resting = st.asleep || (tr && tr.kind === 'yawn'); // quiet at the limit, he still falls asleep
    if (!resting && ((p5 !== null && p5 >= 100) || (f && f.activity === 'rateLimited'))) {
      const reached = p5 !== null && p5 >= 100;
      const text = reached ? `Limit reached · resets in ${formatReset(L.fiveHour.resetsAt, now) || 'soon'}` : 'Rate limited';
      return { mode: 'overloaded', base: base(reached ? 'limitReached' : 'rateLimited'), bubble: { text, tone: 'bad' } };
    }
    if (f && f.needsYou) return { mode: 'needs', base: base('needsYou'), bubble: { text: f.detail || 'Needs you', tone: 'need' } };
    if (tr && tr.sessionId && f && f.id !== tr.sessionId && busy(f)) tr = null; // another session's moment: the spotlight moved on
    if (tr && tr.kind === 'done') return { mode: 'done', base: base('yourTurn'), bubble: { text: 'Your turn', tone: 'good' } };
    if (tr && (tr.kind === 'error' || tr.kind === 'angry')) {
      return { mode: 'error', base: base(tr.kind === 'angry' ? 'errorRepeated' : 'error'), bubble: { text: 'Error', tone: 'bad' } };
    }
    if (f && ACTIVE.has(f.activity)) return { mode: f.activity, base: base(f.activity), bubble: f.detail ? { text: f.detail, tone: '' } : null };
    if (tr && tr.kind === 'wake') return { mode: 'wake', base: base('idle'), bubble: { text: tr.greet, tone: 'good' } };
    if (tr && tr.kind === 'celebrate') {
      return now - tr.since < 5640
        ? { mode: 'celebrate', base: base('freshLimitsAfter'), bubble: { text: 'Fresh limits!', tone: 'good' } }
        : { mode: 'cool', base: base('afterglow'), bubble: null };
    }
    if (tr && tr.kind === 'cool') return { mode: 'cool', base: base('coolMoment'), bubble: null };
    if (tr && tr.kind === 'yawn') return { mode: 'yawn', base: base('yawn'), bubble: null };
    if (st.asleep) return { mode: 'sleep', base: base('asleep'), bubble: { text: 'Zzz…', tone: '' }, dim: true };
    // Spotlight mode (the page's centred layout) lasts as long as the spotlight's session waits on you. Needing
    // you is handled above; a turn that has ended or failed keeps its animation all along too, not only for the
    // moment it happened (the transients above), until he falls asleep.
    if (f && f.activity === 'done') return { mode: 'done', base: base('yourTurn'), bubble: { text: 'Your turn', tone: 'good' } };
    if (f && f.activity === 'error') return { mode: 'error', base: base(st.errors >= 3 ? 'errorRepeated' : 'error'), bubble: { text: 'Error', tone: 'bad' } };
    const wOver = pw !== null && pw >= 100;
    const fOver = pf !== null && pf >= 100;
    if (wOver || fOver) return { mode: 'weekOver', base: base('weeklyLimitReached'), bubble: { text: `${wOver ? 'Week' : 'Fable'} limit reached`, tone: 'bad' } };
    if (p5 !== null && p5 >= S.crit) return { mode: 'ending', base: base('fiveHourCritical'), bubble: { text: `5-hour at ${p5}%`, tone: 'bad' } };
    const wEnd = pw !== null && pw >= 95;
    const fEnd = pf !== null && pf >= 95;
    if (wEnd || fEnd) return { mode: 'weekEnding', base: base('weeklyNearlyUsed'), bubble: { text: wEnd ? `Week at ${pw}%` : `Fable at ${pf}%`, tone: 'bad' } };
    if (p5 !== null && p5 >= S.low) return { mode: 'sad', base: base('fiveHourLow'), bubble: { text: `5-hour at ${p5}%`, tone: 'bad' } };
    if (p5 !== null && p5 >= S.warn) return { mode: 'low', base: base('fiveHourWarn'), bubble: { text: `5-hour at ${p5}%`, tone: '' } };
    return { mode: 'idle', base: base('idle'), bubble: null };
  }

  function entryPlays(prev, next) {
    if (prev !== null && (next === 'thinking' || next === 'working') && IDLEISH.has(prev)) return list(B.startle);
    if (next === 'low' && prev === 'idle') return list(B.lowWarning);
    return [];
  }

  function out(now) {
    let t = target(now);
    const silent = st.silent; // the spotlight moved: a new session, not news
    st.silent = false;
    if (!silent && ACTIVE.has(t.mode) && ACTIVE.has(st.mode) && t.mode !== st.mode && now - st.since < DWELL_MS) {
      t = { ...t, mode: st.mode, base: base(st.mode) }; // hold the animation, still update the bubble
    }
    const play = st.plays;
    st.plays = [];
    if (t.mode !== st.mode) {
      if (!play.length && !silent) play.push(...entryPlays(st.mode, t.mode));
      st.mode = t.mode;
      st.since = now;
      st.escalated = false;
    }
    const dim = !!t.dim;
    const key = JSON.stringify([t.base, t.bubble, dim]);
    if (key === lastKey && !play.length) return null;
    lastKey = key;
    return { base: t.base, play, bubble: t.bubble, dim };
  }

  function wake(now) {
    if (!st.asleep && !(st.transient && st.transient.kind === 'yawn')) return false;
    const newDay = st.loveDay !== dayOf(now);
    st.asleep = false;
    st.loveDay = dayOf(now);
    st.transient = { kind: 'wake', since: now, until: now + 2900, greet: newDay ? 'Good morning!' : 'Hi!' };
    st.plays = list(B.wakeUp);
    return true;
  }

  function maybeCelebrate(now) {
    const tr = live(now);
    if (!st.pendingCelebrate || busy(focus()) || (tr && tr.kind === 'done')) return; // a live "Your turn" plays out first
    st.pendingCelebrate = false;
    st.asleep = false;
    st.transient = { kind: 'celebrate', since: now, until: now + 13640 };
    st.plays = list(B.freshLimits);
  }

  return {
    onSnapshot(s, now) {
      init(now);
      const prev = snap && snap.limits;
      snap = s;
      if (S.pinnedId && !s.sessions.some(x => x.id === S.pinnedId)) st.silent = true; // the spotlight's session left: it falls back
      if (anyBusy()) { touch(now); wake(now); }
      if (prev && s.limits) {
        for (const k of ['fiveHour', 'week', 'fable']) {
          const a = pctOf(prev[k]);
          const b = pctOf(s.limits[k]);
          if (a !== null && b !== null && a >= 20 && b < 10) st.pendingCelebrate = true;
        }
      }
      maybeCelebrate(now);
      return out(now);
    },

    onEvent(ev, now) {
      init(now);
      const f = focus();
      switch (ev.type) {
        case 'prompt':
          touch(now);
          st.errors = 0;
          if (st.transient && ['done', 'error', 'angry'].includes(st.transient.kind)) st.transient = null;
          if (!wake(now) && st.loveDay !== dayOf(now)) { st.loveDay = dayOf(now); st.plays = list(B.firstPromptOfDay); }
          break;
        case 'stop':
          touch(now);
          st.errors = 0;
          if (!f || f.id === ev.sessionId || !busy(f)) {
            // The Stop snapshot, sent just before this event, may have started a celebration: run it after "Your turn".
            const tr = st.transient;
            if (tr && tr.kind === 'celebrate' && now - tr.since < 1000) st.pendingCelebrate = true;
            st.transient = { kind: 'done', since: now, until: now + 3000, sessionId: ev.sessionId };
            st.plays = list(B.turnDone);
          }
          break;
        case 'error':
          touch(now);
          st.errors += 1;
          if (!f || f.id === ev.sessionId || !busy(f)) st.transient = { kind: st.errors >= 3 ? 'angry' : 'error', since: now, until: now + 5000, sessionId: ev.sessionId };
          break;
        case 'sessionStart':
          touch(now);
          if (!wake(now) && !busy(f)) st.plays = list(B.sessionStart);
          break;
        case 'needsYou':
        case 'rateLimited':
          touch(now);
          wake(now);
          break;
        default:
          break;
      }
      return out(now);
    },

    onTap(now) {
      init(now);
      touch(now);
      if (!wake(now)) {
        const tap = list(B.tap);
        st.plays = [tap[Math.floor(rand() * tap.length) % tap.length]];
      }
      return out(now);
    },

    tick(now) {
      init(now);
      if (st.transient && st.transient.until <= now) {
        const kind = st.transient.kind;
        st.transient = null;
        if (kind === 'yawn') st.asleep = true;
      }
      maybeCelebrate(now);
      if (!st.escalated && now - st.since >= 8000 && (st.mode === 'thinking' || st.mode === 'compiling')) {
        st.escalated = true;
        st.plays = list(st.mode === 'thinking' ? B.stillThinking : B.stillCompiling);
      }
      if (st.mode === 'idle' && !st.transient) {
        const p5 = pctOf(snap && snap.limits && snap.limits.fiveHour);
        if (p5 !== null && p5 <= 5 && rand() < 1 / 1200) st.transient = { kind: 'cool', since: now, until: now + 8000 };
      }
      if (QUIET.has(st.mode) && !anyBusy() && !st.asleep && !st.transient && now - st.lastActiveAt >= S.sleepAfterMin * 60000) {
        st.transient = { kind: 'yawn', since: now, until: now + 2500 };
      }
      return out(now);
    },

    // The page's spotlight (app.js moves it every 10 s, or to a session you tap): Clawd shows that session. The
    // switch is not news, so it skips the startle and the sideways dwell.
    setFocus(id, now) {
      init(now);
      if (S.pinnedId === id) return null;
      S.pinnedId = id;
      st.silent = true;
      return out(now);
    },

    // What the page's half brightness watches: every session's state (thinking, reading, working and compiling are
    // all 'work'), a live moment (your turn, an error, waking up...), a used-up 5-hour limit and the connection.
    // The spotlight moving between sessions changes none of it, so the rotation never counts as a new status.
    status(now) {
      if (offline) return 'offline';
      const tr = live(now);
      const each = (snap ? snap.sessions : []).map(s => `${s.id}:${s.needsYou ? 'needs' : ACTIVE.has(s.activity) ? 'work' : s.activity}`);
      const p5 = pctOf(snap && snap.limits && snap.limits.fiveHour);
      return [...each, tr ? tr.kind : '', p5 !== null && p5 >= 100 ? 'full' : ''].join('|');
    },

    setSettings(partial) { S = { ...S, ...partial }; },

    // A new behaviour map (a full map from the server; what it leaves out is the default). Nothing is emitted
    // here: the caller's next tick() redraws the current state with its new animation.
    setBehaviours(map) { B = mapOf(map); },

    setOffline(value, now) {
      init(now);
      offline = !!value;
      return out(now);
    },
  };
}
