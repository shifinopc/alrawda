const express = require('express');
const { query, pool } = require('../db');
const { requirePermission } = require('../permissions');
const { ADMINS } = require('../middleware/auth');
const { notifyInvoiceCreated } = require('../notify');
const { invoiceTimeline } = require('../invoiceTimeline');
const { nextNumber, peekNumber } = require('../docNumber');
const { ensureTables: ensurePlanTables, getPlan, getPlanSummaries, validateLines, allocate, isStale, MAX_INSTALMENTS } = require('../paymentPlan');

const router = express.Router();
const isAdmin = (req) => ADMINS.includes(req.user?.role);

const STATUS_CASE = `CASE WHEN TRIM(IFNULL(i.CancelYesNo,'N'))='Y' THEN 'Cancelled'
  WHEN i.NetAmount - IFNULL(r.received,0) <= 0 THEN 'Paid'
  WHEN IFNULL(r.received,0) > 0 THEN 'Partially Paid'
  ELSE 'Not Paid' END`;

const LIST_SQL = `
  SELECT i.InvoiceCode, i.InvoiceNo, i.InvoiceDate, i.CustomerName, i.Mobile1, i.Mobile2,
         i.NatinalityCode, c.CountryName AS Nationality, i.PackageCode, p.PackageName,
         i.DepartureDate, i.PassengerCount, i.SeatCount, i.VisaCount, i.RoomType, i.RoomDetails,
         i.Amount, i.DiscountAmount, i.NetAmount, i.Remarks,
         TRIM(IFNULL(i.CancelYesNo,'N')) AS CancelYesNo,
         TRIM(IFNULL(i.ApprovalStatus,'Pending')) AS ApprovalStatus, i.ApprovalComments, i.ApprovedOn,
         i.created_by_name AS CreatedByName, i.created_at AS CreatedAt,
         i.AgentCode, i.ShowAgent, a.AgentName, a.MobileNo AS AgentMobile,
         IFNULL(r.received,0) AS received,
         (i.NetAmount - IFNULL(r.received,0)) AS balance,
         ${STATUS_CASE} AS status
  FROM UmrahInvoice i
  LEFT JOIN UmrahPackage p ON p.PackageCode = i.PackageCode
  LEFT JOIN AdminCountryInfo c ON c.CountryCode = i.NatinalityCode
  LEFT JOIN agents a ON a.AgentCode = i.AgentCode
  LEFT JOIN (SELECT InvoiceCode, SUM(RecievedAmount) received FROM UmrahReciept WHERE is_deleted=0 GROUP BY InvoiceCode) r
    ON r.InvoiceCode = i.InvoiceCode`;

// Fast path: a correlated "received" is evaluated only for the page's rows (uses idx_rec_invoice),
// instead of materializing the receipts aggregation for the whole table. Same output as LIST_SQL.
// Used when there is no HAVING filter on the computed columns (the common case).
const RECV = `(SELECT SUM(RecievedAmount) FROM UmrahReciept WHERE InvoiceCode = i.InvoiceCode AND is_deleted = 0)`;
const FAST_LIST_SQL = `
  SELECT i.InvoiceCode, i.InvoiceNo, i.InvoiceDate, i.CustomerName, i.Mobile1, i.Mobile2,
         i.NatinalityCode, c.CountryName AS Nationality, i.PackageCode, p.PackageName,
         i.DepartureDate, i.PassengerCount, i.SeatCount, i.VisaCount, i.RoomType, i.RoomDetails,
         i.Amount, i.DiscountAmount, i.NetAmount, i.Remarks,
         TRIM(IFNULL(i.CancelYesNo,'N')) AS CancelYesNo,
         TRIM(IFNULL(i.ApprovalStatus,'Pending')) AS ApprovalStatus, i.ApprovalComments, i.ApprovedOn,
         i.created_by_name AS CreatedByName, i.created_at AS CreatedAt,
         i.AgentCode, i.ShowAgent, a.AgentName, a.MobileNo AS AgentMobile,
         IFNULL(${RECV},0) AS received,
         (i.NetAmount - IFNULL(${RECV},0)) AS balance,
         CASE WHEN TRIM(IFNULL(i.CancelYesNo,'N'))='Y' THEN 'Cancelled'
              WHEN i.NetAmount - IFNULL(${RECV},0) <= 0 THEN 'Paid'
              WHEN IFNULL(${RECV},0) > 0 THEN 'Partially Paid'
              ELSE 'Not Paid' END AS status
  FROM UmrahInvoice i
  LEFT JOIN UmrahPackage p ON p.PackageCode = i.PackageCode
  LEFT JOIN AdminCountryInfo c ON c.CountryCode = i.NatinalityCode
  LEFT JOIN agents a ON a.AgentCode = i.AgentCode`;

