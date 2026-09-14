import { ANIMS as DEFAULT_ANIMS } from './anims.js';

const ALL = [0, 1, 2, 3, 4, 5, 6, 7];
const BREATH_FRAMES = [0, 1, 2, 3, 2, 1, 0];
export const BLINK_MS = 640;   // 8 x 80 ms
export const GLANCE_MS = 960;  // 8 x 120 ms
export const BREATH_MS = 1400; // 7 x 200 ms

// Spec §8: mean intervals, counted in still time only.
export function idlePlan({ blinksPerMin = 26, glancesPerMin = 2, movingPct = 50 } = {}) {
  const M = Math.min(0.95, Math.max(0.05, movingPct / 100));
  const S = 60000 * (1 - M);
  const B = Math.max(0, blinksPerMin);
  const G = Math.max(0, glancesPerMin);
  const R = Math.max(0, (60000 * M - B * BLINK_MS - G * GLANCE_MS) / BREATH_MS);
  return { blinkMs: B ? S / B : Infinity, glanceMs: G ? S / G : Infinity, breathMs: R ? S / R : Infinity };
}

export class Player {
  constructor({ anims = DEFAULT_ANIMS, idle = {}, rand = Math.random } = {}) {
    this.anims = anims;
    this.rand = rand;
    this.base = ['idle'];
    this.bi = 0;
    this.queue = [];
    this.movingMs = 0;
    this.counts = { blink: 0, glance: 0, breath: 0 };
    this.setIdle(idle);
    this._toBase();
  }

  setIdle(idle) {
    this.plan = idlePlan(idle);
    this.t = { blink: this._draw(this.plan.blinkMs), glance: this._draw(this.plan.glanceMs), breath: this._draw(this.plan.breathMs) };
  }

  _draw(mean) { return Number.isFinite(mean) ? mean * (0.6 + 0.8 * this.rand()) : Infinity; } // uniform, ±40% of the mean
  _baseName() { return this.base[this.bi % this.base.length]; }
  _set(clip) { this.cur = clip; this.fi = 0; this.el = 0; this.dirty = true; }

  _clip(name) {
    const a = this.anims[name];
    return { name, sheet: a.sheet, frames: ALL, ms: a.ms, loop: !!a.loop, next: a.next || null, isBase: name === this._baseName() };
  }

  _toBase() {
    const n = this._baseName();
    if (n === 'idle') this._set({ name: 'idle', sheet: this.anims.idle.sheet, frames: [0], ms: Infinity, loop: true, next: null, isBase: true, hold: true });
    else this._set(this._clip(n));
  }

  setBase(names) {
    const next = [].concat(names).filter(n => this.anims[n]);
    if (!next.length) return; // unknown names keep the current base
    if (next.length === this.base.length && next.every((n, i) => n === this.base[i])) return;
    this.base = next;
    this.bi = 0;
    if (this.cur.isBase) this._toBase(); // a running one-shot finishes first, then the new base plays
  }

  play(names) {
    const list = [].concat(names).filter(n => this.anims[n]);
    if (!list.length) return;
    this.queue = list.slice(1);
    this._set(this._clip(list[0]));
  }

  update(dt) {
    const c = this.cur;
    if (c.hold) {
      this.t.blink -= dt;
      this.t.glance -= dt;
      this.t.breath -= dt;
      if (this.t.glance <= 0) {
        this.t.glance = this._draw(this.plan.glanceMs);
        this.counts.glance++;
        this.play(this.rand() < 0.5 ? 'look_left' : 'look_right');
      } else if (this.t.blink <= 0) {
        this.t.blink = this._draw(this.plan.blinkMs);
        this.counts.blink++;
        this.play('blink');
      } else if (this.t.breath <= 0) {
        this.t.breath = this._draw(this.plan.breathMs);
        this.counts.breath++;
        this._set({ name: 'breath', sheet: this.anims.idle.sheet, frames: BREATH_FRAMES, ms: 200, loop: false, next: null, isBase: false });
      }
      return this.dirty;
    }
    this.movingMs += dt;
    this.el += dt;
    if (this.el >= c.ms) {
      this.el -= c.ms;
      this.fi++;
      this.dirty = true;
      if (this.fi >= c.frames.length) {
        if (c.loop) this.fi = 0;
        else if (c.next) this._set(this._clip(c.next));
        else if (this.queue.length) this._set(this._clip(this.queue.shift()));
        else {
          if (c.isBase && this.base.length > 1) this.bi++;
          this._toBase();
        }
      }
    }
    return this.dirty;
  }

  frame() {
    this.dirty = false;
    return { sheet: this.cur.sheet, index: this.cur.frames[this.fi] };
  }
}
