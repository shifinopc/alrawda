const { query } = require('./db');

/** Document-number prefix formats — mirrors Settings → Invoice Prefix (numbering). */
const DEFAULTS = {
  invoice: { format: 'INV-{YYYY}-{SEQ}' },
  receipt: { format: 'RCT-{YYYY}-{SEQ}' },
  payment: { format: 'PAY-{YYYY}-{SEQ}' },
  request: { format: 'REQ-{YYYY}-{SEQ}' },
};

async function loadNumbering() {
  const rows = await query("SELECT v FROM app_settings WHERE k = 'numbering'").catch(() => []);
  if (!rows.length) return { ...DEFAULTS };
  try { return { ...DEFAULTS, ...JSON.parse(rows[0].v) }; } catch { return { ...DEFAULTS }; }
}

function applyFormat(format, no, date) {
  const d = date ? new Date(date) : new Date();
  const y = isNaN(d) ? new Date().getFullYear() : d.getFullYear();
  const m = isNaN(d) ? new Date().getMonth() + 1 : d.getMonth() + 1;
  return String(format || '{SEQ}')
    .replaceAll('{PREFIX}', '')
    .replaceAll('{YYYY}', String(y))
    .replaceAll('{YY}', String(y).slice(-2))
    .replaceAll('{MM}', String(m).padStart(2, '0'))
    .replaceAll('{SEQ}', String(no == null ? '' : no).padStart(4, '0'));
}

/** Format a document number using a loaded numbering config.
 *  Pass createdAt (5th arg): migrated/old documents (no createdAt) keep their plain
 *  number; only newly-created documents get the prefix. */
function format(cfg, type, no, date, createdAt) {
  if (no == null || no === '') return '';
  if (arguments.length >= 5 && !createdAt) return String(no); // old/migrated → raw number
  const f = (cfg && cfg[type] && cfg[type].format) || DEFAULTS[type].format;
  return applyFormat(f, no, date);
}

/* ---------- fresh per-period counters (independent of legacy/migrated numbers) ----------
   New documents number from 0001 each period; old documents are never touched. */
let counterReady = null;
function ensureCounter() {
  if (!counterReady) {
    counterReady = query(`CREATE TABLE IF NOT EXISTS doc_counter (
      doc_type VARCHAR(20) NOT NULL,
      period INT NOT NULL,
      last_no INT NOT NULL DEFAULT 0,
      PRIMARY KEY (doc_type, period)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
  return counterReady;
}

/** Period key for the reset cycle: yearly → YYYY, monthly → YYYYMM, never → 0. */
function periodFor(reset, date) {
  const d = date ? new Date(date) : new Date();
  const valid = !isNaN(d);
  const y = valid ? d.getFullYear() : new Date().getFullYear();
  const m = (valid ? d.getMonth() : new Date().getMonth()) + 1;
  if (reset === 'never') return 0;
  if (reset === 'monthly') return y * 100 + m;
  return y; // yearly (default)
}

async function periodOf(type, date) {
  const cfg = await loadNumbering();
  const reset = (cfg[type] && cfg[type].reset) || 'yearly';
  return periodFor(reset, date);
}

/** Atomically allocate the next number for a document type within a transaction. */
async function nextNumber(conn, type, date) {
  const period = await periodOf(type, date);
  await conn.query(
    `INSERT INTO doc_counter (doc_type, period, last_no) VALUES (?, ?, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE last_no = LAST_INSERT_ID(last_no + 1)`, [type, period]);
  const [[r]] = await conn.query('SELECT LAST_INSERT_ID() AS n');
  return Number(r.n);
}

/** Preview the next number (no allocation). */
async function peekNumber(type, date) {
  await ensureCounter();
  const period = await periodOf(type, date);
  const [r] = await query('SELECT last_no FROM doc_counter WHERE doc_type=? AND period=?', [type, period]);
  return (r ? Number(r.last_no) : 0) + 1;
}

/** Admin: jump the counter so the next document of this period is `no`. */
async function setNextNumber(type, no, date) {
  await ensureCounter();
  const period = await periodOf(type, date);
  await query(
    `INSERT INTO doc_counter (doc_type, period, last_no) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE last_no = VALUES(last_no)`, [type, period, no - 1]);
  return { period, next: no };
}

module.exports = { loadNumbering, format, applyFormat, ensureCounter, nextNumber, peekNumber, setNextNumber, periodFor, DEFAULTS };
