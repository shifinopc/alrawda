const express = require('express');
const { query } = require('../db');
const { ensureTable: ensureAdjustments } = require('./adjustments');

const router = express.Router();

const INVOICE_SUMMARY = (dateCol, order) => `
  SELECT i.InvoiceNo, i.InvoiceDate, i.created_at AS CreatedAt, i.CustomerName, i.Mobile1, i.DepartureDate,
         TRIM(IFNULL(i.ApprovalStatus,'Pending')) AS ApprovalStatus, i.ApprovalComments,
         (i.NetAmount + IFNULL(adj.adjAmount,0)) AS InvoiceAmount,
         IFNULL(r.received,0) AS ReceivedAmount,
         IFNULL(r.rcCount,0) AS ReceiptCount,
         IFNULL(r.rcApproved,0) AS ApprovedReceiptCount,
         IFNULL(f.refund,0) AS RefundAmount,
         IFNULL(adj.adjAmount,0) AS AdjustmentAmount,
         (IFNULL(r.received,0) - IFNULL(f.refund,0)) AS Income,
         (i.NetAmount - IFNULL(r.received,0)) AS Balance,
         CASE WHEN TRIM(IFNULL(i.CancelYesNo,'N'))='Y' THEN 'Cancelled'
              WHEN i.NetAmount - IFNULL(r.received,0) <= 0 THEN 'Paid'
              WHEN IFNULL(r.received,0) > 0 THEN 'Partially Paid'
              ELSE 'Not Paid' END AS InvoiceStatus
  FROM UmrahInvoice i
  LEFT JOIN (SELECT InvoiceCode, SUM(RecievedAmount) received, COUNT(*) AS rcCount,
                    SUM(CASE WHEN TRIM(IFNULL(ReceiptApproved,''))='Y' THEN 1 ELSE 0 END) AS rcApproved
             FROM UmrahReciept WHERE is_deleted=0 GROUP BY InvoiceCode) r
    ON r.InvoiceCode = i.InvoiceCode
  LEFT JOIN (SELECT InvoiceCode, SUM(PaymentAmount) refund FROM UmrahPayment
             WHERE TRIM(TypeOfPayment)='Refund' AND is_deleted=0 GROUP BY InvoiceCode) f
    ON f.InvoiceCode = i.InvoiceCode
  LEFT JOIN (SELECT invoice_code, SUM(amount) adjAmount FROM invoice_adjustments
             WHERE status='Approved' GROUP BY invoice_code) adj
    ON adj.invoice_code = i.InvoiceCode
  WHERE i.is_deleted = 0 AND DATE(i.${dateCol}) BETWEEN ? AND ?
  ORDER BY ${order}`;

function range(req) {
  const to = req.query.to || new Date().toLocaleDateString('en-CA');
  const from = req.query.from || to.slice(0, 8) + '01';
  return [from, to];
}

// GET /api/reports/income-summary?from=&to=
router.get('/income-summary', async (req, res) => {
  await ensureAdjustments(); // INVOICE_SUMMARY joins invoice_adjustments
  res.json({ rows: await query(INVOICE_SUMMARY('InvoiceDate', 'i.InvoiceNo'), range(req)) });
});

// GET /api/reports/departure-wise?from=&to=  (filtered + sorted by departure date)
router.get('/departure-wise', async (req, res) => {
  await ensureAdjustments();
  res.json({ rows: await query(INVOICE_SUMMARY('DepartureDate', 'i.DepartureDate, i.InvoiceNo'), range(req)) });
});

// GET /api/reports/pending?from=&to=
router.get('/pending', async (req, res) => {
  const rows = await query(
    `SELECT i.InvoiceNo, i.InvoiceDate, i.created_at AS CreatedAt, i.CustomerName, i.Mobile1,
            i.NetAmount AS InvoiceAmount, IFNULL(r.received,0) AS ReceivedAmount,
            (i.NetAmount - IFNULL(r.received,0)) AS Balance
     FROM UmrahInvoice i
     LEFT JOIN (SELECT InvoiceCode, SUM(RecievedAmount) received FROM UmrahReciept WHERE is_deleted=0 GROUP BY InvoiceCode) r
       ON r.InvoiceCode = i.InvoiceCode
     WHERE i.is_deleted = 0 AND TRIM(IFNULL(i.CancelYesNo,'N')) <> 'Y' AND DATE(i.InvoiceDate) BETWEEN ? AND ?
     HAVING Balance > 0 ORDER BY i.InvoiceNo`,
    range(req)
  );
  res.json({ rows });
});

