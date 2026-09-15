// Draws Clawd's shapes into an <svg>. A pool of <rect>s is made once at mount and reused frame to frame:
// each render writes only the attributes that changed (a still frame writes nothing), sets transforms
// through SVGTransform where the browser has it, hides the rects a frame does not need, and never reads
// layout. The pool only grows if a frame ever needs more rects than it holds.
import { VIEW } from './core.js';

const NS = 'http://www.w3.org/2000/svg';
const EPS = 1e-6;
// Rects made at mount: more than any clip or blend draws (the busiest frame is about 60), so animating
// never creates an element.
export const POOL_RECTS = 72;

export function mountClawd(svgEl, { view = VIEW, reserve = POOL_RECTS } = {}) {
  const doc = svgEl.ownerDocument;
  svgEl.setAttribute('viewBox', typeof view === 'string' ? view : `${view.x} ${view.y} ${view.w} ${view.h}`);
  const g = doc.createElementNS(NS, 'g');
  svgEl.appendChild(g);
  const live = typeof svgEl.createSVGTransform === 'function' && typeof svgEl.createSVGMatrix === 'function';
  const mat = live ? svgEl.createSVGMatrix() : null;
  const pool = [];
  let shown = 0;

  function slot(i) {
    if (pool[i]) return pool[i];
    const el = doc.createElementNS(NS, 'rect');
    el.setAttribute('display', 'none');
    g.appendChild(el);
    const r = { el, tr: null, x: NaN, y: NaN, w: NaN, h: NaN, fill: '', o: NaN, crisp: null, hidden: true, m: [NaN, NaN, NaN, NaN, NaN, NaN] };
    if (live) {
      el.transform.baseVal.appendItem(svgEl.createSVGTransform());
      r.tr = el.transform.baseVal.getItem(0); // the live item: setMatrix on it updates the element
    }
    pool[i] = r;
    return r;
  }
  for (let i = 0; i < reserve; i++) slot(i);

  function render(shapes) {
    const n = shapes.length;
    for (let i = 0; i < n; i++) {
      const s = shapes[i];
      const r = slot(i);
      const el = r.el;
      if (r.hidden) { el.removeAttribute('display'); r.hidden = false; }
      if (s.x !== r.x) { el.setAttribute('x', s.x); r.x = s.x; }
      if (s.y !== r.y) { el.setAttribute('y', s.y); r.y = s.y; }
      if (s.w !== r.w) { el.setAttribute('width', s.w); r.w = s.w; }
      if (s.h !== r.h) { el.setAttribute('height', s.h); r.h = s.h; }
      if (s.fill !== r.fill) { el.setAttribute('fill', s.fill); r.fill = s.fill; }
      if (s.o !== r.o) {
        if (s.o >= 1) el.removeAttribute('opacity');
        else el.setAttribute('opacity', Math.round(s.o * 1000) / 1000);
        r.o = s.o;
      }
      const m = s.m;
      const q = r.m;
      if (m[0] !== q[0] || m[1] !== q[1] || m[2] !== q[2] || m[3] !== q[3] || m[4] !== q[4] || m[5] !== q[5]) {
        q[0] = m[0]; q[1] = m[1]; q[2] = m[2]; q[3] = m[3]; q[4] = m[4]; q[5] = m[5];
        if (r.tr) {
          mat.a = m[0]; mat.b = m[1]; mat.c = m[2]; mat.d = m[3]; mat.e = m[4]; mat.f = m[5];
          r.tr.setMatrix(mat);
        } else {
          el.setAttribute('transform', `matrix(${m[0]} ${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]})`);
        }
        const crisp = Math.abs(m[1]) < EPS && Math.abs(m[2]) < EPS; // axis-aligned: keep the pixel edges hard
        if (crisp !== r.crisp) { el.setAttribute('shape-rendering', crisp ? 'crispEdges' : 'geometricPrecision'); r.crisp = crisp; }
      }
    }
    for (let i = n; i < shown; i++) {
      const r = pool[i];
      if (!r.hidden) { r.el.setAttribute('display', 'none'); r.hidden = true; }
    }
    shown = n;
  }

  return { render, el: g, get size() { return pool.length; } };
}
