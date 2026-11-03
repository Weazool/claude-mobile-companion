#!/usr/bin/env node
// Records the dashboard replaying a scripted day (tools/fake-events.mjs day) in a phone-sized window, to a .webm.
// Usage: node tools/record-demo.mjs [--out docs/images/demo.webm] [--size 932x430] [--channel chrome]
// It runs a server of its own: a temporary DESK_COMPANION_HOME (its own port and token) and no limit checks
// (DESK_COMPANION_NO_LIMITS; the day sets the bars itself), so the real server and its sessions are never touched.
// Playwright is not a dependency: without it the script runs itself again under npx (PLAYWRIGHT below). It drives a
// browser installed on this PC (--channel chrome or msedge; chromium, Playwright's own, needs installing), and fetches
// Playwright's ffmpeg (about 2 MB) the first time, leaving any other browsers Playwright has cached alone. That ffmpeg
// writes the video, then encodes it again as VP9 at CRF 32: a fifth of the size, the text as sharp.
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLAYWRIGHT = 'playwright@1.64.1';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(ROOT, opt('out', 'docs/images/demo.webm'));
const [W, H] = opt('size', '932x430').split('x').map(Number);
const CHANNEL = opt('channel', 'chrome');
if (!(W > 0 && H > 0)) { console.error('--size wants WIDTHxHEIGHT, e.g. --size 932x430'); process.exit(2); }

// Under npx the package's .bin folder is on PATH and the package sits next to it; the version must be ours.
function playwrightDir() {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (path.basename(dir) !== '.bin') continue;
    const pkg = path.join(dir, '..', 'playwright');
    try {
      if (JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).version === PLAYWRIGHT.split('@')[1]) return pkg;
    } catch { /* not there */ }
  }
  return null;
}

const pwDir = playwrightDir();
if (!pwDir) {
  if (process.env.DC_RECORD_UNDER_NPX) { console.error(`${PLAYWRIGHT} is not on PATH under npx`); process.exit(1); }
  const cmd = `npx --yes --package ${PLAYWRIGHT} -- node ${JSON.stringify(SELF)} ${args.map(a => JSON.stringify(a)).join(' ')}`;
  const r = spawnSync(cmd, { stdio: 'inherit', shell: true, env: { ...process.env, DC_RECORD_UNDER_NPX: '1' } });
  process.exit(r.status ?? 1);
}
// PLAYWRIGHT_SKIP_BROWSER_GC: without it, install deletes every cached browser no other Playwright has claimed.
const playwrightCli = (...a) => spawnSync(process.execPath, [path.join(pwDir, 'cli.js'), ...a],
  { encoding: 'utf8', env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_GC: '1' } });
const install = playwrightCli('install', 'ffmpeg');
if (install.status !== 0) { console.error(install.stdout, install.stderr); process.exit(install.status ?? 1); }
const ffmpegDir = (/Install location:\s+(.+)/.exec(playwrightCli('install', '--dry-run', 'ffmpeg').stdout) || [])[1]?.trim();
const ffmpegExe = ffmpegDir && fs.readdirSync(ffmpegDir).find(f => /^ffmpeg/.test(f));
if (!ffmpegExe) { console.error("Playwright's ffmpeg was not found"); process.exit(1); }
const { chromium } = await import(pathToFileURL(path.join(pwDir, 'index.mjs')).href);

const sleep = ms => new Promise(r => setTimeout(r, ms));
// A port nothing listens on, so the demo server never meets the real one (which would stand down or take over).
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const getJson = (port, p) => new Promise(resolve => {
  const req = http.get({ host: '127.0.0.1', port, path: p, timeout: 500 }, res => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', d => { body += d; });
    res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
  });
  req.on('timeout', () => req.destroy());
  req.on('error', () => resolve(null));
});
async function until(what, test, ms = 10000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await test()) return;
  throw new Error(`timed out waiting for ${what}`);
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-companion-demo-'));
const port = await freePort();
fs.mkdirSync(path.join(home, '.desk-companion'));
fs.writeFileSync(path.join(home, '.desk-companion', 'config.json'), JSON.stringify({ port }) + '\n');
const env = { ...process.env, DESK_COMPANION_HOME: home, DESK_COMPANION_NO_LIMITS: '1' };
const server = spawn(process.execPath, [path.join(ROOT, 'bin', 'server.mjs')], { env, stdio: 'ignore' });
let browser = null;
try {
  await until('the demo server', async () => (await getJson(port, '/api/health'))?.ok === true);
  browser = await chromium.launch({ channel: CHANNEL === 'chromium' ? undefined : CHANNEL });
  const day = spawn(process.execPath, [path.join(ROOT, 'tools', 'fake-events.mjs'), 'day'], { env, stdio: 'inherit' });
  const dayDone = new Promise(resolve => day.on('exit', resolve));
  // The page opens once the session exists, so the dashboard's slots start with the day (fake-events.mjs day).
  await until('the day to start', async () => (await getJson(port, '/api/pair-info'))?.sessions > 0);
  const videoDir = path.join(home, 'video');
  const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: videoDir, size: { width: W, height: H } } });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  const code = await dayDone;
  if (code !== 0) throw new Error(`fake-events.mjs day exited with ${code}`);
  await sleep(2000);
  const video = page.video();
  await context.close();
  const raw = path.join(home, 'raw.webm');
  await video.saveAs(raw);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const enc = spawnSync(path.join(ffmpegDir, ffmpegExe), ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw,
    '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', OUT], { stdio: 'inherit' });
  if (enc.status !== 0) throw new Error(`ffmpeg exited with ${enc.status}`);
  console.log(`wrote ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);
} finally {
  if (browser) await browser.close();
  server.kill();
  await new Promise(r => (server.exitCode !== null || server.signalCode !== null ? r() : server.on('exit', r)));
  fs.rmSync(home, { recursive: true, force: true });
}
