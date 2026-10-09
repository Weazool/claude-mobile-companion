#!/usr/bin/env node
// node bin/autostart.mjs --install | --remove | --status: start desk-companion's server with Windows, or stop doing so.
import { install, remove, status } from '../src/server/autostart.mjs';

const arg = process.argv[2];
if (arg === '--install' || arg === '--remove') {
  const r = arg === '--install' ? install() : remove();
  console.log(r.message);
  process.exitCode = r.ok ? 0 : 1;
} else if (arg === '--status') {
  console.log(status());
} else {
  console.log('Usage: node bin/autostart.mjs --install | --remove | --status');
  process.exitCode = 2;
}
