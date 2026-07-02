const express = require('express');
const { query, pool } = require('../db');
const { requirePermission } = require('../permissions');

const router = express.Router();

let tableEnsured = null;
function ensureTable() {
  if (!tableEnsured) {
    tableEnsured = query(`CREATE TABLE IF NOT EXISTS invoice_adjustments (
      id INT NOT NULL AUTO_INCREMENT,
      invoice_code INT NOT NULL,
      amount DECIMAL(18,2) NOT NULL,
      reason VARCHAR(200) NULL,
      remarks VARCHAR(500) NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'Draft',
      created_by INT NULL, created_by_name VARCHAR(100) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      approved_by INT NULL, approved_by_name VARCHAR(100) NULL, approved_at DATETIME NULL,
      PRIMARY KEY (id), KEY idx_inv (invoice_code), KEY idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
  return tableEnsured;
}

// live balance for an invoice (net minus receipts)
const BALANCE_SQL = `
  SELECT i.InvoiceCode, i.InvoiceNo, i.CustomerName, i.NetAmount,
         TRIM(IFNULL(i.CancelYesNo,'N')) AS CancelYesNo,
         IFNULL((SELECT SUM(RecievedAmount) FROM UmrahReciept WHERE InvoiceCode=i.InvoiceCode AND is_deleted=0),0) AS received,
         (i.NetAmount - IFNULL((SELECT SUM(RecievedAmount) FROM UmrahReciept WHERE InvoiceCode=i.InvoiceCode AND is_deleted=0),0)) AS balance
  FROM UmrahInvoice i WHERE i.InvoiceCode = ?`;

// GET /api/adjustments?status=Draft
router.get('/', async (req, res) => {
  await ensureTable();
  const where = [], params = [];
  if (req.query.status) { where.push('a.status = ?'); params.push(req.query.status); }
  if (req.query.invoiceCode) { where.push('a.invoice_code = ?'); params.push(req.query.invoiceCode); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await query(
    `SELECT a.*, i.InvoiceNo, i.InvoiceDate, i.created_at AS InvCreatedAt, i.CustomerName,
            (i.NetAmount - IFNULL((SELECT SUM(RecievedAmount) FROM UmrahReciept WHERE InvoiceCode=i.InvoiceCode AND is_deleted=0),0)) AS balance
     FROM invoice_adjustments a
     LEFT JOIN UmrahInvoice i ON i.InvoiceCode = a.invoice_code
     ${whereSql} ORDER BY a.id DESC LIMIT 200`, params);
  res.json({ rows });
});

// POST /api/adjustments  { invoiceCode, amount, reason, remarks } — applies the write-off immediately
router.post('/', requirePermission('Invoice Adjustment', 'Create'), async (req, res) => {
  await ensureTable();
  const b = req.body || {};
  const amount = Number(b.amount);
  if (!b.invoiceCode) return res.status(400).json({ error: 'Invoice is required' });
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Adjustment amount must be greater than zero' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[inv]] = await conn.query(
      `SELECT i.NetAmount, TRIM(IFNULL(i.CancelYesNo,'N')) AS CancelYesNo,
              (i.NetAmount - IFNULL((SELECT SUM(RecievedAmount) FROM UmrahReciept WHERE InvoiceCode=i.InvoiceCode AND is_deleted=0),0)) AS balance
       FROM UmrahInvoice i WHERE i.InvoiceCode=? AND i.is_deleted=0 FOR UPDATE`, [b.invoiceCode]);
    if (!inv) { await conn.rollback(); return res.status(404).json({ error: 'Invoice not found' }); }
    if (inv.CancelYesNo === 'Y') { await conn.rollback(); return res.status(400).json({ error: 'This invoice is cancelled' }); }
    if (amount > Number(inv.balance)) { await conn.rollback(); return res.status(400).json({ error: 'Adjustment exceeds balance due' }); }
    const note = `[Adjustment ${new Date().toLocaleDateString('en-CA')}] ${b.reason || ''} ${b.remarks || ''} (QAR ${amount})`.trim();
    await conn.query(
      `UPDATE UmrahInvoice SET DiscountAmount = IFNULL(DiscountAmount,0) + ?, NetAmount = NetAmount - ?,
         Remarks = CONCAT(IFNULL(Remarks,''), '\n', ?) WHERE InvoiceCode = ?`,
      [amount, amount, note, b.invoiceCode]);
    await conn.query(
      `INSERT INTO invoice_adjustments (invoice_code, amount, reason, remarks, status, created_by, created_by_name, approved_by, approved_by_name, approved_at)
       VALUES (?,?,?,?,'Approved',?,?,?,?,NOW())`,
      [b.invoiceCode, amount, b.reason || null, b.remarks || null,
       req.user?.id ?? null, req.user?.name ?? null, req.user?.id ?? null, req.user?.name ?? null]);
    await conn.commit();
    res.status(201).json({ ok: true, newBalance: Number(inv.balance) - amount });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

// POST /api/adjustments/:id/approve — apply the write-off to the invoice (locks the adjustment)
router.post('/:id/approve', requirePermission('Invoice Adjustment', 'Approve'), async (req, res) => {
  await ensureTable();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[adj]] = await conn.query('SELECT * FROM invoice_adjustments WHERE id=? FOR UPDATE', [req.params.id]);
    if (!adj) { await conn.rollback(); return res.status(404).json({ error: 'Adjustment not found' }); }
    if (adj.status !== 'Draft') { await conn.rollback(); return res.status(400).json({ error: `Adjustment is already ${adj.status}` }); }
    const [[inv]] = await conn.query(
      `SELECT i.NetAmount, TRIM(IFNULL(i.CancelYesNo,'N')) AS CancelYesNo,
              (i.NetAmount - IFNULL((SELECT SUM(RecievedAmount) FROM UmrahReciept WHERE InvoiceCode=i.InvoiceCode AND is_deleted=0),0)) AS balance
       FROM UmrahInvoice i WHERE i.InvoiceCode=? FOR UPDATE`, [adj.invoice_code]);
    if (!inv) { await conn.rollback(); return res.status(404).json({ error: 'Invoice not found' }); }
    if (inv.CancelYesNo === 'Y') { await conn.rollback(); return res.status(400).json({ error: 'This invoice is cancelled' }); }
    const amt = Number(adj.amount);
    if (amt > Number(inv.balance)) {
      await conn.rollback();
      return res.status(400).json({ error: `Adjustment (QAR ${amt}) now exceeds the balance due (QAR ${inv.balance})` });
    }
    const note = `[Adjustment ${new Date().toLocaleDateString('en-CA')}] ${adj.reason || ''} ${adj.remarks || ''} (QAR ${amt})`.trim();
    await conn.query(
      `UPDATE UmrahInvoice SET DiscountAmount = IFNULL(DiscountAmount,0) + ?, NetAmount = NetAmount - ?,
         Remarks = CONCAT(IFNULL(Remarks,''), '\n', ?) WHERE InvoiceCode = ?`,
      [amt, amt, note, adj.invoice_code]);
    await conn.query(
      `UPDATE invoice_adjustments SET status='Approved', approved_by=?, approved_by_name=?, approved_at=NOW() WHERE id=?`,
      [req.user?.id ?? null, req.user?.name ?? null, req.params.id]);
    await conn.commit();
    res.json({ ok: true, newBalance: Number(inv.balance) - amt });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

// POST /api/adjustments/:id/reject — decline a Draft adjustment
router.post('/:id/reject', requirePermission('Invoice Adjustment', 'Approve'), async (req, res) => {
  await ensureTable();
  const r = await query(
    `UPDATE invoice_adjustments SET status='Rejected', approved_by=?, approved_by_name=?, approved_at=NOW()
     WHERE id=? AND status='Draft'`,
    [req.user?.id ?? null, req.user?.name ?? null, req.params.id]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Draft adjustment not found' });
  res.json({ ok: true });
});

// PUT /api/adjustments/:id  { amount, reason, remarks } — change an applied adjustment (re-balances the invoice)
router.put('/:id', requirePermission('Invoice Adjustment', 'Create'), async (req, res) => {
  await ensureTable();
  const b = req.body || {};
  const newAmt = Number(b.amount);
  if (!newAmt || newAmt <= 0) return res.status(400).json({ error: 'Adjustment amount must be greater than zero' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[adj]] = await conn.query('SELECT * FROM invoice_adjustments WHERE id=? FOR UPDATE', [req.params.id]);
    if (!adj) { await conn.rollback(); return res.status(404).json({ error: 'Adjustment not found' }); }
    const [[inv]] = await conn.query(
      `SELECT i.NetAmount, TRIM(IFNULL(i.CancelYesNo,'N')) AS CancelYesNo,
              (i.NetAmount - IFNULL((SELECT SUM(RecievedAmount) FROM UmrahReciept WHERE InvoiceCode=i.InvoiceCode AND is_deleted=0),0)) AS balance
       FROM UmrahInvoice i WHERE i.InvoiceCode=? AND i.is_deleted=0 FOR UPDATE`, [adj.invoice_code]);
    if (!inv) { await conn.rollback(); return res.status(404).json({ error: 'Invoice not found' }); }
    if (inv.CancelYesNo === 'Y') { await conn.rollback(); return res.status(400).json({ error: 'This invoice is cancelled' }); }
    const oldAmt = Number(adj.amount);
    // reversing the old write-off frees up (balance + oldAmt); the new amount must fit within that
    const room = Number(inv.balance) + oldAmt;
    if (newAmt > room) { await conn.rollback(); return res.status(400).json({ error: `Adjustment exceeds the balance due (max QAR ${room})` }); }
    const delta = newAmt - oldAmt; // +ve writes off more, -ve gives back
    const note = `[Adjustment edited ${new Date().toLocaleDateString('en-CA')}] ${b.reason || ''} ${b.remarks || ''} (QAR ${oldAmt} → ${newAmt})`.trim();
    await conn.query(
      `UPDATE UmrahInvoice SET DiscountAmount = IFNULL(DiscountAmount,0) + ?, NetAmount = NetAmount - ?,
         Remarks = CONCAT(IFNULL(Remarks,''), '\n', ?) WHERE InvoiceCode = ?`,
      [delta, delta, note, adj.invoice_code]);
    await conn.query(
      `UPDATE invoice_adjustments SET amount=?, reason=?, remarks=? WHERE id=?`,
      [newAmt, b.reason || null, b.remarks || null, req.params.id]);
    await conn.commit();
    res.json({ ok: true, newBalance: Number(inv.balance) - delta });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

// DELETE /api/adjustments/:id — reverse the write-off (restores the invoice balance) and remove the record
router.delete('/:id', requirePermission('Invoice Adjustment', 'Create'), async (req, res) => {
  await ensureTable();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[adj]] = await conn.query('SELECT * FROM invoice_adjustments WHERE id=? FOR UPDATE', [req.params.id]);
    if (!adj) { await conn.rollback(); return res.status(404).json({ error: 'Adjustment not found' }); }
    const amt = Number(adj.amount);
    if (adj.status === 'Approved') {
      // reverse the effect on the invoice
      const note = `[Adjustment removed ${new Date().toLocaleDateString('en-CA')}] reversed QAR ${amt}`;
      await conn.query(
        `UPDATE UmrahInvoice SET DiscountAmount = GREATEST(IFNULL(DiscountAmount,0) - ?, 0), NetAmount = NetAmount + ?,
           Remarks = CONCAT(IFNULL(Remarks,''), '\n', ?) WHERE InvoiceCode = ? AND is_deleted = 0`,
        [amt, amt, note, adj.invoice_code]);
    }
    await conn.query('DELETE FROM invoice_adjustments WHERE id=?', [req.params.id]);
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

module.exports = { router, ensureTable };
