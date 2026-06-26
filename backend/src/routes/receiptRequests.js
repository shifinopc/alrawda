const express = require('express');
const { query, pool } = require('../db');
const { requirePermission } = require('../permissions');
const { loadNumbering, format: fmtDocNo } = require('../docNumber');

const router = express.Router();

let ensured = null;
function ensureTables() {
  if (!ensured) {
    ensured = (async () => {
      await query(`CREATE TABLE IF NOT EXISTS receipt_request (
        id INT NOT NULL AUTO_INCREMENT,
        request_no VARCHAR(20) NOT NULL,
        request_date DATE NOT NULL,
        note VARCHAR(300) NULL,
        status VARCHAR(15) NOT NULL DEFAULT 'Pending',
        created_by INT NULL,
        created_by_name VARCHAR(100) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        processed_by INT NULL,
        processed_by_name VARCHAR(100) NULL,
        processed_at DATETIME NULL,
        comment VARCHAR(500) NULL,
        reverted_by INT NULL,
        reverted_by_name VARCHAR(100) NULL,
        reverted_at DATETIME NULL,
        revert_reason VARCHAR(500) NULL,
        PRIMARY KEY (id), KEY idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      // add revert columns to pre-existing tables (ignored if already present)
      for (const col of [
        'reverted_by INT NULL',
        'reverted_by_name VARCHAR(100) NULL',
        'reverted_at DATETIME NULL',
        'revert_reason VARCHAR(500) NULL',
      ]) {
        await query(`ALTER TABLE receipt_request ADD COLUMN ${col}`).catch(() => {});
      }
      await query(`CREATE TABLE IF NOT EXISTS receipt_request_dtl (
        request_id INT NOT NULL,
        receipt_code INT NOT NULL,
        status VARCHAR(15) NOT NULL DEFAULT 'Pending',
        PRIMARY KEY (request_id, receipt_code),
        KEY idx_receipt (receipt_code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    })();
  }
  return ensured;
}
router.use(async (_req, _res, next) => { await ensureTables(); next(); });

const LIST_SQL = `
  SELECT rr.id, rr.request_no, rr.request_date, rr.note, rr.status,
         rr.created_by_name, rr.created_at, rr.processed_by_name, rr.processed_at, rr.comment,
         rr.reverted_by_name, rr.reverted_at, rr.revert_reason,
         COUNT(d.receipt_code) AS receiptCount,
         IFNULL(SUM(r.RecievedAmount),0) AS total,
         SUM(d.status = 'Approved') AS approvedCount,
         SUM(d.status = 'Rejected') AS rejectedCount
  FROM receipt_request rr
  LEFT JOIN receipt_request_dtl d ON d.request_id = rr.id
  LEFT JOIN UmrahReciept r ON r.RecieptCode = d.receipt_code AND r.is_deleted = 0
  GROUP BY rr.id`;

// GET /api/receipt-requests?status=Pending|Approved|Rejected
router.get('/', async (req, res) => {
  const { status } = req.query;
  const rows = await query(
    `${LIST_SQL} ${status ? 'HAVING rr.status = ?' : ''} ORDER BY rr.id DESC LIMIT 100`,
    status ? [status] : []
  );
  res.json({ rows });
});

// GET /api/receipt-requests/next-no
router.get('/next-no', async (_req, res) => {
  const [m] = await query('SELECT IFNULL(MAX(id),0) AS mx FROM receipt_request');
  const numbering = await loadNumbering();
  res.json({ next: fmtDocNo(numbering, 'request', m.mx + 501) });
});

// GET /api/receipt-requests/:id — header + receipt lines
router.get('/:id', async (req, res) => {
  const [header] = await query(`${LIST_SQL} HAVING rr.id = ?`, [req.params.id]);
  if (!header) return res.status(404).json({ error: 'Request not found' });
  const receipts = await query(
    `SELECT d.receipt_code AS RecieptCode, d.status AS lineStatus,
            r.RecieptNo, r.RecieptDate, r.RecievedAmount, r.created_at AS CreatedAt, r.InvoiceCode, TRIM(IFNULL(r.PaymentMode,'Cash')) AS PaymentMode,
            i.InvoiceNo, i.InvoiceDate, i.created_at AS InvoiceCreatedAt, i.CustomerName, p.PackageName
     FROM receipt_request_dtl d
     JOIN UmrahReciept r ON r.RecieptCode = d.receipt_code
     LEFT JOIN UmrahInvoice i ON i.InvoiceCode = r.InvoiceCode
     LEFT JOIN UmrahPackage p ON p.PackageCode = i.PackageCode
     WHERE d.request_id = ? ORDER BY r.RecieptNo`,
    [req.params.id]
  );
  res.json({ request: header, receipts });
});

// POST /api/receipt-requests { requestDate, note, receiptCodes: [] }
router.post('/', requirePermission('Receipt', 'Create'), async (req, res) => {
  const { requestDate, note, receiptCodes } = req.body || {};
  if (!Array.isArray(receiptCodes) || !receiptCodes.length) {
    return res.status(400).json({ error: 'Select at least one receipt' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // receipts must be open: not approved, not already in a pending request
    const [valid] = await conn.query(
      `SELECT r.RecieptCode FROM UmrahReciept r
       WHERE r.RecieptCode IN (?)
         AND r.is_deleted = 0
         AND (r.ReceiptApproved IS NULL OR TRIM(r.ReceiptApproved) = '')
         AND NOT EXISTS (
           SELECT 1 FROM receipt_request_dtl d
           JOIN receipt_request rr ON rr.id = d.request_id
           WHERE d.receipt_code = r.RecieptCode AND rr.status = 'Pending' AND d.status = 'Pending')`,
      [receiptCodes]
    );
    if (valid.length !== receiptCodes.length) {
      await conn.rollback();
      return res.status(409).json({ error: 'Some receipts are no longer open — refresh and try again' });
    }
    const [[{ mx }]] = await conn.query('SELECT IFNULL(MAX(id),0) AS mx FROM receipt_request FOR UPDATE');
    const numbering = await loadNumbering();
    const requestNo = fmtDocNo(numbering, 'request', mx + 501);
    const [r] = await conn.query(
      `INSERT INTO receipt_request (request_no, request_date, note, created_by, created_by_name)
       VALUES (?,?,?,?,?)`,
      [requestNo, requestDate || new Date().toISOString().slice(0, 10), note || null,
       req.user?.id ?? null, req.user?.name ?? null]
    );
    for (const code of receiptCodes) {
      await conn.query('INSERT INTO receipt_request_dtl (request_id, receipt_code) VALUES (?,?)', [r.insertId, code]);
    }
    await conn.commit();
    res.status(201).json({ id: r.insertId, requestNo });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

// POST /api/receipt-requests/:id/process { approveCodes: [], comment }
// Ticked receipts are approved & locked; unticked are rejected and returned to Open.
router.post('/:id/process', requirePermission('Receipt Approval', 'Approve'), async (req, res) => {
  const { approveCodes = [], comment } = req.body || {};
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[rr]] = await conn.query('SELECT * FROM receipt_request WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!rr) { await conn.rollback(); return res.status(404).json({ error: 'Request not found' }); }
    if (rr.status !== 'Pending') { await conn.rollback(); return res.status(409).json({ error: 'Request was already processed' }); }
    const [lines] = await conn.query('SELECT receipt_code FROM receipt_request_dtl WHERE request_id = ?', [req.params.id]);
    const all = lines.map((l) => l.receipt_code);
    const approve = all.filter((c) => approveCodes.includes(c));
    const reject = all.filter((c) => !approveCodes.includes(c));
    if (reject.length && !(comment && comment.trim())) {
      await conn.rollback();
      return res.status(400).json({ error: 'A rejection comment is required when returning receipts' });
    }
    if (approve.length) {
      await conn.query(`UPDATE UmrahReciept SET ReceiptApproved='Y' WHERE RecieptCode IN (?)`, [approve]);
      await conn.query(`UPDATE receipt_request_dtl SET status='Approved' WHERE request_id=? AND receipt_code IN (?)`,
        [req.params.id, approve]);
    }
    if (reject.length) {
      await conn.query(`UPDATE receipt_request_dtl SET status='Rejected' WHERE request_id=? AND receipt_code IN (?)`,
        [req.params.id, reject]);
    }
    const status = approve.length ? 'Approved' : 'Rejected';
    await conn.query(
      `UPDATE receipt_request SET status=?, processed_by=?, processed_by_name=?, processed_at=NOW(), comment=? WHERE id=?`,
      [status, req.user?.id ?? null, req.user?.name ?? null, comment || null, req.params.id]
    );
    await conn.commit();
    res.json({ ok: true, status, approved: approve.length, returned: reject.length });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

// POST /api/receipt-requests/:id/revert { reason }
// Undo an approved request: unlock its receipts (back to Open) and record who/when/why.
router.post('/:id/revert', requirePermission('Receipt Approval', 'Approve'), async (req, res) => {
  const { reason } = req.body || {};
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'A reason is required to revert an approval' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[rr]] = await conn.query('SELECT * FROM receipt_request WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!rr) { await conn.rollback(); return res.status(404).json({ error: 'Request not found' }); }
    if (rr.status !== 'Approved') { await conn.rollback(); return res.status(409).json({ error: 'Only an approved request can be reverted' }); }
    // unlock the receipts that were approved in this request → back to Open
    const [appr] = await conn.query(
      `SELECT receipt_code FROM receipt_request_dtl WHERE request_id = ? AND status = 'Approved'`, [req.params.id]);
    const codes = appr.map((r) => r.receipt_code);
    if (codes.length) {
      await conn.query(`UPDATE UmrahReciept SET ReceiptApproved = '' WHERE RecieptCode IN (?)`, [codes]);
    }
    await conn.query(
      `UPDATE receipt_request
         SET status = 'Reverted', reverted_by = ?, reverted_by_name = ?, reverted_at = NOW(), revert_reason = ?
       WHERE id = ?`,
      [req.user?.id ?? null, req.user?.name ?? null, reason.trim(), req.params.id]
    );
    await conn.commit();
    res.json({ ok: true, reverted: codes.length });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

module.exports = { router, ensureTables };
