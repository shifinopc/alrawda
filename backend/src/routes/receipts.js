const express = require('express');
const { query, pool } = require('../db');
const { requirePermission } = require('../permissions');
const { ADMINS } = require('../middleware/auth');
const { notifyReceiptCreated } = require('../notify');
const { invoiceTimeline } = require('../invoiceTimeline');
const { nextNumber, peekNumber } = require('../docNumber');

const router = express.Router();
const isAdmin = (req) => ADMINS.includes(req.user?.role);

const BOOKED_EXISTS = `EXISTS (
  SELECT 1 FROM receipt_request_dtl d
  JOIN receipt_request rr ON rr.id = d.request_id
  WHERE d.receipt_code = r.RecieptCode AND rr.status = 'Pending' AND d.status = 'Pending')`;

const LIST_SQL = `
  SELECT r.RecieptCode, r.RecieptNo, r.RecieptDate, r.InvoiceCode, r.RecievedAmount,
         r.PreBalanceAmount, r.CurrentBalanceAmount, TRIM(IFNULL(r.PaymentMode,'Cash')) AS PaymentMode,
         r.Bank, r.ChequeNo, r.RoomDetails, r.PassengerDetails, r.InvRemarks,
         CASE WHEN TRIM(IFNULL(r.ReceiptApproved,'')) = 'Y' THEN 'Approved'
              WHEN ${BOOKED_EXISTS} THEN 'Booked'
              ELSE 'Open' END AS status,
         r.created_by_name AS CreatedByName, r.created_at AS CreatedAt,
         i.InvoiceNo, i.InvoiceDate, i.created_at AS InvoiceCreatedAt, i.CustomerName, i.Mobile1, i.Mobile2, i.DepartureDate,
         i.PassengerCount, i.SeatCount, i.VisaCount, i.NetAmount AS InvoiceAmount, i.RoomType,
         i.ShowAgent, ag.AgentName, ag.MobileNo AS AgentMobile,
         p.PackageName, c.CountryName AS Nationality
  FROM UmrahReciept r
  LEFT JOIN UmrahInvoice i ON i.InvoiceCode = r.InvoiceCode
  LEFT JOIN UmrahPackage p ON p.PackageCode = i.PackageCode
  LEFT JOIN AdminCountryInfo c ON c.CountryCode = i.NatinalityCode
  LEFT JOIN agents ag ON ag.AgentCode = i.AgentCode`;

