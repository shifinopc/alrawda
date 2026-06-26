const { query } = require('./db');

// Security preferences (stored as JSON under app_settings key 'security').
// Defaults are deliberately SAFE: ipAllowEnabled is off so a misconfiguration
// can never lock everyone out; singleSession is on (new login ends old ones).
const DEFAULTS = {
  singleSession: true,      // a new login invalidates the user's earlier sessions
  idleMinutes: 0,           // client-side auto-logout after N idle minutes (0 = off)
  ipAllowEnabled: false,    // block logins from IPs not in the allowlist
  ipAllowlist: [],          // IP prefixes or exact IPs, e.g. "178.153." (Qatar)
  notifyNewDevice: true,    // email the user on sign-in from a new IP
  notifyAdminAction: true,  // email admins on role change / password reset
};

async function getSecurity() {
  const rows = await query("SELECT v FROM app_settings WHERE k = 'security'").catch(() => []);
  if (!rows.length) return { ...DEFAULTS };
  try { return { ...DEFAULTS, ...JSON.parse(rows[0].v) }; } catch { return { ...DEFAULTS }; }
}

// the real client IP behind cPanel/Passenger (trust proxy is set in server.js)
function clientIp(req) {
  const xf = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim();
  return (xf || req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

// is the client IP allowed? (only enforced when the allowlist is on AND non-empty)
function ipAllowed(sec, ip) {
  if (!sec.ipAllowEnabled) return true;
  const list = (sec.ipAllowlist || []).map((s) => String(s).trim()).filter(Boolean);
  if (!list.length) return true; // empty list ⇒ don't lock anyone out
  const norm = String(ip || '').replace(/^::ffff:/, '');
  return list.some((p) => norm === p || norm.startsWith(p));
}

module.exports = { getSecurity, clientIp, ipAllowed, SECURITY_DEFAULTS: DEFAULTS };
