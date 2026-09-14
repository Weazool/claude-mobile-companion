import os from 'node:os';

const rank = ip => (/^192\.168\./.test(ip) ? 0 : /^10\./.test(ip) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);

// Non-internal IPv4 addresses, home-network ranges first (192.168, then 10, then 172.16-31).
export function lanAddresses(ifaces = os.networkInterfaces()) {
  const out = [];
  for (const list of Object.values(ifaces)) {
    for (const a of list || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push(a.address);
    }
  }
  return [...new Set(out)].sort((a, b) => rank(a) - rank(b));
}

export function phoneUrls({ port, token }, ifaces, hostname = os.hostname()) {
  const urls = lanAddresses(ifaces).map(ip => `http://${ip}:${port}/?k=${token}`);
  if (hostname) urls.push(`http://${hostname.toLowerCase()}.local:${port}/?k=${token}`);
  return urls;
}
