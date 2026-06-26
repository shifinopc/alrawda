const jwt = require('jsonwebtoken');
const { ensureFresh, cutoffFor } = require('../sessionGuard');
const sessionStore = require('../sessionStore');

async function authRequired(req, res, next) {
  // prefer the httpOnly cookie; fall back to the Authorization header (back-compat / API clients)
  const header = req.headers.authorization || '';
  const token = (req.cookies && req.cookies.token) || (header.startsWith('Bearer ') ? header.slice(7) : null);
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  req.user = payload;
  // honour admin "force logout": reject tokens issued before the user's cutoff
  try {
    await ensureFresh();
    const nowSec = Math.floor(Date.now() / 1000);
    // A genuine force-logout cutoff is always at/before "now". A cutoff in the future
    // means clock skew or stale imported data — ignore it so it can never lock a user
    // out permanently (a freshly issued token would otherwise always be rejected).
    const blocked = (uid) => {
      const cutoff = cutoffFor(uid);
      return cutoff && cutoff <= nowSec + 60 && payload.iat && payload.iat < cutoff;
    };
    // check the acting identity AND, during impersonation, the real admin — so force-logging-out
    // an admin immediately ends any "Login as" session they started
    if (blocked(payload.id) || (payload.impersonator && blocked(payload.impersonator.id))) {
      return res.status(401).json({ error: 'Your session was ended by an administrator. Please sign in again.' });
    }
    // per-device revoke: reject this specific token if its session was revoked
    // (only tokens that carry a jti — older tokens without one are unaffected)
    if (payload.jti) {
      await sessionStore.ensureFresh();
      if (sessionStore.isRevoked(payload.jti)) {
        return res.status(401).json({ error: 'This device was signed out. Please sign in again.' });
      }
    }
  } catch {
    /* fail open — never lock everyone out on a cache error */
  }
  next();
}

const ADMINS = ['Super Admin', 'Admin'];
const MANAGERS = ['Super Admin', 'Admin', 'Manager'];

/** Route guard: require one of the given roles (use ADMINS / MANAGERS). */
function requireRole(roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ error: 'Insufficient permissions for this action' });
    }
    next();
  };
}

module.exports = { authRequired, requireRole, ADMINS, MANAGERS };
