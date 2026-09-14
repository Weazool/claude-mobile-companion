import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeImage, fillRect, getPixel, removeGridLines, dominantColor, largestComponent, colorMask, measureBody,
  cellRects, frameMasks, sheetScale, anchors, renderFrame, blit, measureFrame, median,
} from '../tools/lib/sprite-math.mjs';

const ORANGE = [206, 109, 72];

test('median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});

test('removeGridLines blacks out full-length neutral lines only', () => {
  const img = makeImage(40, 20);
  fillRect(img, 10, 0, 11, 20, [220, 220, 220]);   // white vertical separator
  fillRect(img, 0, 5, 40, 6, [63, 64, 64]);        // thin dark-grey horizontal separator
  fillRect(img, 20, 8, 30, 18, ORANGE);            // body
  fillRect(img, 32, 8, 33, 12, [249, 249, 249]);   // short white "!" – not a line
  assert.deepEqual(removeGridLines(img), { cols: [10], rows: [5] });
  assert.deepEqual(getPixel(img, 10, 15), [0, 0, 0]);
  assert.deepEqual(getPixel(img, 3, 5), [0, 0, 0]);
  assert.deepEqual(getPixel(img, 25, 10), ORANGE);
  assert.deepEqual(getPixel(img, 32, 9), [249, 249, 249]);
});

test('dominantColor picks the body colour, ignoring white and small effects', () => {
  const img = makeImage(50, 50);
  fillRect(img, 10, 10, 40, 40, ORANGE);
  fillRect(img, 0, 0, 5, 5, [74, 115, 190]);
  fillRect(img, 45, 45, 50, 50, [249, 249, 249]);
  const c = dominantColor(img);
  assert.ok(Math.abs(c[0] - ORANGE[0]) <= 8 && Math.abs(c[1] - ORANGE[1]) <= 8 && Math.abs(c[2] - ORANGE[2]) <= 8, String(c));
});

test('largestComponent ignores small same-colour blobs (Zzz, spinner dots)', () => {
  const img = makeImage(30, 30);
  fillRect(img, 2, 2, 12, 12, ORANGE);
  fillRect(img, 20, 20, 23, 23, ORANGE);
  const { mask, w, h } = colorMask(img, { x0: 0, y0: 0, x1: 30, y1: 30 }, ORANGE);
  assert.deepEqual(largestComponent(mask, w, h), { count: 100, x0: 2, y0: 2, x1: 11, y1: 11 });
});

test('measureBody includes arms and legs, reports centre and feet line', () => {
  const img = makeImage(100, 80);
  fillRect(img, 30, 20, 70, 50, ORANGE);   // body block 40 wide
  fillRect(img, 22, 30, 30, 36, ORANGE);   // left arm
  fillRect(img, 70, 30, 78, 36, ORANGE);   // right arm
  fillRect(img, 35, 50, 40, 60, ORANGE);   // leg
  fillRect(img, 60, 50, 65, 60, ORANGE);   // leg
  fillRect(img, 80, 5, 84, 9, ORANGE);     // a floating "z"
  const b = measureBody(img, { x0: 0, y0: 0, x1: 100, y1: 80 }, ORANGE);
  assert.deepEqual([b.x0, b.x1, b.width, b.y0, b.feet, b.cx], [22, 77, 56, 20, 60, 50]);
});

test('cellRects, frameMasks, sheetScale and anchors', () => {
  const img = makeImage(400, 200);
  const cells = cellRects(img);
  assert.equal(cells.length, 8);
  assert.deepEqual(cells[5], { x0: 100, x1: 200, y0: 100, y1: 200, row: 1, col: 1 });
  const bodies = cells.map((c, i) => ({ cx: c.x0 + 50 + (i % 2 ? 4 : 0), feet: c.y0 + 80 + (i === 2 ? -10 : 0), width: 60 + i }));
  const masks = frameMasks(bodies, cells, img);
  assert.deepEqual(masks[0], { x0: 0, x1: Math.round((50 + 154) / 2), y0: 0, y1: 100 });
  assert.equal(masks[3].x1, 400);
  assert.equal(sheetScale(bodies, 150), 150 / median(bodies.map(b => b.width)));
  const rowMode = anchors(bodies, 'row');
  assert.deepEqual(rowMode.slice(0, 4).map(a => a.feet), [80, 80, 80, 80]);
  assert.equal(anchors(bodies, 'frame')[2].feet, 70);
});

test('renderFrame centres the body, puts the feet on feetRow and scales it', () => {
  const src = makeImage(100, 60);
  fillRect(src, 30, 30, 50, 50, ORANGE);   // 20 wide, feet at 50, centre x 40
  const full = { x0: 0, y0: 0, x1: 100, y1: 60 };
  const out = renderFrame(src, full, 2, 40, 50, 64, 50);
  const b = measureFrame(out);
  assert.ok(Math.abs(b.width - 40) <= 1, `width ${b.width}`);
  assert.ok(Math.abs(b.feet - 50) <= 1, `feet ${b.feet}`);
  assert.ok(Math.abs(b.cx - 32) <= 1, `cx ${b.cx}`);
  assert.deepEqual(getPixel(out, 5, 30), [0, 0, 0]);
  const clipped = renderFrame(src, { x0: 0, y0: 0, x1: 40, y1: 60 }, 2, 40, 50, 64, 50);
  assert.deepEqual(getPixel(clipped, 45, 30), [0, 0, 0]);
  assert.deepEqual(getPixel(clipped, 20, 30), ORANGE);
});

test('blit copies a frame into a strip at an x offset', () => {
  const f = makeImage(2, 2);
  fillRect(f, 0, 0, 2, 2, ORANGE);
  const strip = makeImage(6, 2);
  blit(f, strip, 2);
  assert.deepEqual(getPixel(strip, 1, 1), [0, 0, 0]);
  assert.deepEqual(getPixel(strip, 2, 0), ORANGE);
  assert.deepEqual(getPixel(strip, 3, 1), ORANGE);
  assert.deepEqual(getPixel(strip, 4, 0), [0, 0, 0]);
});
