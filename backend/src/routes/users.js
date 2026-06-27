const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { validatePassword } = require('../passwordPolicy');
const { sendMail, notifyEnabled } = require('../mailer');
const { markInvalid } = require('../sessionGuard');
const { requirePermission, roleRank } = require('../permissions');
const { setAuthCookie } = require('./auth');
const { getSecurity } = require('../security');
const { markRevoked } = require('../sessionStore');

const router = express.Router();

// fire-and-forget admin-action email alert (gated by the security setting)
async function maybeAlert(req, summary, detail) {
  try {
    const sec = await getSecurity();
    if (sec.notifyAdminAction) require('../notify').notifyAdminAction(req.user?.name, summary, detail);
  } catch { /* never break the request */ }
}

const ADMIN_ROLES = ['Super Admin', 'Admin'];
function adminOnly(req, res, next) {
  if (!ADMIN_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

const PHOTO_MAX = 700 * 1024; // ~700 KB of base64 (≈ 500 KB image)
function photoTooBig(b) {
  return typeof b.photo === 'string' && b.photo.length > PHOTO_MAX;
}

/* ---- extend app_users with profile columns (idempotent) ---- */
let ensured = null;
async function ensureCols() {
  if (ensured) return ensured;
  ensured = (async () => {
    const cols = await query(
      `SELECT COLUMN_NAME FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'app_users'`
    );
    const have = new Set(cols.map((c) => c.COLUMN_NAME));
    const wanted = [
      ['mobile', 'VARCHAR(30) NULL'],
      ['department', 'VARCHAR(50) NULL'],
      ['designation', 'VARCHAR(50) NULL'],
      ['reporting_to', 'VARCHAR(100) NULL'],
      ['status', "VARCHAR(20) NOT NULL DEFAULT 'Active'"],
      ['mfa', 'TINYINT(1) NOT NULL DEFAULT 0'],
      ['photo', 'MEDIUMTEXT NULL'],
      ['must_change_password', 'TINYINT(1) NOT NULL DEFAULT 0'],
      ['sessions_invalid_before', 'DATETIME NULL'],
    ];
    for (const [name, def] of wanted) {
      if (!have.has(name)) {
        await query(`ALTER TABLE app_users ADD COLUMN ${name} ${def}`);
        if (name === 'status') {
          await query(`UPDATE app_users SET status = IF(active = 1, 'Active', 'Inactive')`);
        }
      }
    }
  })();
  return ensured;
}

const USER_FIELDS = `id, username, display_name, email, role, active, status, mobile,
  department, designation, reporting_to, mfa, photo, must_change_password, legacy_user_code, created_at, last_login`;

// GET /api/users — full directory (admins, or any role granted User Management → View,
// so impersonation-capable managers can pick a user)
router.get('/', requirePermission('User Management', 'View'), async (_req, res) => {
  await ensureCols();
  // Super Admin accounts (e.g. the master `admin`) are hidden from the directory for everyone.
  const rows = await query(`SELECT ${USER_FIELDS} FROM app_users WHERE COALESCE(role,'') <> 'Super Admin' ORDER BY id`);
  res.json({ rows });
});

// GET /api/users/me — the signed-in user's own profile (any authenticated user)
router.get('/me', async (req, res) => {
  await ensureCols();
  const [u] = await query(`SELECT ${USER_FIELDS} FROM app_users WHERE id = ?`, [req.user.id]);
  if (!u) return res.status(404).json({ error: 'User not found' });
  res.json({ user: u });
});

// PUT /api/users/me — edit own profile (name / email / mobile / photo only — never role or status)
router.put('/me', async (req, res) => {
  await ensureCols();
  const b = req.body || {};
  if (!b.displayName || !b.displayName.trim()) return res.status(400).json({ error: 'Full name is required' });
  if (photoTooBig(b)) return res.status(413).json({ error: 'Photo is too large — keep it under ~500 KB' });
  await query(
    `UPDATE app_users SET display_name = ?, email = ?, mobile = ?, photo = IFNULL(?, photo) WHERE id = ?`,
    [b.displayName.trim(), b.email || null, b.mobile || null, b.photo ?? null, req.user.id]
  );
  res.json({ ok: true, displayName: b.displayName.trim() });
});

// POST /api/users/:id/impersonate — "Login as" the selected user.
//  • caller needs User Management → Edit (admins bypass)
//  • cannot impersonate yourself, an inactive user, or any administrator (no privilege escalation)
//  • cannot start a second impersonation without returning first
//  • issues a short-lived token carrying the target's identity + a signed `impersonator` claim,
//    so permission checks and the audit trail both work transparently
router.post('/:id/impersonate', requirePermission('User Management', 'Edit'), async (req, res) => {
  await ensureCols();
  if (req.user.impersonator) {
    return res.status(400).json({ error: 'You are already impersonating someone — return to your account first.' });
  }
  if (String(req.params.id) === String(req.user.id)) {
    return res.status(400).json({ error: 'You cannot log in as yourself.' });
  }
  // a reason is required for accountability — it lands in the activity log (detail)
  const reason = (req.body && req.body.reason ? String(req.body.reason) : '').trim();
  if (!reason) return res.status(400).json({ error: 'Please provide a reason for logging in as this user.' });
  const [target] = await query(
    'SELECT id, username, display_name, role, active, status FROM app_users WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (!target.active || target.status !== 'Active') {
    return res.status(400).json({ error: 'That account is inactive — you can only log in as an active user.' });
  }
  // you may only log in as a strictly LOWER-privilege role (Super Admin can act as Admin↓,
  // Admin can act as Manager↓, etc.) — never an equal or higher role
  if (roleRank(target.role) >= roleRank(req.user.role)) {
    return res.status(403).json({ error: 'You can only log in as a user whose role is below yours.' });
  }
  const payload = {
    id: target.id, username: target.username, name: target.display_name, role: target.role,
    impersonator: { id: req.user.id, username: req.user.username, name: req.user.name, role: req.user.role },
  };
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' }); // short-lived
  setAuthCookie(res, token, 60 * 60 * 1000); // switch the cookie too, so cookie-first auth uses this identity
  res.json({ token, user: payload });
});

function profileParams(b) {
  return {
    email: b.email || null,
    role: b.role || 'Employee',
    status: b.status || 'Active',
    mobile: b.mobile || null,
    department: b.department || null,
    designation: b.designation || null,
    reporting_to: b.reportingTo || null,
    mfa: b.mfa ? 1 : 0,
    photo: b.photo || null,
  };
}

// POST /api/users
router.post('/', adminOnly, async (req, res) => {
  await ensureCols();
  const b = req.body || {};
  const { username, password, displayName } = b;
  if (!username || !password || !displayName) {
    return res.status(400).json({ error: 'Username, password and full name are required' });
  }
  const policyError = await validatePassword(password);
  if (policyError) return res.status(400).json({ error: policyError });
  if (photoTooBig(b)) return res.status(413).json({ error: 'Photo is too large — keep it under ~500 KB' });
  const exists = await query('SELECT id FROM app_users WHERE username = ?', [username]);
  if (exists.length) return res.status(409).json({ error: 'Username already exists' });
  const hash = await bcrypt.hash(password, 10);
  const p = profileParams(b);
  const r = await query(
    `INSERT INTO app_users (username, password_hash, display_name, email, role, active, status,
       mobile, department, designation, reporting_to, photo)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [username, hash, displayName, p.email, p.role, p.status === 'Active' ? 1 : 0, p.status,
     p.mobile, p.department, p.designation, p.reporting_to, p.photo]
  );
  // welcome email (best-effort) if enabled in Email Settings and the user has an email
  let emailed = false;
  if (p.email && b.welcomeEmail !== false && await notifyEnabled('notifyWelcome')) {
    const sent = await sendMail({
      to: p.email,
      subject: 'Welcome to AL RAWDA ERP',
      text: `Hello ${displayName},\n\nAn account has been created for you.\nUsername: ${username}\nPassword: ${password}\n\nPlease sign in and change your password under Settings → My Account.`,
      html: `<p>Hello ${displayName},</p><p>An account has been created for you on AL RAWDA ERP.</p><p>Username: <b>${username}</b><br/>Password: <b>${password}</b></p><p>Please sign in and change your password under <b>Settings → My Account</b>.</p>`,
    });
    emailed = sent.ok;
  }
  res.status(201).json({ id: r.insertId, emailed });
});

// PUT /api/users/:id
router.put('/:id', adminOnly, async (req, res) => {
  await ensureCols();
  const b = req.body || {};
  if (photoTooBig(b)) return res.status(413).json({ error: 'Photo is too large — keep it under ~500 KB' });
  const p = profileParams(b);
  // detect a role/status change → force re-login so the new permissions take effect immediately
  const [before] = await query('SELECT role, status FROM app_users WHERE id = ?', [req.params.id]);
  const r = await query(
    `UPDATE app_users SET display_name=?, email=?, role=?, active=?, status=?,
       mobile=?, department=?, designation=?, reporting_to=?, photo=?
     WHERE id=?`,
    [b.displayName, p.email, p.role, p.status === 'Active' ? 1 : 0, p.status,
     p.mobile, p.department, p.designation, p.reporting_to, p.photo, req.params.id]
  );
  if (!r.affectedRows) return res.status(404).json({ error: 'User not found' });
  if (before && (before.role !== p.role || (before.status === 'Active') !== (p.status === 'Active'))) {
    await query('UPDATE app_users SET sessions_invalid_before = DATE_ADD(NOW(), INTERVAL 1 SECOND) WHERE id = ?', [req.params.id]);
    markInvalid(req.params.id, Math.floor(Date.now() / 1000) + 1);
  }
  // alert management when a role is changed (the security-sensitive case)
  if (before && before.role !== p.role) {
    maybeAlert(req, `Role changed for ${b.displayName || 'user #' + req.params.id}`, `From "${before.role}" to "${p.role}".`);
  }
  res.json({ ok: true });
});

// POST /api/users/:id/reset-password
router.post('/:id/reset-password', adminOnly, async (req, res) => {
  const { newPassword } = req.body || {};
  const policyError = await validatePassword(newPassword);
  if (policyError) return res.status(400).json({ error: policyError });
  const hash = await bcrypt.hash(newPassword, 10);
  const [tgt] = await query('SELECT display_name FROM app_users WHERE id=?', [req.params.id]);
  // admin-set password is temporary → force the user to change it on next login
  const r = await query('UPDATE app_users SET password_hash=?, must_change_password=1 WHERE id=?', [hash, req.params.id]);
  if (!r.affectedRows) return res.status(404).json({ error: 'User not found' });
  maybeAlert(req, `Password reset for ${tgt?.display_name || 'user #' + req.params.id}`, 'An administrator set a new temporary password.');
  res.json({ ok: true });
});

// POST /api/users/:id/reset-2fa — clear a user's 2FA (recovery when they lose their authenticator)
router.post('/:id/reset-2fa', adminOnly, async (req, res) => {
  const [tgt] = await query('SELECT display_name FROM app_users WHERE id=?', [req.params.id]);
  const r = await query('UPDATE app_users SET mfa=0, mfa_secret=NULL WHERE id=?', [req.params.id]);
  if (!r.affectedRows) return res.status(404).json({ error: 'User not found' });
  maybeAlert(req, `2FA reset for ${tgt?.display_name || 'user #' + req.params.id}`, 'An administrator disabled two-factor authentication for this account.');
  res.json({ ok: true });
});

// POST /api/users/:id/force-logout — invalidate all of a user's active sessions
router.post('/:id/force-logout', adminOnly, async (req, res) => {
  await ensureCols();
  // cutoff 1s in the future so tokens issued in the current second are also dropped
  const r = await query(
    'UPDATE app_users SET sessions_invalid_before = DATE_ADD(NOW(), INTERVAL 1 SECOND) WHERE id = ?',
    [req.params.id]
  );
  if (!r.affectedRows) return res.status(404).json({ error: 'User not found' });
  markInvalid(req.params.id, Math.floor(Date.now() / 1000) + 1);
  res.json({ ok: true });
});

// GET /api/users/sessions/recent — recent successful sign-ins (real login audit) — admin only
router.get('/sessions/recent', adminOnly, async (_req, res) => {
  await ensureCols();
  const rows = await query(
    `SELECT a.id, a.user_id, a.ip, a.user_agent, a.created_at,
            u.username, u.display_name, u.role, u.photo
     FROM app_login_audit a
     JOIN app_users u ON u.id = a.user_id
     WHERE IFNULL(a.success,1) = 1 AND COALESCE(u.role,'') <> 'Super Admin'
     ORDER BY a.id DESC LIMIT 25`
  ).catch(() => []);
  res.json({ rows });
});

// GET /api/users/:id/sessions — a user's active login sessions (self or admin) for per-device revoke
router.get('/:id/sessions', async (req, res) => {
  const isAdmin = ADMIN_ROLES.includes(req.user.role);
  if (!isAdmin && String(req.user.id) !== String(req.params.id)) {
    return res.status(403).json({ error: 'You can only view your own sessions' });
  }
  const rows = await query(
    `SELECT jti, ip, user_agent, created_at, last_seen FROM app_sessions
     WHERE user_id = ? AND revoked = 0 ORDER BY last_seen DESC, created_at DESC LIMIT 50`,
    [req.params.id]
  ).catch(() => []);
  res.json({ rows, currentJti: req.user.jti || null });
});

// POST /api/users/sessions/:jti/revoke — sign out one specific device (self or admin)
router.post('/sessions/:jti/revoke', async (req, res) => {
  const [sess] = await query('SELECT user_id FROM app_sessions WHERE jti = ?', [req.params.jti]);
  if (!sess) return res.status(404).json({ error: 'Session not found' });
  if (!ADMIN_ROLES.includes(req.user.role) && String(sess.user_id) !== String(req.user.id)) {
    return res.status(403).json({ error: 'You can only revoke your own sessions' });
  }
  await query('UPDATE app_sessions SET revoked = 1 WHERE jti = ?', [req.params.jti]);
  markRevoked(req.params.jti);
  res.json({ ok: true });
});

// GET /api/users/login-failures — recent FAILED / blocked login attempts (admin only)
router.get('/login-failures', adminOnly, async (_req, res) => {
  const rows = await query(
    `SELECT a.id, a.user_id, a.username, a.ip, a.user_agent, a.reason, a.created_at, u.display_name
     FROM app_login_audit a LEFT JOIN app_users u ON u.id = a.user_id
     WHERE a.success = 0 ORDER BY a.id DESC LIMIT 40`
  ).catch(() => []);
  res.json({ rows });
});

// GET /api/users/:id/activity — combined web + desktop history for this user
const ACT_LABEL = { create: 'Created', update: 'Updated', delete: 'Deleted', approve: 'Approved', cancel: 'Cancelled', adjust: 'Adjusted', restore: 'Restored', impersonate: 'Logged in as' };
function describeWeb(method, pathStr, entity) {
  const ent = (entity || '').replace(/-/g, ' ').replace(/s$/, '');
  let act = method === 'POST' ? 'create' : method === 'PUT' ? 'update' : method === 'DELETE' ? 'delete' : 'change';
  if (/\/impersonate/.test(pathStr)) return { Action: 'impersonate', Narration: 'Logged in as another user' };
  if (/\/approve|\/process/.test(pathStr)) act = 'approve';
  else if (/\/cancel/.test(pathStr)) act = 'cancel';
  else if (/\/adjust/.test(pathStr)) act = 'adjust';
  else if (/\/restore/.test(pathStr)) act = 'restore';
  return { Action: act, Narration: `${ACT_LABEL[act] || 'Changed'} ${ent || 'record'}` };
}

router.get('/:id/activity', async (req, res) => {
  await ensureCols();
  // a user may view their own activity; viewing anyone else's requires admin
  const isAdmin = ['Super Admin', 'Admin'].includes(req.user.role);
  if (!isAdmin && String(req.user.id) !== String(req.params.id)) {
    return res.status(403).json({ error: 'You can only view your own activity' });
  }
  const [user] = await query('SELECT legacy_user_code FROM app_users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // 1) web activity (since the app went live) — successful mutations only
  const web = await query(
    `SELECT method, path, entity, created_at FROM activity_log
     WHERE user_id = ? AND status < 400 ORDER BY id DESC LIMIT 30`,
    [req.params.id]
  ).catch(() => []);
  const webRows = web.map((w) => {
    const d = describeWeb(w.method, w.path, w.entity);
    return { Action: d.Action, Narration: d.Narration, AuditDate: w.created_at, source: 'web' };
  });

  // 2) legacy desktop audit (for migrated users)
  let legacyRows = [];
  let legacyTotal = 0;
  if (user.legacy_user_code != null) {
    legacyRows = await query(
      `SELECT Action, Narration, AuditDate FROM adminUserAudit WHERE UserCode = ? ORDER BY AuditDate DESC LIMIT 30`,
      [user.legacy_user_code]
    );
    legacyRows = legacyRows.map((r) => ({ ...r, source: 'desktop' }));
    const [[c]] = [await query('SELECT COUNT(*) AS n FROM adminUserAudit WHERE UserCode = ?', [user.legacy_user_code])];
    legacyTotal = c.n;
  }
  const [[wc]] = [await query('SELECT COUNT(*) AS n FROM activity_log WHERE user_id = ? AND status < 400', [req.params.id]).catch(() => [{ n: 0 }])];

  const rows = [...webRows, ...legacyRows]
    .sort((a, b) => new Date(b.AuditDate || 0) - new Date(a.AuditDate || 0))
    .slice(0, 30);
  res.json({ rows, totalActions: legacyTotal + (wc?.n || 0) });
});

module.exports = router;