// GET /api/invoices?invNo=&date=&customer=&status=&pendingOnly=&page=&pageSize=
router.get('/', async (req, res) => {
  const { invNo, date, customer, status, pendingOnly } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Number(req.query.pageSize) || 50);
  const where = [`i.is_deleted = ${req.query.deleted === '1' ? 1 : 0}`], params = [];
  if (invNo) {
    if (req.query.invNoMode === 'equals') { where.push('i.InvoiceNo = ?'); params.push(invNo); }
    else { where.push('i.InvoiceNo LIKE ?'); params.push(`%${invNo}%`); }
  }
  if (date) { where.push('DATE(i.InvoiceDate) = ?'); params.push(date); }
  if (req.query.from) { where.push('DATE(i.InvoiceDate) >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('DATE(i.InvoiceDate) <= ?'); params.push(req.query.to); }
  if (customer) { where.push('i.CustomerName LIKE ?'); params.push(`%${customer}%`); }
  if (req.query.approved === '1') where.push(`TRIM(IFNULL(i.ApprovalStatus,'Pending')) = 'Approved'`);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const having = [], havingParams = [];
  if (status) { having.push('status = ?'); havingParams.push(status); }
  if (pendingOnly === '1') having.push(`balance > 0 AND CancelYesNo <> 'Y'`);
  const havingSql = having.length ? `HAVING ${having.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;
  let rows, total;
  if (!having.length) {
    // fast path: page the invoice codes from the base table (indexed), then fetch full
    // details (joins + correlated received) for only those rows; count over the base table.
    const codeRows = await query(
      `SELECT i.InvoiceCode FROM UmrahInvoice i ${whereSql} ORDER BY i.InvoiceCode DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const codes = codeRows.map((r) => r.InvoiceCode);
    rows = codes.length
      ? await query(`${FAST_LIST_SQL} WHERE i.InvoiceCode IN (?) ORDER BY i.InvoiceCode DESC`, [codes])
      : [];
    const [c] = await query(`SELECT COUNT(*) AS total FROM UmrahInvoice i ${whereSql}`, params);
    total = c.total;
  } else {
    // filtered by computed status/balance → need the aggregation for the whole set
    rows = await query(
      `${LIST_SQL} ${whereSql} ${havingSql} ORDER BY i.InvoiceCode DESC LIMIT ? OFFSET ?`,
      [...params, ...havingParams, pageSize, offset]
    );
    const [c] = await query(`SELECT COUNT(*) AS total FROM (${LIST_SQL} ${whereSql} ${havingSql}) x`,
      [...params, ...havingParams]);
    total = c.total;
  }
  // plan badges for this page only (one extra query, no join on the hot list path)
  const plans = await getPlanSummaries(rows.map((r) => r.InvoiceCode));
  res.json({ rows, page, pageSize, total, plans });
});

// GET /api/invoices/next-no
router.get('/next-no', async (_req, res) => {
  res.json({ next: await peekNumber('invoice') });
});