// GET /api/receipts?recNo=&date=&customer=&status=open|approved
router.get('/', async (req, res) => {
  const { recNo, invoiceNo, date, customer, status } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(1000, Number(req.query.pageSize) || 50);
  const where = [`r.is_deleted = ${req.query.deleted === '1' ? 1 : 0}`], params = [];
  if (recNo) {
    if (req.query.recNoMode === 'equals') { where.push('r.RecieptNo = ?'); params.push(recNo); }
    else { where.push('r.RecieptNo LIKE ?'); params.push(`%${recNo}%`); }
  }
  if (invoiceNo) {
    if (req.query.invoiceNoMode === 'equals') { where.push('i.InvoiceNo = ?'); params.push(invoiceNo); }
    else { where.push('i.InvoiceNo LIKE ?'); params.push(`%${invoiceNo}%`); }
  }
  if (date) { where.push('DATE(r.RecieptDate) = ?'); params.push(date); }
  if (req.query.from) { where.push('DATE(r.RecieptDate) >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('DATE(r.RecieptDate) <= ?'); params.push(req.query.to); }
  if (customer) { where.push('i.CustomerName LIKE ?'); params.push(`%${customer}%`); }
  if (status === 'open') where.push(`(r.ReceiptApproved IS NULL OR TRIM(r.ReceiptApproved) = '') AND NOT ${BOOKED_EXISTS}`);
  if (status === 'booked') where.push(`(r.ReceiptApproved IS NULL OR TRIM(r.ReceiptApproved) = '') AND ${BOOKED_EXISTS}`);
  if (status === 'approved') where.push(`TRIM(IFNULL(r.ReceiptApproved,'')) = 'Y'`);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await query(
    `${LIST_SQL} ${whereSql} ORDER BY r.RecieptCode DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  const [{ total }] = await query(
    `SELECT COUNT(*) AS total FROM UmrahReciept r LEFT JOIN UmrahInvoice i ON i.InvoiceCode = r.InvoiceCode ${whereSql}`,
    params
  );
  res.json({ rows, page, pageSize, total });
});

// GET /api/receipts/next-no
router.get('/next-no', async (_req, res) => {
  res.json({ next: await peekNumber('receipt') });
});

// GET /api/receipts/:code
router.get('/:code', async (req, res) => {
  const rows = await query(`${LIST_SQL} WHERE r.RecieptCode = ?`, [req.params.code]);
  if (!rows.length) return res.status(404).json({ error: 'Receipt not found' });
  res.json({ receipt: rows[0] });
});

// GET /api/receipts/:code/history — full timeline of the receipt's invoice
// (all related transactions: invoice, every receipt, requests, approvals, reverts, refunds, adjustments)
router.get('/:code/history', async (req, res) => {
  const [rec] = await query(
    'SELECT RecieptNo, RecieptDate, RecievedAmount, InvoiceCode, created_at, created_by_name FROM UmrahReciept WHERE RecieptCode = ?',
    [req.params.code]);
  if (!rec) return res.status(404).json({ error: 'Receipt not found' });
  if (rec.InvoiceCode) {
    const t = await invoiceTimeline(rec.InvoiceCode);
    if (t) return res.json({ receiptNo: rec.RecieptNo, invoiceNo: t.invoiceNo, events: t.events });
  }
  // receipt without a linked invoice — just its own creation
  res.json({
    receiptNo: rec.RecieptNo,
    events: [{
      kind: 'created', title: 'Receipt created',
      note: `${rec.RecieptNo} · QAR ${Number(rec.RecievedAmount).toLocaleString()}`,
      user: rec.created_by_name, date: rec.created_at || rec.RecieptDate,
    }],
  });
});

// POST /api/receipts  { invoiceCode, receiptDate, receivedAmount, paymentMode, bank, chequeNo, roomDetails, passengerDetails, remarks }
router.post('/', requirePermission('Receipt', 'Create'), async (req, res) => {
  const b = req.body || {};
  if (!b.invoiceCode) return res.status(400).json({ error: 'Invoice is required' });
  const amount = Number(b.receivedAmount);
  if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'Received amount cannot be negative' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[inv]] = await conn.query(
      `SELECT i.InvoiceCode, i.NetAmount, TRIM(IFNULL(i.CancelYesNo,'N')) AS CancelYesNo,
              IFNULL(SUM(r.RecievedAmount),0) AS received
       FROM UmrahInvoice i LEFT JOIN UmrahReciept r ON r.InvoiceCode = i.InvoiceCode AND r.is_deleted = 0
       WHERE i.InvoiceCode = ? GROUP BY i.InvoiceCode, i.NetAmount, i.CancelYesNo FOR UPDATE`,
      [b.invoiceCode]
    );
    if (!inv) { await conn.rollback(); return res.status(404).json({ error: 'Invoice not found' }); }
    if (inv.CancelYesNo === 'Y') {
      await conn.rollback();
      return res.status(400).json({ error: 'This invoice is cancelled — no receipts can be added to it' });
    }
    const preBalance = Number(inv.NetAmount) - Number(inv.received);
    if (amount > preBalance) {
      await conn.rollback();
      return res.status(400).json({ error: `Received amount exceeds the invoice balance (QAR ${preBalance})` });
    }
    const currentBalance = preBalance - amount;
    const receiptDate = b.receiptDate || new Date().toLocaleDateString('en-CA');
    const nextNo = await nextNumber(conn, 'receipt', receiptDate);
    const [result] = await conn.query(
      `INSERT INTO UmrahReciept (InvoiceCode, RecieptDate, RecieptNo, RecievedAmount, CurrentBalanceAmount,
        InvRemarks, PassengerDetails, PreBalanceAmount, PaymentMode, Bank, ChequeNo, RoomDetails, ReceiptApproved,
        created_by, created_by_name, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,NOW())`,
      [b.invoiceCode, receiptDate, nextNo, amount, currentBalance,
       b.remarks || null, b.passengerDetails || null, preBalance, b.paymentMode || 'Cash',
       b.bank || null, b.chequeNo || null, b.roomDetails || null,
       req.user?.id ?? null, req.user?.name ?? null]
    );
    await conn.commit();
    notifyReceiptCreated(result.insertId); // fire-and-forget email to management
    res.status(201).json({ receiptCode: result.insertId, receiptNo: nextNo, preBalance, currentBalance });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

// PUT /api/receipts/:code — edit a receipt while it is still Open (admins may edit anytime)
router.put('/:code', requirePermission('Receipt', 'Edit'), async (req, res) => {
  const b = req.body || {};
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[r]] = await conn.query(
      `SELECT r.RecieptCode, r.InvoiceCode, TRIM(IFNULL(r.ReceiptApproved,'')) AS approved,
              ${BOOKED_EXISTS} AS booked
       FROM UmrahReciept r WHERE r.RecieptCode=? FOR UPDATE`, [req.params.code]);
    if (!r) { await conn.rollback(); return res.status(404).json({ error: 'Receipt not found' }); }
    const locked = r.approved === 'Y' || Number(r.booked) === 1;
    if (locked && !isAdmin(req)) {
      await conn.rollback();
      const why = r.approved === 'Y' ? 'approved and locked' : 'booked for approval';
      return res.status(403).json({ error: `This receipt is ${why}. It can no longer be edited.` });
    }
    const amount = Number(b.receivedAmount);
    if (!Number.isFinite(amount) || amount < 0) { await conn.rollback(); return res.status(400).json({ error: 'Received amount cannot be negative' }); }

    // recompute balances against the invoice, excluding this receipt
    const [[inv]] = await conn.query(
      `SELECT i.NetAmount, IFNULL(SUM(o.RecievedAmount),0) AS otherReceived
       FROM UmrahInvoice i LEFT JOIN UmrahReciept o ON o.InvoiceCode=i.InvoiceCode AND o.RecieptCode<>? AND o.is_deleted=0
       WHERE i.InvoiceCode=? GROUP BY i.NetAmount`, [req.params.code, r.InvoiceCode]);
    if (!inv) { await conn.rollback(); return res.status(404).json({ error: 'Linked invoice not found' }); }
    const preBalance = Number(inv.NetAmount) - Number(inv.otherReceived);
    if (amount > preBalance) {
      await conn.rollback();
      return res.status(400).json({ error: `Received amount exceeds the invoice balance (QAR ${preBalance})` });
    }
    const currentBalance = preBalance - amount;
    await conn.query(
      `UPDATE UmrahReciept SET RecieptDate=?, RecievedAmount=?, PreBalanceAmount=?, CurrentBalanceAmount=?,
        PaymentMode=?, Bank=?, ChequeNo=?, RoomDetails=?, PassengerDetails=?, InvRemarks=? WHERE RecieptCode=?`,
      [b.receiptDate || new Date().toLocaleDateString('en-CA'), amount, preBalance, currentBalance,
       b.paymentMode || 'Cash', b.paymentMode === 'Bank' ? (b.bank || null) : null,
       b.paymentMode === 'Bank' ? (b.chequeNo || null) : null, b.roomDetails || null,
       b.passengerDetails || null, b.remarks || null, req.params.code]);
    await conn.commit();
    res.json({ ok: true, preBalance, currentBalance });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

// DELETE /api/receipts/:code — soft delete (recycle bin). Only Open receipts; admins may remove any.
router.delete('/:code', requirePermission('Receipt', 'Delete'), async (req, res) => {
  const [r] = await query(
    `SELECT TRIM(IFNULL(ReceiptApproved,'')) AS approved, ${BOOKED_EXISTS} AS booked
     FROM UmrahReciept r WHERE RecieptCode=? AND is_deleted=0`, [req.params.code]);
  if (!r) return res.status(404).json({ error: 'Receipt not found' });
  if ((r.approved === 'Y' || Number(r.booked) === 1) && !isAdmin(req)) {
    return res.status(403).json({ error: 'This receipt is locked (booked/approved) and can only be removed by an administrator.' });
  }
  await query(
    `UPDATE UmrahReciept SET is_deleted=1, deleted_at=NOW(), deleted_by_name=? WHERE RecieptCode=? AND is_deleted=0`,
    [req.user?.name ?? null, req.params.code]);
  res.json({ ok: true });
});

// POST /api/receipts/:code/restore — bring back from recycle bin
router.post('/:code/restore', requirePermission('Receipt', 'Delete'), async (req, res) => {
  const result = await query(
    `UPDATE UmrahReciept SET is_deleted=0, deleted_at=NULL, deleted_by_name=NULL WHERE RecieptCode=? AND is_deleted=1`,
    [req.params.code]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Deleted receipt not found' });
  res.json({ ok: true });
});

// POST /api/receipts/approve  { codes: [..] } — manager approval, locks receipts
router.post('/approve', requirePermission('Receipt Approval', 'Approve'), async (req, res) => {
  const codes = (req.body && req.body.codes) || [];
  if (!Array.isArray(codes) || !codes.length) return res.status(400).json({ error: 'No receipts selected' });
  const result = await query(
    `UPDATE UmrahReciept SET ReceiptApproved = 'Y' WHERE RecieptCode IN (?)`,
    [codes]
  );
  res.json({ ok: true, approved: result.affectedRows });
});

module.exports = router;
