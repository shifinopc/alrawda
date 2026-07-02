const express = require('express');
const { query, pool } = require('../db');
const { requirePermission } = require('../permissions');
const { ADMINS } = require('../middleware/auth');
const { nextNumber, peekNumber } = require('../docNumber');

const router = express.Router();
const isAdmin = (req) => ADMINS.includes(req.user?.role);

/* ---- add the approval column once; existing payments are treated as already Approved ---- */
let colsEnsured = null;
function ensureCols() {
  if (!colsEnsured) {
    colsEnsured = (async () => {
      const have = await query(
        `SELECT COLUMN_NAME FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'UmrahPayment' AND COLUMN_NAME = 'approval_status'`
      );
      if (!have.length) {
        await query("ALTER TABLE UmrahPayment ADD COLUMN approval_status VARCHAR(20) NOT NULL DEFAULT 'Draft'");
        await query("UPDATE UmrahPayment SET approval_status = 'Approved'"); // backfill: historical payments are final
      }
    })();
  }
  return colsEnsured;
}

const LIST_SQL = `
  SELECT p.PaymentCode, p.PaymentNo, p.PaymentDate, TRIM(p.TypeOfPayment) AS TypeOfPayment,
         p.InvoiceCode, p.PaidTo, p.Narration, p.Remark, p.PaymentAmount, p.InvoiceAmount,
         p.CollectedAmount, p.MobileNo, TRIM(IFNULL(p.IsInvoiceCancel,'N')) AS IsInvoiceCancel,
         TRIM(IFNULL(p.approval_status,'Approved')) AS ApprovalStatus,
         p.created_by_name AS CreatedByName, p.created_at AS CreatedAt,
         i.InvoiceNo, i.InvoiceDate, i.created_at AS InvoiceCreatedAt, i.CustomerName
  FROM UmrahPayment p
  LEFT JOIN UmrahInvoice i ON i.InvoiceCode = p.InvoiceCode`;

// GET /api/payments?payNo=&payee=&type=Expense|Refund&deleted=1
router.get('/', async (req, res) => {
  await ensureCols();
  const { payNo, payee, type } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Number(req.query.pageSize) || 50);
  const where = [`p.is_deleted = ${req.query.deleted === '1' ? 1 : 0}`], params = [];
  if (payNo) {
    if (req.query.payNoMode === 'equals') { where.push('p.PaymentNo = ?'); params.push(payNo); }
    else { where.push('p.PaymentNo LIKE ?'); params.push(`%${payNo}%`); }
  }
  if (payee) { where.push('p.PaidTo LIKE ?'); params.push(`%${payee}%`); }
  if (type) { where.push('TRIM(p.TypeOfPayment) = ?'); params.push(type); }
  if (req.query.from) { where.push('DATE(p.PaymentDate) >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('DATE(p.PaymentDate) <= ?'); params.push(req.query.to); }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const rows = await query(
    `${LIST_SQL} ${whereSql} ORDER BY p.PaymentCode DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM UmrahPayment p ${whereSql}`, params);
  res.json({ rows, page, pageSize, total });
});

// GET /api/payments/next-no
router.get('/next-no', async (_req, res) => {
  res.json({ next: await peekNumber('payment') });
});

// GET /api/payments/:code
router.get('/:code', async (req, res) => {
  const rows = await query(`${LIST_SQL} WHERE p.PaymentCode = ?`, [req.params.code]);
  if (!rows.length) return res.status(404).json({ error: 'Payment not found' });
  res.json({ payment: rows[0] });
});