// GET /api/reports/income-report?from=&to=  (invoice + receipt + refund detail)
router.get('/income-report', async (req, res) => {
  await ensureAdjustments();
  const [from, to] = range(req);
  const invoices = await query(INVOICE_SUMMARY('InvoiceDate', 'i.InvoiceNo'), [from, to]);
  const receipts = await query(
    `SELECT r.RecieptNo, r.RecieptDate, r.created_at AS CreatedAt, r.RecievedAmount,
            i.InvoiceNo, i.InvoiceDate, i.created_at AS InvCreatedAt
     FROM UmrahReciept r JOIN UmrahInvoice i ON i.InvoiceCode = r.InvoiceCode
     WHERE r.is_deleted = 0 AND i.is_deleted = 0 AND DATE(i.InvoiceDate) BETWEEN ? AND ? ORDER BY i.InvoiceNo, r.RecieptNo`,
    [from, to]
  );
  const refunds = await query(
    `SELECT p.PaymentNo, p.PaymentDate, p.created_at AS CreatedAt, p.PaymentAmount,
            i.InvoiceNo, i.InvoiceDate, i.created_at AS InvCreatedAt
     FROM UmrahPayment p JOIN UmrahInvoice i ON i.InvoiceCode = p.InvoiceCode
     WHERE i.is_deleted=0 AND TRIM(p.TypeOfPayment)='Refund' AND p.is_deleted=0 AND DATE(i.InvoiceDate) BETWEEN ? AND ?
     ORDER BY i.InvoiceNo, p.PaymentNo`,
    [from, to]
  );
  res.json({ invoices, receipts, refunds });
});

// GET /api/reports/agent-wise?from=&to=&agentCode=  (invoices booked through an agent)
const AGENT_SUMMARY = `
  SELECT ag.AgentName, i.InvoiceCode, i.InvoiceNo, i.InvoiceDate, i.created_at AS CreatedAt, i.CustomerName,
         (i.NetAmount + IFNULL(adj.adjAmount,0)) AS InvoiceAmount,
         IFNULL(r.received,0) AS ReceivedAmount,
         IFNULL(adj.adjAmount,0) AS AdjustmentAmount,
         IFNULL(f.refund,0) AS RefundAmount,
         (i.NetAmount - IFNULL(r.received,0)) AS Balance,
         CASE WHEN TRIM(IFNULL(i.CancelYesNo,'N'))='Y' THEN 'Cancelled'
              WHEN i.NetAmount - IFNULL(r.received,0) <= 0 THEN 'Paid'
              WHEN IFNULL(r.received,0) > 0 THEN 'Partially Paid'
              ELSE 'Not Paid' END AS InvoiceStatus
  FROM UmrahInvoice i
  JOIN agents ag ON ag.AgentCode = i.AgentCode
  LEFT JOIN (SELECT InvoiceCode, SUM(RecievedAmount) received FROM UmrahReciept WHERE is_deleted=0 GROUP BY InvoiceCode) r
    ON r.InvoiceCode = i.InvoiceCode
  LEFT JOIN (SELECT InvoiceCode, SUM(PaymentAmount) refund FROM UmrahPayment
             WHERE TRIM(TypeOfPayment)='Refund' AND is_deleted=0 GROUP BY InvoiceCode) f
    ON f.InvoiceCode = i.InvoiceCode
  LEFT JOIN (SELECT invoice_code, SUM(amount) adjAmount FROM invoice_adjustments
             WHERE status='Approved' GROUP BY invoice_code) adj
    ON adj.invoice_code = i.InvoiceCode
  WHERE i.is_deleted = 0 AND DATE(i.InvoiceDate) BETWEEN ? AND ? {AGENT}
  ORDER BY ag.AgentName, i.InvoiceNo`;

