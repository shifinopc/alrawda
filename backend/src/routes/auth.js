const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query } = require('../db');

// stricter, counts every call (the endpoint always 200s, so the mount-level limiter would skip it)
const forgotLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many password-reset requests — try again later.' } });

// httpOnly auth cookie options.
//  - COOKIE_SECURE=true  in production (HTTPS) so the cookie is only sent over TLS
//  - COOKIE_SAMESITE=lax for same-site subdomains (stimesapp↔stimesapi); 'none' if truly cross-site
//  - COOKIE_DOMAIN=.ionob.in to share across subdomains (optional)
const COOKIE_NAME = 'token';
function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: process.env.COOKIE_SAMESITE || 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    domain: process.env.COOKIE_DOMAIN || undefined,
    path: '/',
    maxAge: 12 * 60 * 60 * 1000, // 12h — keep in sync with JWT_EXPIRES
  };
}
// set the httpOnly auth cookie (the primary credential; authRequired reads it before the header).
// maxAgeMs lets callers shorten it (e.g. impersonation = 1h).
function setAuthCookie(res, token, maxAgeMs) {
  res.cookie(COOKIE_NAME, token, { ...cookieOpts(), maxAge: maxAgeMs ?? cookieOpts().maxAge });
}
const { authRequired } = require('../middleware/auth');
const { validatePassword, getPolicy } = require('../passwordPolicy');
const { sendMail, isConfigured } = require('../mailer');
const { getSecurity, clientIp, ipAllowed } = require('../security');
const { markInvalid } = require('../sessionGuard');
const { createSession } = require('../sessionStore');
const { generateSecret, verifyTotp, otpauthUri } = require('../totp');

const router = express.Router();

