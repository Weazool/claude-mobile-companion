import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export function homeDir() {
  return process.env.DESK_COMPANION_HOME || os.homedir();
}

export function dataDir(home = homeDir()) {
  return path.join(home, '.desk-companion');
}

export function dataFile(name, home = homeDir()) {
  return path.join(dataDir(home), name);
}

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// A random port in 50000-60000.
export function randomPort(randomBytes = crypto.randomBytes) {
  return 50000 + (randomBytes(2).readUInt16BE(0) % 10001);
}

// Creates ~/.desk-companion/config.json on first run and repairs invalid fields.
// Port and token persist so a bookmarked phone URL keeps working across restarts.
export function loadOrCreateConfig(home = homeDir(), randomBytes = crypto.randomBytes) {
  fs.mkdirSync(dataDir(home), { recursive: true });
  const file = dataFile('config.json', home);
  let cfg = readJson(file);
  if (typeof cfg !== 'object' || cfg === null || Array.isArray(cfg)) cfg = {};
  let changed = false;
  if (!Number.isInteger(cfg.port) || cfg.port < 1024 || cfg.port > 65535) {
    cfg.port = randomPort(randomBytes);
    changed = true;
  }
  if (typeof cfg.token !== 'string' || !/^[0-9a-f]{32}$/.test(cfg.token)) {
    cfg.token = randomBytes(16).toString('hex');
    changed = true;
  }
  if (typeof cfg.contextWindow !== 'object' || cfg.contextWindow === null || Array.isArray(cfg.contextWindow)) {
    cfg.contextWindow = {};
    changed = true;
  }
  if (changed) fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  return cfg;
}

// Appends one timestamped line; when the file is over maxBytes it is moved to `<file>.1` first.
// Never throws: logging must not break a hook or the server.
export function appendLog(file, line, maxBytes) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let size = 0;
    try { size = fs.statSync(file).size; } catch { /* no file yet */ }
    if (size > maxBytes) fs.renameSync(file, file + '.1');
    fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
  } catch { /* ignore */ }
}
