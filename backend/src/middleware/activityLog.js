const { query } = require('../db');

let ensured = null;
function ensureTable() {
  if (!ensured) {
    ensured = query(`CREATE TABLE IF NOT EXISTS activity_log (
      id BIGINT NOT NULL AUTO_INCREMENT,
      user_id INT NULL,
      user_name VARCHAR(100) NULL,
      user_role VARCHAR(30) NULL,
      impersonator_id INT NULL,
      impersonator_name VARCHAR(100) NULL,
      method VARCHAR(8) NOT NULL,
      path VARCHAR(255) NOT NULL,
      entity VARCHAR(40) NULL,
      status INT NULL,
      ip VARCHAR(64) NULL,
      detail VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_user (user_id),
      KEY idx_time (created_at),
      KEY idx_entity (entity)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
      // add impersonation columns on already-existing tables (idempotent)
      .then(() => query('ALTER TABLE activity_log ADD COLUMN impersonator_id INT NULL').catch(() => {}))
      .then(() => query('ALTER TABLE activity_log ADD COLUMN impersonator_name VARCHAR(100) NULL').catch(() => {}))
      .catch(() => {});
  }
  return ensured;
}

// derive a coarse entity name from the path, e.g. /api/invoices/8457/adjust -> invoices
const entityOf = (path) => {
  const m = path.match(/^\/api\/([\w-]+)/);
  return m ? m[1] : null;
};

/** Logs every mutating request (POST/PUT/DELETE) after it completes. Read-only GETs are skipped. */
function activityLogger(req, res, next) {
  if (req.method === 'GET' || req.method === 'OPTIONS') return next();
  ensureTable();
  res.on('finish', () => {
    // never log credentials
    const isAuth = req.path.includes('/auth/');
    const detail = isAuth ? null : safeDetail(req.body);
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
    const imp = req.user?.impersonator || null; // present only when an admin is acting "as" this user
    query(
      `INSERT INTO activity_log (user_id, user_name, user_role, impersonator_id, impersonator_name, method, path, entity, status, ip, detail)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [req.user?.id ?? null, req.user?.name ?? null, req.user?.role ?? null,
       imp?.id ?? null, imp?.name ?? null,
       req.method, req.originalUrl.slice(0, 255), entityOf(req.originalUrl), res.statusCode,
       ip.slice(0, 64), detail]
    ).catch(() => {}); // logging must never break the request
  });
  next();
}

function safeDetail(body) {
  if (!body || typeof body !== 'object') return null;
  const redacted = { ...body };
  for (const k of Object.keys(redacted)) {
    if (/pass|token|secret|photo|image|logo/i.test(k)) delete redacted[k];
  }
  const s = JSON.stringify(redacted);
  return s.length > 255 ? s.slice(0, 252) + '…' : s;
}

module.exports = { activityLogger, ensureActivityLog: ensureTable };
