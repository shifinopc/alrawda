const express = require('express');
const { query } = require('../db');
const { requireRole, ADMINS } = require('../middleware/auth');
const { peekNumber, setNextNumber } = require('../docNumber');

const router = express.Router();

// keys that hold secrets (SMTP password etc.) — only admins may read these
const SENSITIVE_KEYS = ['email'];

/* ---------- generic app settings store (JSON per key) ---------- */
let ensured = null;
function ensurePrefs() {
  if (!ensured) {
    ensured = query(`CREATE TABLE IF NOT EXISTS app_settings (
      k VARCHAR(50) NOT NULL,
      v MEDIUMTEXT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (k)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
  return ensured;
}

// GET /api/settings/prefs — all keys as one object.
// Readable by every authenticated user (the permission matrix, document
// numbering and print templates live here), but secret-bearing keys (SMTP
// credentials) are stripped for non-admins.
router.get('/prefs', async (req, res) => {
  await ensurePrefs();
  const rows = await query('SELECT k, v FROM app_settings');
  const isAdmin = ADMINS.includes(req.user?.role);
  const prefs = {};
  for (const r of rows) {
    if (!isAdmin && SENSITIVE_KEYS.includes(r.k)) continue;
    try { prefs[r.k] = JSON.parse(r.v); } catch { prefs[r.k] = r.v; }
  }
  res.json({ prefs });
});

// PUT /api/settings/prefs — merge { key: value, ... } (admins only)
router.put('/prefs', requireRole(ADMINS), async (req, res) => {
  await ensurePrefs();
  const body = req.body || {};
  const keys = Object.keys(body);
  if (!keys.length) return res.status(400).json({ error: 'Nothing to save' });
  for (const k of keys) {
    const v = JSON.stringify(body[k]);
    if (v.length > 4 * 1024 * 1024) return res.status(413).json({ error: `Setting '${k}' is too large` });
    await query(
      'INSERT INTO app_settings (k, v) VALUES (?,?) ON DUPLICATE KEY UPDATE v = VALUES(v)',
      [k, v]
    );
  }
  res.json({ ok: true, saved: keys });
});

/* ---------- email: send test message via saved SMTP config ---------- */
// POST /api/settings/email-test  { to }  (admins only)
router.post('/email-test', requireRole(ADMINS), async (req, res) => {
  await ensurePrefs();
  const { to } = req.body || {};
  if (!to) return res.status(400).json({ error: 'Recipient address is required' });
  const rows = await query("SELECT v FROM app_settings WHERE k = 'email'");
  if (!rows.length) return res.status(400).json({ error: 'Save the email settings first' });
  let cfg;
  try { cfg = JSON.parse(rows[0].v); } catch { cfg = null; }
  if (!cfg || !cfg.host) return res.status(400).json({ error: 'SMTP host is not configured' });

  // send through the shared mailer so the test message gets the same branded
  // template (logo + header/footer) as every other outgoing email
  const { sendMail } = require('../mailer');
  const r = await sendMail({
    to,
    subject: 'AL RAWDA ERP — test email',
    text: 'This is a test email from AL RAWDA ERP.\n\nYour SMTP settings are working.',
    html: '<p>This is a <b>test email</b> from AL RAWDA ERP.</p><p>Your SMTP settings are working &#10004;</p>',
  });
  if (r.ok) res.json({ ok: true, messageId: r.messageId });
  else res.status(502).json({ error: `SMTP error: ${r.error}` });
});

/* ---------- daily summary: send now (manual trigger / test) ---------- */
// POST /api/settings/summary-now  (admins only)
router.post('/summary-now', requireRole(ADMINS), async (_req, res) => {
  await ensurePrefs();
  const { sendDailySummary } = require('../notify');
  const r = await sendDailySummary(true); // force regardless of toggle
  if (r && r.ok) return res.json({ ok: true, messageId: r.messageId });
  res.status(502).json({ error: (r && r.error) || 'Could not send summary' });
});

/* ---------- document numbering statistics (real data) ---------- */
// POST /api/settings/numbering-set { type, no } — start this year's counter so the next document is #no (admins)
const SETNO_TBL = {
  invoice: ['UmrahInvoice', 'InvoiceNo', 'InvoiceDate'],
  receipt: ['UmrahReciept', 'RecieptNo', 'RecieptDate'],
  payment: ['UmrahPayment', 'PaymentNo', 'PaymentDate'],
};
router.post('/numbering-set', requireRole(ADMINS), async (req, res) => {
  const type = req.body && req.body.type;
  const no = Math.floor(Number(req.body && req.body.no));
  const m = SETNO_TBL[type];
  if (!m) return res.status(400).json({ error: 'Set-number applies to Invoice, Receipt and Payment only' });
  if (!Number.isFinite(no) || no <= 0) return res.status(400).json({ error: 'Enter a valid number' });
  const year = new Date().getFullYear();
  const [ex] = await query(`SELECT COUNT(*) AS c FROM ${m[0]} WHERE ${m[1]} = ? AND YEAR(${m[2]}) = ?`, [no, year]);
  if (ex.c > 0) return res.status(409).json({ error: `${type.charAt(0).toUpperCase() + type.slice(1)} #${no} already exists for ${year} — duplicate` });
  await setNextNumber(type, no);
  res.json({ ok: true, next: no, year });
});

// GET /api/settings/numbering-stats
router.get('/numbering-stats', async (_req, res) => {
  const [invoice, receipt, payment, request] = await Promise.all([
    query(`SELECT YEAR(InvoiceDate) AS yr, MIN(InvoiceNo) AS start, MAX(InvoiceNo) AS last, COUNT(*) AS issued
           FROM UmrahInvoice WHERE InvoiceDate IS NOT NULL GROUP BY YEAR(InvoiceDate) ORDER BY yr`),
    query(`SELECT YEAR(RecieptDate) AS yr, MIN(RecieptNo) AS start, MAX(RecieptNo) AS last, COUNT(*) AS issued
           FROM UmrahReciept WHERE RecieptDate IS NOT NULL GROUP BY YEAR(RecieptDate) ORDER BY yr`),
    query(`SELECT YEAR(PaymentDate) AS yr, MIN(PaymentNo) AS start, MAX(PaymentNo) AS last, COUNT(*) AS issued
           FROM UmrahPayment WHERE PaymentDate IS NOT NULL GROUP BY YEAR(PaymentDate) ORDER BY yr`),
    query(`SELECT YEAR(request_date) AS yr, MIN(id)+500 AS start, MAX(id)+500 AS last, COUNT(*) AS issued
           FROM receipt_request WHERE request_date IS NOT NULL GROUP BY YEAR(request_date) ORDER BY yr`).catch(() => []),
  ]);
  // live next numbers from the fresh per-year counters
  const next = {};
  for (const t of ['invoice', 'receipt', 'payment']) {
    next[t] = await peekNumber(t).catch(() => null);
  }
  res.json({ invoice, receipt, payment, request, next });
});

/* ---------- currencies ---------- */
// GET /api/settings/currencies
router.get('/currencies', async (_req, res) => {
  const rows = await query(
    `SELECT CurrencyCode, TRIM(CurrShortName) AS shortName, TRIM(CurrName) AS name, TRIM(IFNULL(Symbol,'')) AS symbol
     FROM AdminCurrencyInfo ORDER BY TRIM(CurrShortName)`
  );
  res.json({ rows });
});

/* ---------- company info ---------- */
// GET /api/settings/company
router.get('/company', async (_req, res) => {
  const [company] = await query(
    `SELECT c.CompanyCode, c.CompShortName, c.CompanyName, c.Address, c.Phone1, c.EMail, c.WebSite,
            c.HCurrencyCode, TRIM(cur.CurrShortName) AS CurrencyShort, TRIM(cur.CurrName) AS CurrencyName
     FROM AdminCompanyInfo c
     LEFT JOIN AdminCurrencyInfo cur ON cur.CurrencyCode = c.HCurrencyCode
     LIMIT 1`
  );
  const [branch] = await query(
    `SELECT BranchCode, BranchName, BranchNameinArabic, Address1, Place, Phone1, EMailID
     FROM AdminBranchInfo LIMIT 1`
  );
  // logo lives in app_settings (the legacy company tables have no image column)
  let logo = null;
  try {
    const rows = await query("SELECT v FROM app_settings WHERE k = 'companyProfile'");
    if (rows.length) logo = (JSON.parse(rows[0].v) || {}).logo || null;
  } catch { /* none */ }
  res.json({ company: company || null, branch: branch || null, logo });
});

// PUT /api/settings/company  (admins only)
router.put('/company', requireRole(ADMINS), async (req, res) => {
  const { companyName, address, phone, email, nameArabic, currencyCode, logo } = req.body || {};
  await query(
    `UPDATE AdminCompanyInfo SET CompanyName=IFNULL(?,CompanyName), Address=IFNULL(?,Address),
       Phone1=IFNULL(?,Phone1), EMail=IFNULL(?,EMail), HCurrencyCode=IFNULL(?,HCurrencyCode)`,
    [companyName || null, address || null, phone || null, email || null, currencyCode || null]
  );
  if (nameArabic) {
    await query(`UPDATE AdminBranchInfo SET BranchNameinArabic=?`, [nameArabic]);
  }
  // logo: '' / null clears it, a data-URI sets it; undefined leaves it unchanged
  if (logo !== undefined) {
    const v = JSON.stringify({ logo: logo || null });
    await query("INSERT INTO app_settings (k, v) VALUES ('companyProfile', ?) ON DUPLICATE KEY UPDATE v = VALUES(v)", [v]);
  }
  res.json({ ok: true });
});

module.exports = router;
