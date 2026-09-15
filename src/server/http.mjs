import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEFAULT_MAP } from '../web/behaviours.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
};
const PUBLIC = new Set(['manifest.webmanifest', 'icon.png']); // browsers fetch manifests without cookies
const PC_PAGES = new Set(['pair.html', 'behaviours.html']); // loopback-only pages (spec §2), also under /web/
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;
const BEHAVIOURS_MAX = 16 * 1024; // a full map is about 1 KB
const STATUS_TEXT = { 400: 'Bad request', 404: 'Not found', 405: 'Method not allowed', 413: 'Too large' };

export function isLoopback(req) {
  return LOOPBACK.has(req.socket.remoteAddress);
}

// DNS rebinding guard: a web page whose own name was rebound to 127.0.0.1 reaches us from a loopback
// address, but its requests still carry its own name in Host.
export function isLoopbackHost(host) {
  return typeof host === 'string' && LOOPBACK_HOST.test(host);
}

// Cross-site request guard for a POST without a token: another site open in the PC's browser reaches us
// from a loopback address with a loopback Host too (a form, a no-cors fetch), but its Origin names that site.
// Browsers send Origin with every POST; a request without one is not from a web page.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try { return new URL(origin).host === String(req.headers.host).toLowerCase(); } catch { return false; }
}

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// Compares bytes, not characters: 'é' is one UTF-16 unit but two UTF-8 bytes, and timingSafeEqual throws
// on buffers of different lengths.
export function tokenMatches(given, token) {
  if (typeof given !== 'string' || typeof token !== 'string') return false;
  const a = Buffer.from(given), b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// getBehaviours() -> the current behaviour map; setBehaviours(input) -> the map after a save (the server
// validates and stores it; { reset: true } restores the defaults), throws when it cannot be saved.
export function createApp({ token, webRoot, getSnapshot, onHook, onDevLimits, getPairInfo, getBehaviours, setBehaviours, log = () => {}, isLoopbackReq = isLoopback }) {
  const root = path.resolve(webRoot);
  const clients = new Set();
  const send = (res, type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  const broadcast = (type, data) => { for (const res of clients) send(res, type, data); };
  const ping = setInterval(() => broadcast('ping', {}), 20000);
  ping.unref();

  const deny = (res, code = 403) =>
    res.writeHead(code, { 'content-type': 'text/plain' }).end(STATUS_TEXT[code] || 'Forbidden');
  const json = (res, obj) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(obj));
  const serveFile = (res, abs, extra = {}) => fs.readFile(abs, (err, buf) => {
    if (err) return deny(res, 404);
    res.writeHead(200, { 'content-type': TYPES[path.extname(abs)] || 'application/octet-stream', 'cache-control': 'no-cache', ...extra }).end(buf);
  });

  // Everything runs inside the try: the handler is async, so a throw outside it would be an unhandled
  // rejection, which ends the process.
  const server = http.createServer(async (req, res) => {
    let p = '';
    try {
      let url;
      try { url = new URL(req.url, 'http://localhost'); } catch { return deny(res, 400); }
      p = url.pathname;
      // The loopback exemption needs a loopback address AND a loopback Host (spec §2).
      const loop = isLoopbackReq(req) && isLoopbackHost(req.headers.host);
      const authed = loop || tokenMatches(url.searchParams.get('k'), token) || tokenMatches(cookies(req).dc, token);
      if (req.method === 'POST' && (p === '/api/hook' || p === '/api/dev/limits')) {
        if (!loop || !tokenMatches(req.headers['x-dc-token'], token)) return deny(res);
        const body = JSON.parse(await readBody(req, 65536));
        if (p === '/api/hook') onHook(body); else onDevLimits(body);
        return res.writeHead(204).end();
      }
      // The behaviours editor saves the whole map (validated by setBehaviours), and every page gets it.
      // pages: how many dashboards it was sent to, for the editor's status line.
      if (req.method === 'POST' && p === '/api/behaviours') {
        if (!loop || !sameOrigin(req)) return deny(res);
        if (Number(req.headers['content-length']) > BEHAVIOURS_MAX) return deny(res, 413);
        let body;
        try { body = JSON.parse(await readBody(req, BEHAVIOURS_MAX)); } catch { return deny(res, 400); }
        if (!isObject(body)) return deny(res, 400);
        let map;
        try { map = setBehaviours(body); } catch (e) {
          log(`behaviours not saved: ${e.message}`);
          return res.writeHead(500, { 'content-type': 'text/plain' }).end(`the map could not be stored (${e.code || e.message})`);
        }
        broadcast('behaviours', { map });
        return json(res, { map, pages: clients.size });
      }
      if (req.method !== 'GET') return deny(res, 405);
      if (p === '/api/health') return loop ? json(res, { ok: true, pid: process.pid }) : deny(res);
      if (p === '/pair') return loop ? serveFile(res, path.join(root, 'pair.html')) : deny(res);
      if (p === '/behaviours') return loop ? serveFile(res, path.join(root, 'behaviours.html')) : deny(res);
      if (p === '/api/pair-info') return loop ? json(res, { ...getPairInfo(), pages: clients.size }) : deny(res);
      if (p.startsWith('/web/')) {
        const rel = decodeURIComponent(p.slice(5));
        const abs = path.resolve(root, rel);
        if (!abs.startsWith(root + path.sep)) return deny(res);
        // Judged by the file it reaches, not the spelling ('vendor%2f..%2fpair.html', 'PAIR.html' on Windows).
        if (PC_PAGES.has(path.relative(root, abs).toLowerCase()) && !loop) return deny(res);
        if (!authed && !PUBLIC.has(rel)) return deny(res);
        return serveFile(res, abs);
      }
      if (!authed) return deny(res);
      if (p === '/api/behaviours') return json(res, { map: getBehaviours(), defaults: DEFAULT_MAP });
      if (p === '/') {
        // The cookie is only for token logins from other devices. Loopback never needs it, and cookies
        // ignore ports, so one set on localhost would be sent to every other local service: clear any old one.
        return serveFile(res, path.join(root, 'index.html'), {
          'set-cookie': loop ? 'dc=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'
            : `dc=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
        });
      }
      if (p === '/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write('retry: 3000\n\n');
        send(res, 'snapshot', getSnapshot());
        send(res, 'behaviours', { map: getBehaviours() });
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      return deny(res, 404);
    } catch (e) {
      log(`http ${p}: ${e.message}`);
      if (!res.headersSent) deny(res, 400);
    }
  });

  return {
    server, broadcast, clients,
    close() {
      clearInterval(ping);
      for (const r of clients) r.end();
      server.close();
    },
  };
}