/** Ensure web-app users table exists and seed default admin. */
async function ensureAppUsers() {
  await query(`CREATE TABLE IF NOT EXISTS app_users (
    id INT NOT NULL AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(100) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NULL,
    role VARCHAR(30) NOT NULL DEFAULT 'Employee',
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME NULL,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  // ensure the must-change-password column exists before seeding (added fully in users.js)
  await query('ALTER TABLE app_users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0').catch(() => {});
  // 2FA (TOTP): mfa = enabled flag, mfa_secret = the user's base32 secret
  await query('ALTER TABLE app_users ADD COLUMN mfa TINYINT(1) NOT NULL DEFAULT 0').catch(() => {});
  await query('ALTER TABLE app_users ADD COLUMN mfa_secret VARCHAR(64) NULL').catch(() => {});
  const rows = await query("SELECT id FROM app_users WHERE username = 'admin'");
  if (rows.length === 0) {
    const initial = process.env.SEED_ADMIN_PASSWORD || 'admin@123';
    const hash = await bcrypt.hash(initial, 10);
    await query(
      `INSERT INTO app_users (username, password_hash, display_name, role, active, must_change_password) VALUES (?,?,?,?,1,1)`,
      ['admin', hash, 'Admin', 'Super Admin']
    );
    console.log(process.env.SEED_ADMIN_PASSWORD
      ? 'Seeded admin user — password change is required at first login.'
      : 'Seeded admin: username "admin", temporary password "admin@123" — change is REQUIRED at first login.');
  }
}

let auditEnsured = null;
function ensureLoginAudit() {
  if (!auditEnsured) {
    auditEnsured = query(`CREATE TABLE IF NOT EXISTS app_login_audit (
      id INT NOT NULL AUTO_INCREMENT,
      user_id INT NULL,
      ip VARCHAR(64) NULL,
      user_agent VARCHAR(300) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id), KEY idx_user (user_id), KEY idx_time (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
      // record failed attempts too (success=0), incl. the typed username for unknown accounts
      .then(() => query('ALTER TABLE app_login_audit MODIFY user_id INT NULL').catch(() => {}))
      .then(() => query('ALTER TABLE app_login_audit ADD COLUMN success TINYINT(1) NOT NULL DEFAULT 1').catch(() => {}))
      .then(() => query('ALTER TABLE app_login_audit ADD COLUMN username VARCHAR(50) NULL').catch(() => {}))
      .then(() => query('ALTER TABLE app_login_audit ADD COLUMN reason VARCHAR(40) NULL').catch(() => {}))
      .catch(() => {});
  }
  return auditEnsured;
}

// record a failed/blocked login attempt (never throws)
async function logLoginAttempt({ userId = null, username = null, ip, userAgent, success, reason = null }) {
  try {
    await ensureLoginAudit();
    await query(
      'INSERT INTO app_login_audit (user_id, username, ip, user_agent, success, reason) VALUES (?,?,?,?,?,?)',
      [userId, (username || '').slice(0, 50), (ip || '').slice(0, 64), (userAgent || '').slice(0, 300), success ? 1 : 0, reason]
    );
  } catch { /* auditing must never break login */ }
}

/* ---- login throttle: lock an account after N failed attempts (policy.pwLockout) ---- */
const LOCK_MINUTES = 15;
const attempts = new Map(); // username -> { count, lockedUntil }

function lockState(username) {
  return attempts.get(username) || { count: 0, lockedUntil: 0 };
}
function recordFail(username, max) {
  const s = lockState(username);
  s.count += 1;
  if (max && s.count >= max) { s.lockedUntil = Date.now() + LOCK_MINUTES * 60000; s.count = 0; }
  attempts.set(username, s);
}
function clearFails(username) { attempts.delete(username); }

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  const ip = clientIp(req);
  const ua = (req.headers['user-agent'] || '').toString();
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

  const sec = await getSecurity();
  // opt-in network allowlist — block logins from IPs outside the configured list
  if (!ipAllowed(sec, ip)) {
    await logLoginAttempt({ username, ip, userAgent: ua, success: false, reason: 'blocked-ip' });
    return res.status(403).json({ error: 'Login is not permitted from your network. Contact an administrator.' });
  }

  const s = lockState(username);
  if (s.lockedUntil && s.lockedUntil > Date.now()) {
    const mins = Math.ceil((s.lockedUntil - Date.now()) / 60000);
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${mins} minute(s).` });
  }

  const policy = await getPolicy();
  const lockoutMax = Number(policy.pwLockout) || 0; // 0 = disabled

  const rows = await query('SELECT * FROM app_users WHERE username = ? AND active = 1', [username]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    if (lockoutMax) recordFail(username, lockoutMax);
    await logLoginAttempt({ userId: user?.id ?? null, username, ip, userAgent: ua, success: false, reason: user ? 'bad-password' : 'unknown-user' });
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  clearFails(username);

  // 2FA gate: if the user has TOTP enabled, issue only a short-lived challenge token —
  // the real session is granted by /login/2fa after the 6-digit code is verified.
  if (user.mfa && user.mfa_secret) {
    const mfaToken = jwt.sign({ pending2fa: user.id }, process.env.JWT_SECRET, { expiresIn: '5m' });
    return res.json({ mfaRequired: true, mfaToken });
  }

  return completeLogin(req, res, user);
});

// finish a login (shared by password-only and post-2FA): issue the session token, enforce
// single active session, audit success, and alert on a sign-in from a new device.
async function completeLogin(req, res, user) {
  const ip = clientIp(req);
  const ua = (req.headers['user-agent'] || '').toString();
  const sec = await getSecurity();
  await ensureLoginAudit();
  let knownIp = true;
  try {
    const seen = await query('SELECT 1 FROM app_login_audit WHERE user_id=? AND ip=? AND success=1 LIMIT 1', [user.id, ip.slice(0, 64)]);
    knownIp = seen.length > 0;
  } catch { /* treat as known on error */ }

  await query('UPDATE app_users SET last_login = NOW() WHERE id = ?', [user.id]);
  const jti = await createSession(user.id, ip, ua); // register this device for per-session revoke
  const payload = { id: user.id, username: user.username, name: user.display_name, role: user.role, jti };
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES || '12h' });
  if (sec.singleSession) {
    const iat = jwt.decode(token)?.iat || Math.floor(Date.now() / 1000); // pin cutoff to this token (no skew lockout)
    await query('UPDATE app_users SET sessions_invalid_before = FROM_UNIXTIME(?) WHERE id = ?', [iat, user.id]).catch(() => {});
    markInvalid(user.id, iat);
  }
  await logLoginAttempt({ userId: user.id, username: user.username, ip, userAgent: ua, success: true });
  if (!knownIp && sec.notifyNewDevice) require('../notify').notifyNewDeviceLogin(user, ip, ua); // fire-and-forget
  res.cookie(COOKIE_NAME, token, cookieOpts());
  res.json({ token, user: payload, mustChangePassword: !!user.must_change_password });
}

// POST /api/auth/login/2fa — second step: verify the TOTP code, then grant the session
router.post('/login/2fa', async (req, res) => {
  const { mfaToken, code } = req.body || {};
  let pendingId = null;
  try { pendingId = jwt.verify(mfaToken, process.env.JWT_SECRET, { algorithms: ['HS256'] }).pending2fa; }
  catch { return res.status(401).json({ error: 'Your verification step expired. Please sign in again.' }); }
  if (!pendingId) return res.status(400).json({ error: 'Invalid verification request' });
  const [user] = await query('SELECT * FROM app_users WHERE id = ? AND active = 1', [pendingId]);
  if (!user || !user.mfa_secret) return res.status(401).json({ error: 'Two-factor authentication is not set up.' });
  if (!verifyTotp(user.mfa_secret, code)) {
    await logLoginAttempt({ userId: user.id, username: user.username, ip: clientIp(req), userAgent: req.headers['user-agent'], success: false, reason: 'bad-2fa' });
    return res.status(401).json({ error: 'Invalid authentication code.' });
  }
  return completeLogin(req, res, user);
});

/* ---- 2FA enrolment (each user manages their own authenticator) ---- */
router.post('/2fa/setup', authRequired, async (req, res) => {
  const secret = generateSecret();
  await query('UPDATE app_users SET mfa_secret = ? WHERE id = ?', [secret, req.user.id]); // stored but not enabled yet
  const [u] = await query('SELECT username FROM app_users WHERE id = ?', [req.user.id]);
  res.json({ secret, otpauth: otpauthUri(secret, u?.username || 'user') });
});
router.post('/2fa/enable', authRequired, async (req, res) => {
  const { code } = req.body || {};
  const [u] = await query('SELECT mfa_secret FROM app_users WHERE id = ?', [req.user.id]);
  if (!u || !u.mfa_secret) return res.status(400).json({ error: 'Start the setup first.' });
  if (!verifyTotp(u.mfa_secret, code)) return res.status(400).json({ error: 'That code did not match — try again.' });
  await query('UPDATE app_users SET mfa = 1 WHERE id = ?', [req.user.id]);
  res.json({ ok: true, enabled: true });
});
router.post('/2fa/disable', authRequired, async (req, res) => {
  const { password } = req.body || {};
  const [u] = await query('SELECT password_hash FROM app_users WHERE id = ?', [req.user.id]);
  if (!u || !(await bcrypt.compare(password || '', u.password_hash))) return res.status(401).json({ error: 'Password is incorrect.' });
  await query('UPDATE app_users SET mfa = 0, mfa_secret = NULL WHERE id = ?', [req.user.id]);
  res.json({ ok: true, enabled: false });
});
router.get('/2fa/status', authRequired, async (req, res) => {
  const [u] = await query('SELECT mfa, mfa_secret FROM app_users WHERE id = ?', [req.user.id]);
  res.json({ enabled: !!(u && u.mfa && u.mfa_secret) });
});

router.get('/me', authRequired, (req, res) => res.json({ user: req.user }));

// POST /api/auth/logout — clear the auth cookie
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOpts(), maxAge: undefined });
  res.json({ ok: true });
});

// POST /api/auth/stop-impersonate — return from an impersonation session to the real admin.
// Trust comes from the signed `impersonator` claim in the current (impersonation) token.
router.post('/stop-impersonate', authRequired, async (req, res) => {
  const imp = req.user.impersonator;
  if (!imp || !imp.id) return res.status(400).json({ error: 'You are not impersonating anyone.' });
  const rows = await query('SELECT id, username, display_name, role, active FROM app_users WHERE id = ?', [imp.id]);
  const admin = rows[0];
  if (!admin || !admin.active) {
    return res.status(401).json({ error: 'Your original account is no longer available. Please sign in again.' });
  }
  const payload = { id: admin.id, username: admin.username, name: admin.display_name, role: admin.role };
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES || '12h' });
  setAuthCookie(res, token); // restore the admin cookie (cookie-first auth)
  res.json({ token, user: payload });
});

router.post('/change-password', authRequired, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword) return res.status(400).json({ error: 'Current password is required' });
  const policyError = await validatePassword(newPassword);
  if (policyError) return res.status(400).json({ error: policyError });
  const rows = await query('SELECT * FROM app_users WHERE id = ?', [req.user.id]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  const hash = await bcrypt.hash(newPassword, 10);
  await query('UPDATE app_users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [hash, req.user.id]);
  res.json({ ok: true });
});

/* ---- forgot password: emails a one-time, time-limited reset LINK (no instant reset) ---- */
let resetTableEnsured = null;
function ensureResetTable() {
  if (!resetTableEnsured) {
    resetTableEnsured = query(`CREATE TABLE IF NOT EXISTS password_resets (
      id INT NOT NULL AUTO_INCREMENT,
      user_id INT NOT NULL,
      token_hash CHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      used TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id), KEY idx_token (token_hash), KEY idx_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
  return resetTableEnsured;
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const RESET_TTL_MIN = 30;

router.post('/forgot-password', forgotLimiter, async (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'Enter your username or email' });
  if (!(await isConfigured())) {
    return res.status(503).json({ error: 'Email is not configured. Please ask an administrator to reset your password.' });
  }
  await ensureResetTable();
  const rows = await query(
    'SELECT * FROM app_users WHERE (username = ? OR email = ?) AND active = 1', [username, username]);
  const user = rows[0];
  // generic response either way (don't reveal whether the account exists)
  if (user && user.email) {
    const raw = crypto.randomBytes(32).toString('hex'); // the secret in the link
    await query('UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0', [user.id]); // invalidate older links
    await query(
      'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))',
      [user.id, sha256(raw), RESET_TTL_MIN]);
    const base = (process.env.APP_URL || (process.env.CORS_ORIGIN || '').split(',')[0] || req.headers.origin || '').replace(/\/$/, '');
    const link = `${base}/reset?token=${raw}`;
    await sendMail({
      to: user.email,
      subject: 'AL RAWDA ERP — password reset',
      text: `Hello ${user.display_name},\n\nReset your password using this link (valid for ${RESET_TTL_MIN} minutes):\n${link}\n\nIf you didn't request this, ignore this email — your password stays unchanged.`,
      html: `<p>Hello ${user.display_name},</p><p>Reset your password using the link below (valid for <b>${RESET_TTL_MIN} minutes</b>):</p><p><a href="${link}">Reset my password</a></p><p>If you didn't request this, ignore this email — your password stays unchanged.</p>`,
    });
  }
  res.json({ ok: true, message: 'If the account exists, a password-reset link has been emailed.' });
});

// POST /api/auth/reset-password { token, newPassword } — consume a reset link
router.post('/reset-password', forgotLimiter, async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Reset link is invalid' });
  const policyError = await validatePassword(newPassword);
  if (policyError) return res.status(400).json({ error: policyError });
  await ensureResetTable();
  const [row] = await query(
    'SELECT * FROM password_resets WHERE token_hash = ? AND used = 0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1',
    [sha256(token)]);
  if (!row) return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });
  const hash = await bcrypt.hash(newPassword, 10);
  await query('UPDATE app_users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [hash, row.user_id]);
  await query('UPDATE password_resets SET used = 1 WHERE id = ?', [row.id]);
  // sign out any existing sessions for that user (the password just changed)
  await query('UPDATE app_users SET sessions_invalid_before = DATE_ADD(NOW(), INTERVAL 1 SECOND) WHERE id = ?', [row.user_id]).catch(() => {});
  res.json({ ok: true, message: 'Your password has been reset. Please sign in with your new password.' });
});

module.exports = { router, ensureAppUsers, setAuthCookie };