// GET /api/invoices/:code  (full detail with passengers + receipts + refunds)
router.get('/:code', async (req, res) => {
  // correlated received for a single row — avoids materializing the whole receipts aggregation
  const rows = await query(`${FAST_LIST_SQL} WHERE i.InvoiceCode = ?`, [req.params.code]);
  if (!rows.length) return res.status(404).json({ error: 'Invoice not found' });
  const invoice = rows[0];
  const passengers = await query(
    `SELECT ps.SlNo, ps.PassengerName, ps.VisaTypeCode, v.VisaType, ps.VisaRequiredCode
     FROM UmrahPassengers ps LEFT JOIN UmrahVisaType v ON v.VisaTypeCode = ps.VisaTypeCode
     WHERE ps.InvoiceCode = ? ORDER BY ps.SlNo`,
    [req.params.code]
  );
  const receipts = await query(
    `SELECT RecieptCode, RecieptNo, RecieptDate, RecievedAmount, PreBalanceAmount,
            CurrentBalanceAmount, TRIM(IFNULL(PaymentMode,'Cash')) AS PaymentMode, Bank, ChequeNo, ReceiptApproved
     FROM UmrahReciept WHERE InvoiceCode = ? AND is_deleted = 0 ORDER BY RecieptCode`,
    [req.params.code]
  );
  const refunds = await query(
    `SELECT PaymentCode, PaymentNo, PaymentDate, PaymentAmount, Narration
     FROM UmrahPayment WHERE InvoiceCode = ? AND TRIM(TypeOfPayment) = 'Refund' AND is_deleted=0 ORDER BY PaymentCode`,
    [req.params.code]
  );
  const plan = await getPlan(req.params.code);
  res.json({ invoice, passengers, receipts, refunds, plan });
});

// GET /api/invoices/:code/history — full chronological timeline (shared builder in invoiceTimeline.js)
router.get('/:code/history', async (req, res) => {
  const result = await invoiceTimeline(req.params.code);
  if (!result) return res.status(404).json({ error: 'Invoice not found' });
  res.json(result);
});

function invoiceParams(b) {
  return {
    InvoiceDate: b.invoiceDate || new Date().toLocaleDateString('en-CA'),
    CustomerName: b.customerName || '',
    NatinalityCode: b.nationalityCode || null,
    Mobile1: b.mobile1 || null,
    Mobile2: b.mobile2 || null,
    PackageCode: b.packageCode || 0, // legacy convention: 0 = no package (column is NOT NULL)
    DepartureDate: b.departureDate || null,
    PassengerCount: b.passengerCount || 0,
    SeatCount: b.seatCount || 0,
    VisaCount: b.visaCount || 0,
    RoomType: b.roomType || 'Normal',
    RoomDetails: b.roomDetails || null,
    Amount: b.amount || 0,
    DiscountAmount: b.discountAmount || 0,
    NetAmount: b.netAmount != null ? b.netAmount : (Number(b.amount || 0) - Number(b.discountAmount || 0)),
    Remarks: b.remarks || null,
    AgentCode: b.agentCode || null, // optional booking agent
    ShowAgent: b.showAgent ? 1 : 0, // per-invoice: print the agent name only when ticked
  };
}

/* UmrahPassengers.VisaTypeCode is NOT NULL, so an unpicked visa type can only ever
   fail at the insert — catch it here and name the row instead of returning a 500. */
function badPassenger(passengers) {
  let n = 0;
  for (const p of passengers || []) {
    if (!p.passengerName || !String(p.passengerName).trim()) continue;
    n += 1;
    if (!Number(p.visaTypeCode)) return `Passenger ${n} (${String(p.passengerName).trim()}): pick a visa type.`;
  }
  return null;
}

async function replacePassengers(conn, invoiceCode, passengers) {
  await conn.query('DELETE FROM UmrahPassengers WHERE InvoiceCode = ?', [invoiceCode]);
  let sl = 1;
  for (const p of passengers || []) {
    const name = String(p.passengerName || '').trim();
    if (!name) continue; // same blank-row rule as badPassenger(), or its skip lets a null through
    await conn.query(
      `INSERT INTO UmrahPassengers (InvoiceCode, SlNo, PassengerName, VisaTypeCode, VisaRequiredCode)
       VALUES (?,?,?,?,?)`,
      [invoiceCode, sl++, name, p.visaTypeCode || null, Number(p.visaRequiredCode) === 2 ? 2 : 1] // VisaRequiredTable: 1=Yes, 2=No
    );
  }
}