router.get('/agent-wise', async (req, res) => {
  await ensureAdjustments();
  const [from, to] = range(req);
  const params = [from, to];
  let agentSql = '';
  if (req.query.agentCode) { agentSql = 'AND i.AgentCode = ?'; params.push(req.query.agentCode); }
  const rows = await query(AGENT_SUMMARY.replace('{AGENT}', agentSql), params);
  // attach each invoice's receipts (for the "Receipt No" column)
  const codes = rows.map((r) => r.InvoiceCode);
  let receipts = [];
  if (codes.length) {
    receipts = await query(
      `SELECT InvoiceCode, RecieptNo, RecieptDate, created_at AS CreatedAt
       FROM UmrahReciept WHERE is_deleted = 0 AND InvoiceCode IN (?) ORDER BY RecieptNo`, [codes]);
  }
  const byInv = {};
  receipts.forEach((rc) => { (byInv[rc.InvoiceCode] = byInv[rc.InvoiceCode] || []).push(rc); });
  rows.forEach((r) => { r.receipts = byInv[r.InvoiceCode] || []; });
  res.json({ rows });
});

// GET /api/reports/passengers?from=&to=  (by departure date)
router.get('/passengers', async (req, res) => {
  const rows = await query(
    `SELECT i.DepartureDate, i.InvoiceNo, i.InvoiceDate, i.created_at AS CreatedAt, i.CustomerName, ps.SlNo, ps.PassengerName,
            v.VisaType
     FROM UmrahPassengers ps
     JOIN UmrahInvoice i ON i.InvoiceCode = ps.InvoiceCode
     LEFT JOIN UmrahVisaType v ON v.VisaTypeCode = ps.VisaTypeCode
     WHERE i.is_deleted = 0 AND TRIM(IFNULL(i.CancelYesNo,'N')) <> 'Y' AND DATE(i.DepartureDate) BETWEEN ? AND ?
     ORDER BY i.DepartureDate, i.InvoiceNo, ps.SlNo`,
    range(req)
  );
  res.json({ rows });
});

// GET /api/reports/expense?from=&to=
router.get('/expense', async (req, res) => {
  const rows = await query(
    `SELECT PaymentNo, PaymentDate, created_at AS CreatedAt, PaidTo, Narration, PaymentAmount
     FROM UmrahPayment
     WHERE TRIM(TypeOfPayment)='Expense' AND is_deleted=0 AND DATE(PaymentDate) BETWEEN ? AND ?
     ORDER BY PaymentNo`,
    range(req)
  );
  res.json({ rows });
});

// GET /api/reports/refund?from=&to=
router.get('/refund', async (req, res) => {
  const rows = await query(
    `SELECT p.PaymentNo, p.PaymentDate, p.created_at AS CreatedAt, i.InvoiceNo, i.InvoiceDate, i.created_at AS InvCreatedAt, i.CustomerName, p.Narration AS Reason,
            p.CollectedAmount AS PaidAmount, p.PaymentAmount AS RefundAmount,
            TRIM(IFNULL(p.IsInvoiceCancel,'N')) AS InvoiceCancelled
     FROM UmrahPayment p LEFT JOIN UmrahInvoice i ON i.InvoiceCode = p.InvoiceCode
     WHERE TRIM(p.TypeOfPayment)='Refund' AND p.is_deleted=0 AND DATE(p.PaymentDate) BETWEEN ? AND ?
     ORDER BY p.PaymentNo`,
    range(req)
  );
  res.json({ rows });
});

// GET /api/reports/adjustment?from=&to=  (invoice write-offs/adjustments, by created date)
router.get('/adjustment', async (req, res) => {
  await ensureAdjustments();
  const rows = await query(
    `SELECT a.created_at, i.InvoiceNo, i.InvoiceDate, i.created_at AS InvCreatedAt, i.CustomerName, a.reason, a.remarks,
            a.amount AS Amount, a.status, a.created_by_name, a.approved_by_name
     FROM invoice_adjustments a
     LEFT JOIN UmrahInvoice i ON i.InvoiceCode = a.invoice_code
     WHERE DATE(a.created_at) BETWEEN ? AND ?
     ORDER BY a.id DESC`,
    range(req)
  );
  res.json({ rows });
});

module.exports = router;
