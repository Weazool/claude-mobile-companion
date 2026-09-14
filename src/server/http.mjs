import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
};
const PUBLIC = new Set(['manifest.webmanifest', 'icon.png']); // browsers fetch manifests without cookies
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;

export function isLoopback(req) {
  return LOOPBACK.has(req.socket.remoteAddress);
}

// DNS rebinding guard: a web page whose own name was rebound to 127.0.0.1 reaches us from a loopback
// address, but its requests still carry its own name in Host.
export function isLoopbackHost(host) {
  return typeof host === 'string' && LOOPBACK_HOST.test(host);
}

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

export function createApp({ token, webRoot, getSnapshot, onHook, onDevLimits, getPairInfo, log = () => {}, isLoopbackReq = isLoopback }) {
  const root = path.resolve(webRoot);
  const clients = new Set();
  const send = (res, type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  const broadcast = (type, data) => { for (const res of clients) send(res, type, data); };
  const ping = setInterval(() => broadcast('ping', {}), 20000);
  ping.unref();

  const deny = (res, code = 403) =>
    res.writeHead(code, { 'content-type': 'text/plain' }).end(code === 404 ? 'Not found' : code === 400 ? 'Bad request' : 'Forbidden');
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
      if (req.method !== 'GET') return deny(res, 405);
      if (p === '/api/health') return loop ? json(res, { ok: true, pid: process.pid }) : deny(res);
      if (p === '/pair') return loop ? serveFile(res, path.join(root, 'pair.html')) : deny(res);
      if (p === '/api/pair-info') return loop ? json(res, { ...getPairInfo(), pages: clients.size }) : deny(res);
      if (p.startsWith('/web/')) {
        const rel = decodeURIComponent(p.slice(5));
        const abs = path.resolve(root, rel);
        if (!abs.startsWith(root + path.sep)) return deny(res);
        if (rel === 'pair.html' && !loop) return deny(res); // the pair page is loopback-only (spec §2)
        if (!authed && !PUBLIC.has(rel)) return deny(res);
        return serveFile(res, abs);
      }
      if (!authed) return deny(res);
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
