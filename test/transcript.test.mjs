import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTail, readTail, contextWindow, contextPct } from '../src/server/transcript.mjs';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'transcript.jsonl');

test('parseTail takes the newest real assistant line, skipping sidechain, synthetic and malformed lines', () => {
  const r = parseTail(fs.readFileSync(FIXTURE, 'utf8'));
  assert.deepEqual(r, { model: 'claude-opus-5', effort: 'xhigh', contextTokens: 250000 });
});

test('readTail drops a partial first line when it starts mid-file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-tr-'));
  const file = path.join(dir, 't.jsonl');
  const filler = Array.from({ length: 50 }, (_, i) => JSON.stringify({ type: 'user', n: i, pad: 'x'.repeat(40) })).join('\n');
  const last = JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5', usage: { input_tokens: 1000 } } });
  fs.writeFileSync(file, filler + '\n' + last + '\n');
  assert.deepEqual(readTail(file, 150), { model: 'claude-sonnet-5', effort: null, contextTokens: 1000 });
});

test('readTail returns nulls for a missing file or empty path', () => {
  const empty = { model: null, effort: null, contextTokens: null };
  assert.deepEqual(readTail(path.join(os.tmpdir(), 'nope-' + Date.now() + '.jsonl')), empty);
  assert.deepEqual(readTail(''), empty);
});

test('contextWindow is 1M except Haiku, and honours overrides', () => {
  assert.equal(contextWindow('claude-opus-5'), 1_000_000);
  assert.equal(contextWindow('claude-fable-5-1'), 1_000_000);
  assert.equal(contextWindow('claude-haiku-4-5-20251001'), 200_000);
  assert.equal(contextWindow(null), 1_000_000);
  assert.equal(contextWindow('claude-opus-5', { 'claude-opus-5': 500_000 }), 500_000);
});

test('contextPct rounds and clamps to 0..100', () => {
  assert.equal(contextPct(250_000, 'claude-opus-5'), 25);
  assert.equal(contextPct(150_000, 'claude-haiku-4-5'), 75);
  assert.equal(contextPct(5_000_000, 'claude-opus-5'), 100);
  assert.equal(contextPct(null, 'claude-opus-5'), null);
});
