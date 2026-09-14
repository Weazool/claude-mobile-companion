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

// Binds to `port`. Hyper-V, WSL and Docker reserve moving port blocks inside 50000-60000 (EACCES), and a
// foreign program may hold the port (EADDRINUSE with no health answer from us); then it tries fresh ports
// from pickPort(), `attempts` binds in all. Resolves { port, code } with the bound port and the first port's
// error code (''), or null when health() shows another instance of ours already serves `port`.
export async function listenWithFallback(server, port, { health, pickPort, log = () => {}, attempts = 5, host = '0.0.0.0' }) {
  const first = port;
  const tried = new Set();
  let code = '';
  let lastCode = '';
  for (let i = 0; i < attempts; i++) {
    tried.add(port);
    try {
      await listenOnce(server, port, host);
      return { port, code };
    } catch (e) {
      if (e.code !== 'EACCES' && e.code !== 'EADDRINUSE') throw e;
      if (port === first && e.code === 'EADDRINUSE' && await health(port)) return null; // lost a start-up race
      if (port === first) code = e.code;
      else log(`port ${port} unavailable (${e.code})`);
      lastCode = e.code;
      do { port = pickPort(); } while (tried.has(port));
    }
  }
  throw new Error(`gave up after ${attempts} ports (${lastCode})`);
}

export function phoneUrls({ port, token }, ifaces, hostname = os.hostname()) {
  const urls = lanAddresses(ifaces).map(ip => `http://${ip}:${port}/?k=${token}`);
  if (hostname) urls.push(`http://${hostname.toLowerCase()}.local:${port}/?k=${token}`);
  return urls;
}
