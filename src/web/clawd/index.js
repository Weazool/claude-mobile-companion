// Clawd's public API. Importing this module registers every animation file.
import './anims/base.js';
import './anims/life.js';
import './anims/work.js';
import './anims/feelings.js';

export * from './core.js';
export { mountClawd, POOL_RECTS } from './svg.js';
