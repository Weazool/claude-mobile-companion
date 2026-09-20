import os from 'node:os';

const rank = ip => (/^192\.168\./.test(ip) ? 0 : /^10\./.test(ip) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
// Virtual, VPN, capture and hotspot adapters (os.networkInterfaces() keys are adapter names). A phone on the
// Wi-Fi rarely reaches their addresses, even when they sit in 192.168.x.
const VIRTUAL = /vEthernet|VirtualBox|VMware|vmnet|Hyper-V|WSL|Docker|Loopback|Bluetooth|Npcap|TAP-|Tailscale|ZeroTier|Local Area Connection\*/i;

// Non-internal IPv4 addresses: real adapters before virtual ones, then home-network ranges first
// (192.168, then 10, then 172.16-31).
export function lanAddresses(ifaces = os.networkInterfaces()) {
  const out = [];
  for (const [name, list] of Object.entries(ifaces)) {
    const penalty = VIRTUAL.test(name) ? 1 : 0;
    for (const a of list || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push({ ip: a.address, penalty });
    }
  }
  out.sort((a, b) => a.penalty - b.penalty || rank(a.ip) - rank(b.ip));
  return [...new Set(out.map(a => a.ip))];
}

function listenOnce(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = e => { server.off('listening', onListening); reject(e); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

// Binds to `port`, and only ever to `port`: the phone's link holds the port and the token, so the server never
// moves itself to another one. A port can be busy for a moment (a socket from the server we just replaced, or a
// port block Windows has reserved), so it retries a few times, and then reports back instead of wandering off.
// Resolves { bound: true }; { bound: false, ours } when another desk-companion answers there (its /api/health,
// so the caller can compare versions); or { bound: false, code } with the last EADDRINUSE / EACCES.
export async function listenFixed(server, port, { health, log = () => {}, tries = 4, waitMs = 400, host = '0.0.0.0', sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  let code = '';
  for (let i = 0; i < tries; i++) {
    if (i > 0) await sleep(waitMs);
    try {
      await listenOnce(server, port, host);
      return { bound: true };
    } catch (e) {
      if (e.code !== 'EACCES' && e.code !== 'EADDRINUSE') throw e;
      code = e.code;
      const ours = e.code === 'EADDRINUSE' ? await health(port) : null;
      if (ours) return { bound: false, ours };
      if (i + 1 < tries) log(`port ${port} unavailable (${e.code}), trying again`);
    }
  }
  return { bound: false, code };
}

export function phoneUrls({ port, token }, ifaces, hostname = os.hostname()) {
  const urls = lanAddresses(ifaces).map(ip => `http://${ip}:${port}/?k=${token}`);
  if (hostname) urls.push(`http://${hostname.toLowerCase()}.local:${port}/?k=${token}`);
  return urls;
}
