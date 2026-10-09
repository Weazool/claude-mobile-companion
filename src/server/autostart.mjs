// Starting desk-companion with Windows (bin/autostart.mjs): a copy of src/server/launcher.mjs in the data dir, and a
// minimised shortcut to it in the user's Startup folder, made with PowerShell's WScript.Shell.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dataFile } from './paths.mjs';

export const SHORTCUT = 'desk-companion.lnk';
const LAUNCHER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'launcher.mjs');

export const startupDir = (env = process.env) => path.join(env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');

const ps = s => `'${String(s).replace(/'/g, "''")}'`; // a PowerShell single-quoted string
// The shortcut: node with the launcher, run minimised (WindowStyle 7) so no window shows at login.
export function shortcutScript({ lnk, node, launcher, cwd }) {
  return [
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${ps(lnk)})`,
    `$s.TargetPath = ${ps(node)}`,
    `$s.Arguments = ${ps(`"${launcher}"`)}`,
    `$s.WorkingDirectory = ${ps(cwd)}`,
    '$s.WindowStyle = 7',
    "$s.Description = 'desk-companion'",
    '$s.Save()',
  ].join('; ');
}

const paths = () => ({ lnk: path.join(startupDir(), SHORTCUT), launcher: dataFile('autostart.mjs') });

export function install() {
  if (process.platform !== 'win32') return { ok: false, message: 'Starting with the system is only set up on Windows for now.' };
  const { lnk, launcher } = paths();
  fs.mkdirSync(path.dirname(launcher), { recursive: true });
  fs.copyFileSync(LAUNCHER, launcher);
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', shortcutScript({ lnk, node: process.execPath, launcher, cwd: os.homedir() })],
    { windowsHide: true, encoding: 'utf8' });
  if (r.status !== 0 || !fs.existsSync(lnk)) return { ok: false, message: `The Startup shortcut could not be made: ${(r.stderr || r.error?.message || '').trim()}` };
  return { ok: true, message: `desk-companion starts with Windows (${lnk}).` };
}

export function remove() {
  const { lnk, launcher } = paths();
  for (const f of [lnk, launcher]) { try { fs.unlinkSync(f); } catch { /* not there */ } }
  return { ok: true, message: 'desk-companion no longer starts with Windows.' };
}

export function status() {
  const { lnk } = paths();
  return fs.existsSync(lnk) ? `On: ${lnk}` : 'Off';
}
