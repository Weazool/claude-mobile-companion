// One server, one port, one token. Two versions of the plugin can be installed at once (a session keeps the
// plugin root it started with, so its hooks can still launch an older copy), and the one thing that must never
// happen is two servers, because then the phone's link and the sessions' events end up on different endpoints.
// So a starting server asks whoever answers its port: the newer version serves, the other stands down.

// -1, 0 or 1 for a < b, a === b, a > b. Anything unreadable counts as 0.0.0, so a server old enough not to
// report a version at all loses to every release.
export function compareVersions(a, b) {
  const parts = v => String(v ?? '').split('.').map(n => Number.parseInt(n, 10) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length, 3); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

// What a server starting at version `ours` does about the desk-companion already answering on its port
// (`running`, its /api/health answer, or null when nothing of ours is there):
//   'bind'       nothing of ours on the port: serve it
//   'stand-down' the running one is the same version or newer: leave it alone and exit
//   'take-over'  ours is newer: stop that one, then serve the port ourselves
export function startupAction(ours, running) {
  if (!running) return 'bind';
  return compareVersions(ours, running.version) > 0 ? 'take-over' : 'stand-down';
}
