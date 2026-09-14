import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../tools/lib/png.mjs';
import { SHEETS } from '../src/web/anims.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPRITES = path.join(ROOT, 'src', 'web', 'sprites');

test('every sheet has a 2048x256 strip', () => {
  for (const name of SHEETS) {
    const img = decodePng(fs.readFileSync(path.join(SPRITES, `${name}.png`)));
    assert.deepEqual([img.width, img.height], [2048, 256], name);
  }
});

test('metadata, licence and icon are present', () => {
  const meta = JSON.parse(fs.readFileSync(path.join(SPRITES, 'sprites.json'), 'utf8'));
  assert.equal(meta.source.commit, '76ee482fffa1cc602ca0dc524324a2880b9770e2');
  assert.deepEqual(Object.keys(meta.sheets).sort(), [...SHEETS].sort());
  assert.match(fs.readFileSync(path.join(SPRITES, 'LICENSE-clawdio.txt'), 'utf8'), /MIT/);
  const icon = decodePng(fs.readFileSync(path.join(ROOT, 'src', 'web', 'icon.png')));
  assert.deepEqual([icon.width, icon.height], [256, 256]);
});
