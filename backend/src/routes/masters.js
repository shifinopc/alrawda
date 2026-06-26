const express = require('express');
const { query } = require('../db');
const { requirePermission } = require('../permissions');

const router = express.Router();

/* ================= master audit trail ================= */
let auditEnsured = null;
function ensureAudit() {
  if (!auditEnsured) {
    auditEnsured = query(`CREATE TABLE IF NOT EXISTS master_audit (
      id INT NOT NULL AUTO_INCREMENT,
      master_type VARCHAR(30) NOT NULL,
      record_code INT NOT NULL,
      record_name VARCHAR(300) NULL,
      action VARCHAR(10) NOT NULL,
      changes MEDIUMTEXT NULL,
      changed_by INT NULL,
      changed_by_name VARCHAR(100) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_type_code (master_type, record_code),
      KEY idx_time (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
  return auditEnsured;
}

async function logAudit(req, type, code, name, action, changes) {
  await ensureAudit();
  await query(
    `INSERT INTO master_audit (master_type, record_code, record_name, action, changes, changed_by, changed_by_name)
     VALUES (?,?,?,?,?,?,?)`,
    [type, code, name, action, changes && changes.length ? JSON.stringify(changes) : null,
     req.user?.id ?? null, req.user?.name ?? null]
  );
}

/** Diff old/new values using a {bodyKey: 'Friendly label'} map; returns [{field, old, new}]. */
function diff(oldRow, newVals, labels) {
  const out = [];
  for (const [key, label] of Object.entries(labels)) {
    const oldV = oldRow[key] == null ? '' : String(oldRow[key]).trim();
    const newV = newVals[key] == null ? '' : String(newVals[key]).trim();
    if (Number(oldV) === Number(newV) && oldV !== '' && newV !== '' && !isNaN(Number(oldV))) continue;
    if (oldV !== newV) out.push({ field: label, old: oldRow[key], new: newVals[key] });
  }
  return out;
}

// GET /api/masters/history?type=package|visa-type|nationality&code=&limit=
router.get('/history', async (req, res) => {
  await ensureAudit();
  const { type, code } = req.query;
  const limit = Math.min(200, Number(req.query.limit) || 50);
  const where = [], params = [];
  if (type) { where.push('master_type = ?'); params.push(type); }
  if (code) { where.push('record_code = ?'); params.push(code); }
  const rows = await query(
    `SELECT id, master_type, record_code, record_name, action, changes, changed_by_name, created_at
     FROM master_audit ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY id DESC LIMIT ?`,
    [...params, limit]
  );
  for (const r of rows) {
    try { r.changes = r.changes ? JSON.parse(r.changes) : []; } catch { r.changes = []; }
  }
  res.json({ rows });
});

/* ================= Packages ================= */
const PKG_LABELS = { PackageName: 'Package Name', Rate: 'Rate' };

router.get('/packages', async (_req, res) => {
  res.json({ rows: await query('SELECT PackageCode, PackageName, Rate FROM UmrahPackage ORDER BY PackageName') });
});
router.post('/packages', requirePermission('Master Data','Create'), async (req, res) => {
  const { packageName, rate } = req.body || {};
  if (!packageName) return res.status(400).json({ error: 'Package name is required' });
  const r = await query('INSERT INTO UmrahPackage (PackageName, Rate) VALUES (?,?)', [packageName, rate || 0]);
  await logAudit(req, 'package', r.insertId, packageName, 'create',
    [{ field: 'Package Name', old: null, new: packageName }, { field: 'Rate', old: null, new: rate || 0 }]);
  res.status(201).json({ packageCode: r.insertId });
});
router.put('/packages/:code', requirePermission('Master Data','Edit'), async (req, res) => {
  const { packageName, rate } = req.body || {};
  const [old] = await query('SELECT PackageName, Rate FROM UmrahPackage WHERE PackageCode=?', [req.params.code]);
  if (!old) return res.status(404).json({ error: 'Package not found' });
  await query('UPDATE UmrahPackage SET PackageName=?, Rate=? WHERE PackageCode=?',
    [packageName, rate || 0, req.params.code]);
  const changes = diff(old, { PackageName: packageName, Rate: rate || 0 }, PKG_LABELS);
  if (changes.length) await logAudit(req, 'package', req.params.code, packageName, 'update', changes);
  res.json({ ok: true, changed: changes.length });
});
router.delete('/packages/:code', requirePermission('Master Data','Delete'), async (req, res) => {
  const [used] = await query('SELECT COUNT(*) AS c FROM UmrahInvoice WHERE PackageCode=?', [req.params.code]);
  if (used.c > 0) return res.status(409).json({ error: `Package is used by ${used.c} invoice(s) and cannot be deleted` });
  const [old] = await query('SELECT PackageName, Rate FROM UmrahPackage WHERE PackageCode=?', [req.params.code]);
  if (!old) return res.status(404).json({ error: 'Package not found' });
  await query('DELETE FROM UmrahPackage WHERE PackageCode=?', [req.params.code]);
  await logAudit(req, 'package', req.params.code, old.PackageName, 'delete',
    [{ field: 'Package Name', old: old.PackageName, new: null }, { field: 'Rate', old: old.Rate, new: null }]);
  res.json({ ok: true });
});

/* ================= Visa Types ================= */
const VISA_LABELS = { VisaType: 'Visa Type', VisaAmount: 'Visa Amount' };

router.get('/visa-types', async (_req, res) => {
  res.json({ rows: await query('SELECT VisaTypeCode, VisaType, VisaAmount FROM UmrahVisaType ORDER BY VisaTypeCode') });
});
router.post('/visa-types', requirePermission('Master Data','Create'), async (req, res) => {
  const { visaType, visaAmount } = req.body || {};
  if (!visaType) return res.status(400).json({ error: 'Visa type is required' });
  const r = await query('INSERT INTO UmrahVisaType (VisaType, VisaAmount) VALUES (?,?)', [visaType, visaAmount || 0]);
  await logAudit(req, 'visa-type', r.insertId, visaType, 'create',
    [{ field: 'Visa Type', old: null, new: visaType }, { field: 'Visa Amount', old: null, new: visaAmount || 0 }]);
  res.status(201).json({ visaTypeCode: r.insertId });
});
router.put('/visa-types/:code', requirePermission('Master Data','Edit'), async (req, res) => {
  const { visaType, visaAmount } = req.body || {};
  const [old] = await query('SELECT VisaType, VisaAmount FROM UmrahVisaType WHERE VisaTypeCode=?', [req.params.code]);
  if (!old) return res.status(404).json({ error: 'Visa type not found' });
  await query('UPDATE UmrahVisaType SET VisaType=?, VisaAmount=? WHERE VisaTypeCode=?',
    [visaType, visaAmount || 0, req.params.code]);
  const changes = diff(old, { VisaType: visaType, VisaAmount: visaAmount || 0 }, VISA_LABELS);
  if (changes.length) await logAudit(req, 'visa-type', req.params.code, visaType, 'update', changes);
  res.json({ ok: true, changed: changes.length });
});
router.delete('/visa-types/:code', requirePermission('Master Data','Delete'), async (req, res) => {
  const [used] = await query('SELECT COUNT(*) AS c FROM UmrahPassengers WHERE VisaTypeCode=?', [req.params.code]);
  if (used.c > 0) return res.status(409).json({ error: `Visa type is used by ${used.c} passenger(s) and cannot be deleted` });
  const [old] = await query('SELECT VisaType, VisaAmount FROM UmrahVisaType WHERE VisaTypeCode=?', [req.params.code]);
  if (!old) return res.status(404).json({ error: 'Visa type not found' });
  await query('DELETE FROM UmrahVisaType WHERE VisaTypeCode=?', [req.params.code]);
  await logAudit(req, 'visa-type', req.params.code, old.VisaType, 'delete',
    [{ field: 'Visa Type', old: old.VisaType, new: null }, { field: 'Visa Amount', old: old.VisaAmount, new: null }]);
  res.json({ ok: true });
});

/* ================= Nationalities ================= */
const NAT_LABELS = { CountryName: 'Country Name', CntShortName: 'Short Name', CountryNameinArabic: 'Name in Arabic' };

router.get('/nationalities', async (_req, res) => {
  res.json({
    rows: await query(
      `SELECT CountryCode, CountryName, CntShortName, CountryNameinArabic
       FROM AdminCountryInfo ORDER BY CountryName`),
  });
});
router.post('/nationalities', requirePermission('Master Data','Create'), async (req, res) => {
  const { countryName, shortName, nameArabic } = req.body || {};
  if (!countryName) return res.status(400).json({ error: 'Country name is required' });
  const [m] = await query('SELECT IFNULL(MAX(CountryCode),0)+1 AS next FROM AdminCountryInfo');
  await query(
    'INSERT INTO AdminCountryInfo (CountryCode, CountryName, CntShortName, CountryNameinArabic) VALUES (?,?,?,?)',
    [m.next, countryName, shortName || null, nameArabic || null]);
  await logAudit(req, 'nationality', m.next, countryName, 'create',
    [{ field: 'Country Name', old: null, new: countryName },
     { field: 'Short Name', old: null, new: shortName || '' },
     { field: 'Name in Arabic', old: null, new: nameArabic || '' }]);
  res.status(201).json({ countryCode: m.next });
});
router.put('/nationalities/:code', requirePermission('Master Data','Edit'), async (req, res) => {
  const { countryName, shortName, nameArabic } = req.body || {};
  const [old] = await query(
    'SELECT CountryName, CntShortName, CountryNameinArabic FROM AdminCountryInfo WHERE CountryCode=?',
    [req.params.code]);
  if (!old) return res.status(404).json({ error: 'Nationality not found' });
  await query(
    'UPDATE AdminCountryInfo SET CountryName=?, CntShortName=?, CountryNameinArabic=? WHERE CountryCode=?',
    [countryName, shortName || null, nameArabic || null, req.params.code]);
  const changes = diff(old,
    { CountryName: countryName, CntShortName: shortName || null, CountryNameinArabic: nameArabic || null },
    NAT_LABELS);
  if (changes.length) await logAudit(req, 'nationality', req.params.code, countryName, 'update', changes);
  res.json({ ok: true, changed: changes.length });
});
router.delete('/nationalities/:code', requirePermission('Master Data','Delete'), async (req, res) => {
  const [used] = await query('SELECT COUNT(*) AS c FROM UmrahInvoice WHERE NatinalityCode=?', [req.params.code]);
  if (used.c > 0) return res.status(409).json({ error: `Nationality is used by ${used.c} invoice(s) and cannot be deleted` });
  const [old] = await query(
    'SELECT CountryName, CntShortName, CountryNameinArabic FROM AdminCountryInfo WHERE CountryCode=?',
    [req.params.code]);
  if (!old) return res.status(404).json({ error: 'Nationality not found' });
  await query('DELETE FROM AdminCountryInfo WHERE CountryCode=?', [req.params.code]);
  await logAudit(req, 'nationality', req.params.code, old.CountryName, 'delete',
    [{ field: 'Country Name', old: old.CountryName, new: null }]);
  res.json({ ok: true });
});

/* ================= Customer master (sopCustomerInfo) ================= */
const CUST_LABELS = {
  CustomerName: 'Customer Name', CountryCode: 'Nationality', MobileNo: 'Mobile No',
  EMailID: 'Email', LocalAddress: 'Address',
};

router.get('/customer-master', async (req, res) => {
  const q = (req.query.q || '').trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Number(req.query.pageSize) || 50);
  const where = [], params = [];
  if (q) {
    where.push('(c.CustomerName LIKE ? OR c.MobileNo LIKE ? OR c.EMailID LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await query(
    `SELECT c.CustomerCode, c.CustomerName, c.MobileNo, c.EMailID, c.LocalAddress, c.CountryCode,
            n.CountryName
     FROM sopCustomerInfo c
     LEFT JOIN AdminCountryInfo n ON n.CountryCode = c.CountryCode
     ${whereSql}
     ORDER BY c.CustomerCode DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM sopCustomerInfo c ${whereSql}`, params);
  res.json({ rows, page, pageSize, total });
});
router.post('/customer-master', requirePermission('Master Data', 'Create'), async (req, res) => {
  const { customerName, countryCode, mobileNo, email, address } = req.body || {};
  if (!customerName) return res.status(400).json({ error: 'Customer name is required' });
  const r = await query(
    `INSERT INTO sopCustomerInfo (CustomerName, CountryCode, MobileNo, EMailID, LocalAddress, CustomerStatus, CurntUserCode)
     VALUES (?,?,?,?,?,'Active',?)`,
    [customerName, countryCode || null, mobileNo || null, email || null, address || null, req.user?.id ?? null]
  );
  await logAudit(req, 'customer', r.insertId, customerName, 'create',
    [{ field: 'Customer Name', old: null, new: customerName },
     { field: 'Mobile No', old: null, new: mobileNo || '' }]);
  res.status(201).json({ customerCode: r.insertId });
});
router.put('/customer-master/:code', requirePermission('Master Data', 'Edit'), async (req, res) => {
  const { customerName, countryCode, mobileNo, email, address } = req.body || {};
  const [old] = await query(
    'SELECT CustomerName, CountryCode, MobileNo, EMailID, LocalAddress FROM sopCustomerInfo WHERE CustomerCode=?',
    [req.params.code]);
  if (!old) return res.status(404).json({ error: 'Customer not found' });
  await query(
    `UPDATE sopCustomerInfo SET CustomerName=?, CountryCode=?, MobileNo=?, EMailID=?, LocalAddress=? WHERE CustomerCode=?`,
    [customerName, countryCode || null, mobileNo || null, email || null, address || null, req.params.code]);
  const changes = diff(old,
    { CustomerName: customerName, CountryCode: countryCode || null, MobileNo: mobileNo || null,
      EMailID: email || null, LocalAddress: address || null },
    CUST_LABELS);
  if (changes.length) await logAudit(req, 'customer', req.params.code, customerName, 'update', changes);
  res.json({ ok: true, changed: changes.length });
});
router.delete('/customer-master/:code', requirePermission('Master Data', 'Delete'), async (req, res) => {
  const [old] = await query('SELECT CustomerName FROM sopCustomerInfo WHERE CustomerCode=?', [req.params.code]);
  if (!old) return res.status(404).json({ error: 'Customer not found' });
  await query('DELETE FROM sopCustomerInfo WHERE CustomerCode=?', [req.params.code]);
  await logAudit(req, 'customer', req.params.code, old.CustomerName, 'delete',
    [{ field: 'Customer Name', old: old.CustomerName, new: null }]);
  res.json({ ok: true });
});

/* ================= Agents ================= */
// new app-native master: booking agents (name + mobile), optionally tagged on an invoice
let agentSchemaReady = null;
function ensureAgentSchema() {
  if (!agentSchemaReady) {
    agentSchemaReady = query(`CREATE TABLE IF NOT EXISTS agents (
      AgentCode INT NOT NULL AUTO_INCREMENT,
      AgentName VARCHAR(150) NOT NULL,
      MobileNo VARCHAR(40) NULL,
      Active TINYINT(1) NOT NULL DEFAULT 1,
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (AgentCode)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
      .then(() => query('ALTER TABLE UmrahInvoice ADD COLUMN AgentCode INT NULL').catch(() => {}))
      .then(() => query('ALTER TABLE UmrahInvoice ADD COLUMN ShowAgent TINYINT(1) NOT NULL DEFAULT 0').catch(() => {}))
      .catch(() => {});
  }
  return agentSchemaReady;
}

const AGENT_LABELS = { AgentName: 'Agent Name', MobileNo: 'Mobile No' };

router.get('/agents', async (_req, res) => {
  await ensureAgentSchema();
  res.json({ rows: await query('SELECT AgentCode, AgentName, MobileNo FROM agents ORDER BY AgentName') });
});
router.post('/agents', requirePermission('Master Data', 'Create'), async (req, res) => {
  await ensureAgentSchema();
  const { agentName, mobileNo } = req.body || {};
  if (!agentName || !agentName.trim()) return res.status(400).json({ error: 'Agent name is required' });
  const r = await query('INSERT INTO agents (AgentName, MobileNo, created_by) VALUES (?,?,?)',
    [agentName.trim(), mobileNo || null, req.user?.id ?? null]);
  await logAudit(req, 'agent', r.insertId, agentName.trim(), 'create',
    [{ field: 'Agent Name', old: null, new: agentName.trim() }, { field: 'Mobile No', old: null, new: mobileNo || '' }]);
  res.status(201).json({ agentCode: r.insertId });
});
router.put('/agents/:code', requirePermission('Master Data', 'Edit'), async (req, res) => {
  await ensureAgentSchema();
  const { agentName, mobileNo } = req.body || {};
  if (!agentName || !agentName.trim()) return res.status(400).json({ error: 'Agent name is required' });
  const [old] = await query('SELECT AgentName, MobileNo FROM agents WHERE AgentCode=?', [req.params.code]);
  if (!old) return res.status(404).json({ error: 'Agent not found' });
  await query('UPDATE agents SET AgentName=?, MobileNo=? WHERE AgentCode=?',
    [agentName.trim(), mobileNo || null, req.params.code]);
  const changes = diff(old, { AgentName: agentName.trim(), MobileNo: mobileNo || null }, AGENT_LABELS);
  if (changes.length) await logAudit(req, 'agent', req.params.code, agentName.trim(), 'update', changes);
  res.json({ ok: true, changed: changes.length });
});
router.delete('/agents/:code', requirePermission('Master Data', 'Delete'), async (req, res) => {
  await ensureAgentSchema();
  const [used] = await query('SELECT COUNT(*) AS c FROM UmrahInvoice WHERE AgentCode=?', [req.params.code]);
  if (used.c > 0) return res.status(409).json({ error: `Agent is used by ${used.c} invoice(s) and cannot be deleted` });
  const [old] = await query('SELECT AgentName FROM agents WHERE AgentCode=?', [req.params.code]);
  if (!old) return res.status(404).json({ error: 'Agent not found' });
  await query('DELETE FROM agents WHERE AgentCode=?', [req.params.code]);
  await logAudit(req, 'agent', req.params.code, old.AgentName, 'delete', [{ field: 'Agent Name', old: old.AgentName, new: null }]);
  res.json({ ok: true });
});

/* ================= Customers (read-only directory) ================= */
router.get('/customers', async (req, res) => {
  const q = req.query.q || '';
  const rows = await query(
    `SELECT CustomerName, MAX(Mobile1) AS Mobile1, MAX(NatinalityCode) AS NatinalityCode,
            COUNT(*) AS invoices, MAX(InvoiceDate) AS lastInvoice
     FROM UmrahInvoice
     WHERE CustomerName LIKE ? AND CustomerName <> ''
     GROUP BY CustomerName ORDER BY MAX(InvoiceCode) DESC LIMIT 25`,
    [`%${q}%`]
  );
  res.json({ rows });
});

/* ================= Open invoices (for receipt/refund selectors) ================= */
router.get('/open-invoices', async (_req, res) => {
  const rows = await query(
    `SELECT i.InvoiceCode, i.InvoiceNo, i.CustomerName, i.Mobile1, i.DepartureDate,
            i.PassengerCount, i.SeatCount, i.VisaCount, i.RoomType, i.NatinalityCode,
            c.CountryName AS Nationality, i.PackageCode, p.PackageName,
            i.NetAmount, IFNULL(r.received,0) AS received,
            (i.NetAmount - IFNULL(r.received,0)) AS balance
     FROM UmrahInvoice i
     LEFT JOIN UmrahPackage p ON p.PackageCode = i.PackageCode
     LEFT JOIN AdminCountryInfo c ON c.CountryCode = i.NatinalityCode
     LEFT JOIN (SELECT InvoiceCode, SUM(RecievedAmount) received FROM UmrahReciept WHERE is_deleted=0 GROUP BY InvoiceCode) r
       ON r.InvoiceCode = i.InvoiceCode
     WHERE TRIM(IFNULL(i.CancelYesNo,'N')) <> 'Y'
       AND i.is_deleted = 0
       AND TRIM(IFNULL(i.ApprovalStatus,'Pending')) = 'Approved'
     HAVING balance > 0
     ORDER BY i.InvoiceCode DESC LIMIT 300`
  );
  res.json({ rows });
});

module.exports = router;
module.exports.ensureAgentSchema = ensureAgentSchema; // run at startup so invoice JOINs work