// POST /api/invoices
router.post('/', requirePermission('Invoice', 'Create'), async (req, res) => {
  const b = req.body || {};
  if (!b.customerName) return res.status(400).json({ error: 'Customer name is required' });
  const paxErr = badPassenger(b.passengers);
  if (paxErr) return res.status(400).json({ error: paxErr });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const p = invoiceParams(b);
    if (!(Number(p.NetAmount) > 0)) {
      await conn.rollback();
      return res.status(400).json({ error: 'Net amount must be greater than zero' });
    }
    const nextNo = await nextNumber(conn, 'invoice', p.InvoiceDate);
    const [result] = await conn.query(
      `INSERT INTO UmrahInvoice (InvoiceNo, InvoiceDate, CustomerName, NatinalityCode, Mobile1, Mobile2,
        PackageCode, DepartureDate, PassengerCount, SeatCount, VisaCount, RoomType, RoomDetails,
        Amount, DiscountAmount, NetAmount, Remarks, AgentCode, ShowAgent, CancelYesNo, ApprovalStatus,
        created_by, created_by_name, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'N','Pending',?,?,NOW())`,
      [nextNo, p.InvoiceDate, p.CustomerName, p.NatinalityCode, p.Mobile1, p.Mobile2,
       p.PackageCode, p.DepartureDate, p.PassengerCount, p.SeatCount, p.VisaCount, p.RoomType, p.RoomDetails,
       p.Amount, p.DiscountAmount, p.NetAmount, p.Remarks, p.AgentCode, p.ShowAgent,
       req.user?.id ?? null, req.user?.name ?? null]
    );
    const invoiceCode = result.insertId;
    await replacePassengers(conn, invoiceCode, b.passengers);
    await conn.commit();
    notifyInvoiceCreated(invoiceCode); // fire-and-forget email to management
    res.status(201).json({ invoiceCode, invoiceNo: nextNo });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

// PUT /api/invoices/:code
router.put('/:code', requirePermission('Invoice', 'Edit'), async (req, res) => {
  const b = req.body || {};
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[cur]] = await conn.query(
      `SELECT TRIM(IFNULL(ApprovalStatus,'Pending')) AS st,
              IFNULL((SELECT SUM(RecievedAmount) FROM UmrahReciept WHERE InvoiceCode=? AND is_deleted=0),0) AS received
       FROM UmrahInvoice WHERE InvoiceCode=? FOR UPDATE`,
      [req.params.code, req.params.code]
    );
    if (!cur) { await conn.rollback(); return res.status(404).json({ error: 'Invoice not found' }); }
    if (cur.st === 'Approved' && !isAdmin(req)) {
      await conn.rollback();
      return res.status(403).json({ error: 'This invoice is approved and locked. Ask an administrator to edit it.' });
    }
    const p = invoiceParams(b);
    const paxErr = badPassenger(b.passengers);
    if (paxErr) {
      await conn.rollback();
      return res.status(400).json({ error: paxErr });
    }
    if (!(Number(p.NetAmount) > 0)) {
      await conn.rollback();
      return res.status(400).json({ error: 'Net amount must be greater than zero' });
    }
    if (Number(p.NetAmount) < Number(cur.received)) {
      await conn.rollback();
      return res.status(400).json({ error: `Net amount (QAR ${Number(p.NetAmount).toLocaleString()}) cannot be less than the amount already received (QAR ${Number(cur.received).toLocaleString()})` });
    }
    const [result] = await conn.query(
      `UPDATE UmrahInvoice SET InvoiceDate=?, CustomerName=?, NatinalityCode=?, Mobile1=?, Mobile2=?,
        PackageCode=?, DepartureDate=?, PassengerCount=?, SeatCount=?, VisaCount=?, RoomType=?, RoomDetails=?,
        Amount=?, DiscountAmount=?, NetAmount=?, Remarks=?, AgentCode=?, ShowAgent=?
       WHERE InvoiceCode = ?`,
      [p.InvoiceDate, p.CustomerName, p.NatinalityCode, p.Mobile1, p.Mobile2,
       p.PackageCode, p.DepartureDate, p.PassengerCount, p.SeatCount, p.VisaCount, p.RoomType, p.RoomDetails,
       p.Amount, p.DiscountAmount, p.NetAmount, p.Remarks, p.AgentCode, p.ShowAgent, req.params.code]
    );
    if (!result.affectedRows) { await conn.rollback(); return res.status(404).json({ error: 'Invoice not found' }); }
    if (b.passengers) await replacePassengers(conn, req.params.code, b.passengers);
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

// POST /api/invoices/:code/approve   { status: 'Approved'|'Pending', comments }
router.post('/:code/approve', requirePermission('Invoice', 'Approve'), async (req, res) => {
  const { status = 'Approved', comments = null } = req.body || {};
  if (!['Approved', 'Pending'].includes(status)) {
    return res.status(400).json({ error: 'Status must be Approved or Pending' });
  }
  const result = await query(
    `UPDATE UmrahInvoice SET ApprovalStatus=?, ApprovalComments=?, ApprovedBy=?, ApprovedOn=NOW() WHERE InvoiceCode=?`,
    [status, comments, req.user.id, req.params.code]
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Invoice not found' });
  res.json({ ok: true });
});

// POST /api/invoices/:code/cancel
router.post('/:code/cancel', requirePermission('Invoice', 'Approve'), async (req, res) => {
  const result = await query(`UPDATE UmrahInvoice SET CancelYesNo='Y' WHERE InvoiceCode=?`, [req.params.code]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Invoice not found' });
  res.json({ ok: true });
});

// DELETE /api/invoices/:code — soft delete (recycle bin). Blocked if it still has receipts.
router.delete('/:code', requirePermission('Invoice', 'Delete'), async (req, res) => {
  const [inv] = await query(
    `SELECT TRIM(IFNULL(ApprovalStatus,'Pending')) AS st,
            (SELECT COUNT(*) FROM UmrahReciept WHERE InvoiceCode=? AND is_deleted=0) AS receipts
     FROM UmrahInvoice WHERE InvoiceCode=? AND is_deleted=0`, [req.params.code, req.params.code]);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (Number(inv.receipts) > 0) {
    return res.status(400).json({ error: 'This invoice has receipts. Remove (recycle) those receipts first.' });
  }
  if (inv.st === 'Approved' && !isAdmin(req)) {
    return res.status(403).json({ error: 'This invoice is approved and locked. Ask an administrator to remove it.' });
  }
  await query(
    `UPDATE UmrahInvoice SET is_deleted=1, deleted_at=NOW(), deleted_by_name=? WHERE InvoiceCode=? AND is_deleted=0`,
    [req.user?.name ?? null, req.params.code]);
  res.json({ ok: true });
});

// POST /api/invoices/:code/restore — bring back from recycle bin
router.post('/:code/restore', requirePermission('Invoice', 'Delete'), async (req, res) => {
  const result = await query(
    `UPDATE UmrahInvoice SET is_deleted=0, deleted_at=NULL, deleted_by_name=NULL WHERE InvoiceCode=? AND is_deleted=1`,
    [req.params.code]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Deleted invoice not found' });
  res.json({ ok: true });
});

/* ------------------------- instalment (EMI) plans ------------------------- *
 * The schedule only. No money is written here — see src/paymentPlan.js.
 * -------------------------------------------------------------------------- */

// GET /api/invoices/:code/plan — the active plan with each instalment's state, or null
router.get('/:code/plan', async (req, res) => {
  res.json({ plan: await getPlan(req.params.code) });
});

// POST /api/invoices/:code/plan   { lines: [{ dueDate, amount }, …] }
router.post('/:code/plan', requirePermission('Invoice', 'Edit'), async (req, res) => {
  await ensurePlanTables();
  const lines = (req.body?.lines || []).map((l) => ({ dueDate: String(l.dueDate || ''), amount: Number(l.amount) }));
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // lock the invoice so the balance can't move between validating and writing
    const [[inv]] = await conn.query(
      `SELECT InvoiceCode, NetAmount, DATE(InvoiceDate) AS InvoiceDate, DATE(DepartureDate) AS DepartureDate,
              TRIM(IFNULL(CancelYesNo,'N')) AS CancelYesNo,
              TRIM(IFNULL(ApprovalStatus,'Pending')) AS ApprovalStatus
       FROM UmrahInvoice WHERE InvoiceCode=? AND is_deleted=0 FOR UPDATE`, [req.params.code]);
    if (!inv) { await conn.rollback(); return res.status(404).json({ error: 'Invoice not found' }); }
    if (inv.CancelYesNo === 'Y') { await conn.rollback(); return res.status(400).json({ error: 'This invoice is cancelled.' }); }
    if (inv.ApprovalStatus !== 'Approved') {
      await conn.rollback();
      return res.status(400).json({ error: 'Approve the invoice before setting up a payment plan.' });
    }
    const [[act]] = await conn.query(
      `SELECT invoice_code FROM payment_plan WHERE invoice_code=? AND status='Active'`, [req.params.code]);
    if (act) { await conn.rollback(); return res.status(400).json({ error: 'This invoice already has a payment plan. Cancel it first.' }); }

    const [[sum]] = await conn.query(
      `SELECT IFNULL(SUM(RecievedAmount),0) AS received FROM UmrahReciept WHERE InvoiceCode=? AND is_deleted=0`,
      [req.params.code]);
    const received = Number(sum.received);
    const balance = Number(inv.NetAmount) - received;
    if (!(balance > 0)) { await conn.rollback(); return res.status(400).json({ error: 'This invoice has nothing left to pay.' }); }

    const bad = validateLines(lines, balance, inv.InvoiceDate);
    if (bad) { await conn.rollback(); return res.status(400).json({ error: bad }); }

    await conn.query(
      `INSERT INTO payment_plan (invoice_code, opening_paid, planned_amount, net_at_creation, status, created_by, created_by_name)
       VALUES (?,?,?,?, 'Active', ?, ?)
       ON DUPLICATE KEY UPDATE opening_paid=VALUES(opening_paid), planned_amount=VALUES(planned_amount),
         net_at_creation=VALUES(net_at_creation), status='Active', created_by=VALUES(created_by),
         created_by_name=VALUES(created_by_name), created_at=NOW(), cancelled_by_name=NULL, cancelled_at=NULL`,
      [req.params.code, received, balance, inv.NetAmount, req.user?.id ?? null, req.user?.name ?? null]);
    await conn.query(`DELETE FROM payment_plan_dtl WHERE invoice_code=?`, [req.params.code]);
    await conn.query(
      `INSERT INTO payment_plan_dtl (invoice_code, seq, due_date, amount) VALUES ?`,
      [lines.map((l, i) => [req.params.code, i + 1, l.dueDate, l.amount])]);
    await conn.commit();

    const lastDue = lines[lines.length - 1].dueDate;
    res.json({
      ok: true,
      // not an error: the office may knowingly schedule past the flight
      warning: inv.DepartureDate && lastDue > inv.DepartureDate
        ? `The last instalment (${lastDue}) falls after the departure date (${inv.DepartureDate}).` : null,
    });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

// PUT /api/invoices/:code/plan   { lines: [{ dueDate, amount }, …] }
// Reschedules the instalments that are NOT yet settled. Rows already covered by
// receipts are untouched, so a customer who has paid two months keeps those two
// on the schedule and only the rest moves.
router.put('/:code/plan', requirePermission('Invoice', 'Edit'), async (req, res) => {
  await ensurePlanTables();
  const tail = (req.body?.lines || []).map((l) => ({ dueDate: String(l.dueDate || ''), amount: Number(l.amount) }));
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[inv]] = await conn.query(
      `SELECT NetAmount, DATE(DepartureDate) AS DepartureDate, TRIM(IFNULL(CancelYesNo,'N')) AS CancelYesNo
       FROM UmrahInvoice WHERE InvoiceCode=? AND is_deleted=0 FOR UPDATE`, [req.params.code]);
    if (!inv) { await conn.rollback(); return res.status(404).json({ error: 'Invoice not found' }); }
    if (inv.CancelYesNo === 'Y') { await conn.rollback(); return res.status(400).json({ error: 'This invoice is cancelled.' }); }

    const [[plan]] = await conn.query(
      `SELECT opening_paid, planned_amount FROM payment_plan WHERE invoice_code=? AND status='Active'`, [req.params.code]);
    if (!plan) { await conn.rollback(); return res.status(404).json({ error: 'No active payment plan on this invoice' }); }

    const [[sum]] = await conn.query(
      `SELECT IFNULL(SUM(RecievedAmount),0) AS received FROM UmrahReciept WHERE InvoiceCode=? AND is_deleted=0`,
      [req.params.code]);
    const received = Number(sum.received);
    const planned = Number(plan.planned_amount);
    if (isStale(planned, Number(inv.NetAmount) - received, Math.max(0, received - Number(plan.opening_paid)))) {
      await conn.rollback();
      return res.status(400).json({ error: 'This invoice changed after the plan was made. Cancel the plan and issue a new one.' });
    }

    const [rows] = await conn.query(
      `SELECT seq, DATE_FORMAT(due_date,'%Y-%m-%d') AS due_date, amount FROM payment_plan_dtl
       WHERE invoice_code=? ORDER BY seq`, [req.params.code]);
    const current = allocate(rows, Math.max(0, received - Number(plan.opening_paid)));
    const settled = current.filter((i) => i.status === 'Paid');   // fully covered — these stay put
    const settledTotal = settled.reduce((t, i) => t + i.amount, 0);

    if (!tail.length) { await conn.rollback(); return res.status(400).json({ error: 'Keep at least one instalment to reschedule.' }); }
    if (settled.length + tail.length > MAX_INSTALMENTS) {
      await conn.rollback();
      return res.status(400).json({ error: `A plan cannot have more than ${MAX_INSTALMENTS} instalments.` });
    }
    // the rescheduled rows must still add up to whatever the plan has left to collect
    const lastSettledDate = settled.length ? settled[settled.length - 1].dueDate : null;
    const bad = validateLines(tail, planned - settledTotal, lastSettledDate || null);
    if (bad) { await conn.rollback(); return res.status(400).json({ error: bad }); }
    if (lastSettledDate && tail[0].dueDate <= lastSettledDate) {
      await conn.rollback();
      return res.status(400).json({ error: `The first rescheduled instalment must fall after ${lastSettledDate}, the last one already paid.` });
    }

    await conn.query(`DELETE FROM payment_plan_dtl WHERE invoice_code=? AND seq > ?`,
      [req.params.code, settled.length]);
    await conn.query(`INSERT INTO payment_plan_dtl (invoice_code, seq, due_date, amount) VALUES ?`,
      [tail.map((l, i) => [req.params.code, settled.length + i + 1, l.dueDate, l.amount])]);
    await conn.commit();

    const lastDue = tail[tail.length - 1].dueDate;
    res.json({
      ok: true, kept: settled.length, rescheduled: tail.length,
      warning: inv.DepartureDate && lastDue > inv.DepartureDate
        ? `The last instalment (${lastDue}) falls after the departure date (${inv.DepartureDate}).` : null,
    });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

// DELETE /api/invoices/:code/plan — cancel (the row is kept for the audit trail)
router.delete('/:code/plan', requirePermission('Invoice', 'Edit'), async (req, res) => {
  await ensurePlanTables();
  const result = await query(
    `UPDATE payment_plan SET status='Cancelled', cancelled_by_name=?, cancelled_at=NOW()
     WHERE invoice_code=? AND status='Active'`, [req.user?.name ?? null, req.params.code]);
  if (!result.affectedRows) return res.status(404).json({ error: 'No active payment plan on this invoice' });
  res.json({ ok: true });
});

// NOTE: invoice adjustments now go through the Draft→Approve flow in routes/adjustments.js
// (POST /api/adjustments → approve). The old immediate-apply endpoint was removed so
// adjustments can't bypass approval.

module.exports = router;
