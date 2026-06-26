const crypto = require('crypto');
const { query } = require('./db');

// Server-side session registry so individual logins (tokens) can be listed and revoked.
// Each issued JWT carries a `jti`; a row here tracks it. authRequired rejects revoked jtis.
let ensured = null;
function ensureTable() {
  if (!ensured) {
    ensured = query(`CREATE TABLE IF NOT EXISTS app_sessions (
      jti CHAR(36) NOT NULL,
      user_id INT NOT NULL,
      ip VARCHAR(64) NULL,
      user_agent VARCHAR(300) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME NULL,
      revoked TINYINT(1) NOT NULL DEFAULT 0,
      PRIMARY KEY (jti), KEY idx_user (user_id), KEY idx_revoked (revoked)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`).catch(() => {});
  }
  return ensured;
}

// small cache of revoked jtis so the per-request check costs nothing in the common case
let revoked = new Set();
let loadedAt = 0;
const TTL_MS = 8000;
async function refresh() {
  const rows = await query('SELECT jti FROM app_sessions WHERE revoked = 1').catch(() => null);
  if (rows) revoked = new Set(rows.map((r) => r.jti));
  loadedAt = Date.now();
}
async function ensureFresh() { if (Date.now() - loadedAt > TTL_MS) await refresh(); }
function isRevoked(jti) { return revoked.has(jti); }
function markRevoked(jti) { revoked.add(jti); }

// register a freshly-issued token; returns its jti (to embed in the JWT)
async function createSession(userId, ip, userAgent) {
  await ensureTable();
  const jti = crypto.randomUUID();
  await query(
    'INSERT INTO app_sessions (jti, user_id, ip, user_agent, last_seen) VALUES (?,?,?,?,NOW())',
    [jti, userId, (ip || '').slice(0, 64), (userAgent || '').slice(0, 300)]
  ).catch(() => {});
  return jti;
}

module.exports = { ensureTable, ensureFresh, isRevoked, markRevoked, createSession, refresh };
