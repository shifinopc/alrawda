const express = require('express');
const { query } = require('../db');

const router = express.Router();

// GET /api/customers?q=&status=&page=&pageSize= — distinct customers with totals + payment status
//   status: 'notpaid' | 'partial' | 'paid' | 'pending' (partial+notpaid)
const STATUS_HAVING = {
  notpaid: 'totalReceived = 0 AND totalInvoiced > 0',
  partial: 'totalReceived > 0 AND balance > 0',
  paid: 'balance <= 0 AND totalInvoiced > 0',
  pending: 'balance > 0',
};

router.get('/', async (req, res) => {
  const q = (req.query.q || '').trim();
  const status = req.query.status;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Number(req.query.pageSize) || 50);
  const like = `%${q}%`;
  const whereParams = q ? [like] : [];
  const whereSql = `WHERE i.is_deleted = 0 AND i.CustomerName <> '' ${q ? 'AND i.CustomerName LIKE ?' : ''}`;
  const havingSql = STATUS_HAVING[status] ? `HAVING ${STATUS_HAVING[status]}` : '';

  const SELECT = `
    SELECT i.CustomerName,
           MAX(i.Mobile1) AS Mobile1,
           COUNT(*) AS invoices,
           SUM(CASE WHEN TRIM(IFNULL(i.CancelYesNo,'N'))='Y' THEN 0 ELSE i.NetAmount END) AS totalInvoiced,
           IFNULL(SUM(r.received),0) AS totalReceived,
           (SUM(CASE WHEN TRIM(IFNULL(i.CancelYesNo,'N'))='Y' THEN 0 ELSE i.NetAmount END) - IFNULL(SUM(r.received),0)) AS balance,
           MAX(i.InvoiceDate) AS lastInvoice
    FROM UmrahInvoice i
    LEFT JOIN (SELECT InvoiceCode, SUM(RecievedAmount) received FROM UmrahReciept WHERE is_deleted=0 GROUP BY InvoiceCode) r
      ON r.InvoiceCode = i.InvoiceCode
    ${whereSql}
    GROUP BY i.CustomerName`;

  const rows = await query(
    `${SELECT} ${havingSql} ORDER BY balance DESC, MAX(i.InvoiceCode) DESC LIMIT ? OFFSET ?`,
    [...whereParams, pageSize, (page - 1) * pageSize]
  );
  for (const c of rows) {
    c.status = Number(c.balance) <= 0 ? 'Paid' : Number(c.totalReceived) > 0 ? 'Partially Paid' : 'Not Paid';
  }
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM (${SELECT} ${havingSql}) x`, whereParams);
  res.json({ rows, page, pageSize, total });
});

// GET /api/customers/ledger?name=  — full statement for one customer
router.get('/ledger', async (req, res) => {
  const name = req.query.name;
  if (!name) return res.status(400).json({ error: 'Customer name is required' });

  const invoices = await query(
    `SELECT i.InvoiceCode, i.InvoiceNo, i.InvoiceDate, i.DepartureDate, p.PackageName,
            i.NetAmount, IFNULL(r.received,0) AS received,
            (i.NetAmount - IFNULL(r.received,0)) AS balance,
            TRIM(IFNULL(i.CancelYesNo,'N')) AS CancelYesNo,
            CASE WHEN TRIM(IFNULL(i.CancelYesNo,'N'))='Y' THEN 'Cancelled'
                 WHEN i.NetAmount - IFNULL(r.received,0) <= 0 THEN 'Paid'
                 WHEN IFNULL(r.received,0) > 0 THEN 'Partially Paid'
                 ELSE 'Not Paid' END AS status
     FROM UmrahInvoice i
     LEFT JOIN UmrahPackage p ON p.PackageCode = i.PackageCode
     LEFT JOIN (SELECT InvoiceCode, SUM(RecievedAmount) received FROM UmrahReciept WHERE is_deleted=0 GROUP BY InvoiceCode) r
       ON r.InvoiceCode = i.InvoiceCode
     WHERE i.CustomerName = ? AND i.is_deleted = 0 ORDER BY i.InvoiceCode DESC`,
    [name]
  );
  const receipts = await query(
    `SELECT r.RecieptNo, r.RecieptDate, r.RecievedAmount, TRIM(IFNULL(r.PaymentMode,'Cash')) AS PaymentMode, i.InvoiceNo
     FROM UmrahReciept r JOIN UmrahInvoice i ON i.InvoiceCode = r.InvoiceCode
     WHERE i.CustomerName = ? AND r.is_deleted = 0 AND i.is_deleted = 0 ORDER BY r.RecieptCode DESC`,
    [name]
  );
  const refunds = await query(
    `SELECT p.PaymentNo, p.PaymentDate, p.PaymentAmount, i.InvoiceNo
     FROM UmrahPayment p JOIN UmrahInvoice i ON i.InvoiceCode = p.InvoiceCode
     WHERE i.CustomerName = ? AND i.is_deleted=0 AND TRIM(p.TypeOfPayment)='Refund' AND p.is_deleted=0
     ORDER BY p.PaymentCode DESC`,
    [name]
  );
  const totalInvoiced = invoices.filter((x) => x.CancelYesNo !== 'Y').reduce((s, x) => s + Number(x.NetAmount || 0), 0);
  const totalReceived = receipts.reduce((s, x) => s + Number(x.RecievedAmount || 0), 0);
  const totalRefunded = refunds.reduce((s, x) => s + Number(x.PaymentAmount || 0), 0);
  res.json({
    customer: name,
    mobile: invoices[0]?.Mobile1 || receipts[0]?.Mobile1 || null,
    summary: {
      totalInvoiced,
      totalReceived,
      totalRefunded,
      balance: totalInvoiced - totalReceived,
      invoiceCount: invoices.length,
    },
    invoices, receipts, refunds,
  });
});

module.exports = router;