// GET /api/payments/:code/history — created → (deleted/restored)
router.get('/:code/history', async (req, res) => {
  const code = req.params.code;
  const [p] = await query(
    `SELECT PaymentNo, PaymentDate, PaymentAmount, TRIM(TypeOfPayment) AS TypeOfPayment, Narration,
            created_at, created_by_name, is_deleted, deleted_at, deleted_by_name,
            TRIM(IFNULL(IsInvoiceCancel,'N')) AS IsInvoiceCancel
     FROM UmrahPayment WHERE PaymentCode = ?`, [code]);
  if (!p) return res.status(404).json({ error: 'Payment not found' });

  const events = [];
  events.push({
    kind: 'created', title: `${p.TypeOfPayment} created`,
    note: `${p.PaymentNo} · QAR ${Number(p.PaymentAmount).toLocaleString()}${p.Narration ? ` · ${p.Narration}` : ''}`,
    user: p.created_by_name, date: p.created_at || p.PaymentDate,
  });
  if (p.TypeOfPayment === 'Refund' && p.IsInvoiceCancel === 'Y') {
    events.push({ kind: 'cancelled', title: 'Linked invoice cancelled (full refund)', date: p.created_at || p.PaymentDate });
  }
  // approvals + restores (from the audit log)
  const approves = await query(
    `SELECT user_name, user_role, created_at FROM activity_log
     WHERE status < 400 AND path = ? ORDER BY id`, [`/api/payments/${code}/approve`]
  ).catch(() => []);
  approves.forEach((a) => events.push({ kind: 'approved', title: 'Approved & locked', user: a.user_name, role: a.user_role, date: a.created_at }));
  const acts = await query(
    `SELECT user_name, user_role, created_at FROM activity_log
     WHERE status < 400 AND path = ? ORDER BY id`, [`/api/payments/${code}/restore`]
  ).catch(() => []);
  acts.forEach((a) => events.push({ kind: 'approved', title: 'Restored from recycle bin', user: a.user_name, role: a.user_role, date: a.created_at }));
  if (p.is_deleted) {
    events.push({ kind: 'cancelled', title: 'Moved to recycle bin', user: p.deleted_by_name, date: p.deleted_at });
  }
  events.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  res.json({ paymentNo: p.PaymentNo, events });
});

