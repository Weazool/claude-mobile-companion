// Animation table (spec §8), ported from clawdio's anim_registry.cpp (cegware/clawdio, MIT).
// Single source of truth for the page and for tools/build-sprites.mjs.
export const SHEETS = [
  'angry', 'blink', 'celebration', 'cool', 'curious', 'ending', 'error', 'happy', 'happy_eyes', 'idle', 'jumping_joy',
  'look_left', 'look_right', 'love', 'low_tokens', 'overloaded', 'sleeping', 'surprised', 'thinking', 'working', 'yawning',
];
// Sheets whose drawn vertical motion (hops, jumps, stretches) must survive normalisation (spec §9).
export const MOTION_SHEETS = ['happy_eyes', 'surprised', 'jumping_joy', 'celebration', 'happy', 'yawning'];
export const FRAME_SIZE = 256;
export const FRAMES = 8;

export const ANIMS = {
  idle: { sheet: 'idle', ms: 150, loop: true },
  look_left: { sheet: 'look_left', ms: 120 },
  look_right: { sheet: 'look_right', ms: 120 },
  blink: { sheet: 'blink', ms: 80 },
  happy_eyes: { sheet: 'happy_eyes', ms: 100, loop: true },
  curious: { sheet: 'curious', ms: 130 },
  thinking: { sheet: 'thinking', ms: 100, loop: true },
  working: { sheet: 'working', ms: 80, loop: true },
  compiling: { sheet: 'working', ms: 90, loop: true },
  reading: { sheet: 'thinking', ms: 110, loop: true },
  surprised: { sheet: 'surprised', ms: 100 },
  cool: { sheet: 'cool', ms: 140, loop: true },
  happy: { sheet: 'happy', ms: 100, loop: true },
  jumping_joy: { sheet: 'jumping_joy', ms: 80, next: 'happy' },
  celebration: { sheet: 'celebration', ms: 90, next: 'happy' },
  love: { sheet: 'love', ms: 120 },
  low_tokens: { sheet: 'low_tokens', ms: 150, loop: true },
  ending: { sheet: 'ending', ms: 130, loop: true },
  sad: { sheet: 'ending', ms: 160, loop: true },
  overloaded: { sheet: 'overloaded', ms: 70, loop: true },
  angry: { sheet: 'angry', ms: 90, loop: true },
  error: { sheet: 'error', ms: 60, loop: true },
  sleeping: { sheet: 'sleeping', ms: 200, loop: true },
  yawning: { sheet: 'yawning', ms: 140 },
};