// POST /api/payments
// Expense: { type:'Expense', paymentDate, paidTo, mobileNo, narration, amount, remarks }
// Refund:  { type:'Refund', paymentDate, invoiceCode, mobileNo, amount, reason, remarks, cancelInvoice }
router.post('/', requirePermission('Payment', 'Create'), async (req, res) => {
  await ensureCols();
  const b = req.body || {};
  const type = b.type === 'Refund' ? 'Refund' : 'Expense';
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'Amount cannot be negative' });
  // an expense must be positive; a refund may be zero (e.g. cancel an invoice with nothing collected)
  if (type === 'Expense' && amount <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let invoiceCode = 0, invoiceAmount = 0, collectedAmount = 0, paidTo = b.paidTo || '';
    if (type === 'Refund') {
      if (!b.invoiceCode) { await conn.rollback(); return res.status(400).json({ error: 'Invoice is required for a refund' }); }
      const [[inv]] = await conn.query(
        `SELECT i.InvoiceCode, i.InvoiceNo, i.NetAmount, IFNULL(SUM(r.RecievedAmount),0) AS received
         FROM UmrahInvoice i LEFT JOIN UmrahReciept r ON r.InvoiceCode = i.InvoiceCode AND r.is_deleted = 0
         WHERE i.InvoiceCode = ? GROUP BY i.InvoiceCode, i.InvoiceNo, i.NetAmount`,
        [b.invoiceCode]
      );
      if (!inv) { await conn.rollback(); return res.status(404).json({ error: 'Invoice not found' }); }
      invoiceCode = inv.InvoiceCode;
      invoiceAmount = Number(inv.NetAmount);
      collectedAmount = Number(inv.received);
      // only a POSITIVE refund needs money to have been collected; a zero refund
      // (used to just cancel the invoice) is allowed even when nothing was collected
      if (amount > 0 && collectedAmount <= 0) {
        await conn.rollback();
        return res.status(400).json({ error: 'Nothing has been collected on this invoice — there is nothing to refund' });
      }
      const [[prevRefunds]] = await conn.query(
        `SELECT IFNULL(SUM(PaymentAmount),0) AS refunded FROM UmrahPayment
         WHERE InvoiceCode = ? AND TRIM(TypeOfPayment) = 'Refund' AND is_deleted=0`,
        [invoiceCode]
      );
      const refundable = collectedAmount - Number(prevRefunds.refunded);
      if (amount > refundable) {
        await conn.rollback();
        return res.status(400).json({ error: `Refund exceeds the refundable amount (QAR ${refundable} collected and not yet refunded)` });
      }
      paidTo = paidTo || `INVOICE NO. ${inv.InvoiceNo}`;
      // the linked invoice is only cancelled when the refund is APPROVED (see /:code/approve)
    }
    if (!paidTo) { await conn.rollback(); return res.status(400).json({ error: 'Paid To is required' }); }
    const paymentDate = b.paymentDate || new Date().toLocaleDateString('en-CA');
    const nextNo = await nextNumber(conn, 'payment', paymentDate);
    const [result] = await conn.query(
      `INSERT INTO UmrahPayment (PaymentNo, PaymentDate, TypeOfPayment, InvoiceCode, PaidTo, Narration,
        Remark, PaymentAmount, InvoiceAmount, CollectedAmount, MobileNo, IsInvoiceCancel, approval_status,
        created_by, created_by_name, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'Draft',?,?,NOW())`,
      [nextNo, paymentDate, type, invoiceCode, paidTo,
       b.narration || b.reason || null, b.remarks || null, amount, invoiceAmount, collectedAmount,
       b.mobileNo || null, b.cancelInvoice ? 'Y' : 'N',
       req.user?.id ?? null, req.user?.name ?? null]
    );
    await conn.commit();
    res.status(201).json({ paymentCode: result.insertId, paymentNo: nextNo });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

// PUT /api/payments/:code — edit a Draft payment (admins may edit Approved too)
router.put('/:code', requirePermission('Payment', 'Edit'), async (req, res) => {
  await ensureCols();
  const b = req.body || {};
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[cur]] = await conn.query(
      `SELECT PaymentCode, TRIM(TypeOfPayment) AS TypeOfPayment, InvoiceCode, CollectedAmount,
              TRIM(IFNULL(approval_status,'Approved')) AS st, is_deleted
       FROM UmrahPayment WHERE PaymentCode=? FOR UPDATE`, [req.params.code]);
    if (!cur) { await conn.rollback(); return res.status(404).json({ error: 'Payment not found' }); }
    if (cur.is_deleted) { await conn.rollback(); return res.status(400).json({ error: 'This payment is in the recycle bin' }); }
    if (cur.st === 'Approved' && !isAdmin(req)) {
      await conn.rollback();
      return res.status(403).json({ error: 'This payment is approved and locked. Ask an administrator to edit it.' });
    }
    const amount = Number(b.amount);
    if (!Number.isFinite(amount) || amount < 0) { await conn.rollback(); return res.status(400).json({ error: 'Amount cannot be negative' }); }
    // a refund may be zero (invoice cancellation); an expense must be positive
    if (cur.TypeOfPayment !== 'Refund' && amount <= 0) { await conn.rollback(); return res.status(400).json({ error: 'Amount must be greater than zero' }); }

    if (cur.TypeOfPayment === 'Refund') {
      // re-validate against the refundable balance, excluding this payment
      const [[prev]] = await conn.query(
        `SELECT IFNULL(SUM(PaymentAmount),0) AS refunded FROM UmrahPayment
         WHERE InvoiceCode=? AND TRIM(TypeOfPayment)='Refund' AND is_deleted=0 AND PaymentCode<>?`,
        [cur.InvoiceCode, req.params.code]);
      const refundable = Number(cur.CollectedAmount) - Number(prev.refunded);
      if (amount > refundable) {
        await conn.rollback();
        return res.status(400).json({ error: `Refund exceeds the refundable amount (QAR ${refundable})` });
      }
      await conn.query(
        `UPDATE UmrahPayment SET PaymentDate=?, PaymentAmount=?, Narration=?, Remark=?, MobileNo=? WHERE PaymentCode=?`,
        [b.paymentDate || new Date().toLocaleDateString('en-CA'), amount, b.narration || b.reason || null,
         b.remarks || null, b.mobileNo || null, req.params.code]);
    } else {
      if (!b.paidTo) { await conn.rollback(); return res.status(400).json({ error: 'Paid To is required' }); }
      await conn.query(
        `UPDATE UmrahPayment SET PaymentDate=?, PaidTo=?, PaymentAmount=?, Narration=?, Remark=?, MobileNo=? WHERE PaymentCode=?`,
        [b.paymentDate || new Date().toLocaleDateString('en-CA'), b.paidTo, amount, b.narration || null,
         b.remarks || null, b.mobileNo || null, req.params.code]);
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

// POST /api/payments/:code/approve — finalise a Draft payment (locks it)
router.post('/:code/approve', requirePermission('Payment', 'Approve'), async (req, res) => {
  await ensureCols();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[p]] = await conn.query(
      `SELECT PaymentCode, InvoiceCode, TRIM(IFNULL(IsInvoiceCancel,'N')) AS IsInvoiceCancel,
              TRIM(IFNULL(approval_status,'Approved')) AS st, is_deleted
       FROM UmrahPayment WHERE PaymentCode=? FOR UPDATE`, [req.params.code]);
    if (!p) { await conn.rollback(); return res.status(404).json({ error: 'Payment not found' }); }
    if (p.is_deleted) { await conn.rollback(); return res.status(400).json({ error: 'This payment is in the recycle bin' }); }
    if (p.st === 'Approved') { await conn.rollback(); return res.status(400).json({ error: 'Payment is already approved' }); }
    await conn.query(`UPDATE UmrahPayment SET approval_status='Approved' WHERE PaymentCode=?`, [req.params.code]);
    // a refund flagged to cancel the invoice takes effect now, on approval
    if (p.IsInvoiceCancel === 'Y' && p.InvoiceCode) {
      await conn.query(`UPDATE UmrahInvoice SET CancelYesNo='Y' WHERE InvoiceCode=?`, [p.InvoiceCode]);
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

// DELETE /api/payments/:code — soft delete (moves to recycle bin). Refund cancellations stay reversible.
router.delete('/:code', requirePermission('Payment', 'Delete'), async (req, res) => {
  await ensureCols();
  const rows = await query(
    `SELECT TRIM(IFNULL(approval_status,'Approved')) AS st FROM UmrahPayment WHERE PaymentCode=? AND is_deleted=0`,
    [req.params.code]);
  const cur = rows[0];
  if (cur && cur.st === 'Approved' && !isAdmin(req)) {
    return res.status(403).json({ error: 'This payment is approved and locked. Ask an administrator to remove it.' });
  }
  const result = await query(
    `UPDATE UmrahPayment SET is_deleted=1, deleted_at=NOW(), deleted_by_name=? WHERE PaymentCode=? AND is_deleted=0`,
    [req.user?.name ?? null, req.params.code]
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Payment not found' });
  res.json({ ok: true });
});

// POST /api/payments/:code/restore — bring back from recycle bin
router.post('/:code/restore', requirePermission('Payment', 'Delete'), async (req, res) => {
  const result = await query(
    `UPDATE UmrahPayment SET is_deleted=0, deleted_at=NULL, deleted_by_name=NULL WHERE PaymentCode=? AND is_deleted=1`,
    [req.params.code]
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Deleted payment not found' });
  res.json({ ok: true });
});

module.exports = router;
