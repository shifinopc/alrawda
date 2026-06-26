const express = require('express');
const { query } = require('../db');
const { requirePermission } = require('../permissions');

const router = express.Router();

// notification counts the header bell needs — cheap, and available to ANY authenticated
// user (it isn't dashboard data), so it works even for users without Dashboard access.
const SQL_UNBOOKED = `SELECT COUNT(*) AS c FROM UmrahReciept r
   WHERE r.is_deleted = 0 AND (r.ReceiptApproved IS NULL OR TRIM(r.ReceiptApproved) = '')
     AND NOT EXISTS (
       SELECT 1 FROM receipt_request_dtl d
       JOIN receipt_request rr ON rr.id = d.request_id
       WHERE d.receipt_code = r.RecieptCode AND rr.status = 'Pending' AND d.status = 'Pending')`;
const SQL_TO_APPROVE = `SELECT COUNT(*) AS c FROM UmrahInvoice
   WHERE is_deleted = 0 AND TRIM(IFNULL(ApprovalStatus,'Pending')) = 'Pending' AND TRIM(IFNULL(CancelYesNo,'N')) <> 'Y'`;

// GET /api/dashboard/counts — bell badges only (no Dashboard permission required)
router.get('/counts', async (_req, res) => {
  const [[unbooked], [toApprove]] = await Promise.all([query(SQL_UNBOOKED), query(SQL_TO_APPROVE)]);
  res.json({ unbookedReceipts: unbooked.c, invoicesToApprove: toApprove.c });
});

// GET /api/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD  (full dashboard — needs Dashboard → View)
router.get('/', requirePermission('Dashboard', 'View'), async (req, res) => {
  const to = req.query.to || new Date().toLocaleDateString('en-CA');
  const from = req.query.from || new Date(Date.now() - 29 * 86400000).toLocaleDateString('en-CA');

  const [collection] = await query(
    `SELECT IFNULL(SUM(RecievedAmount),0) AS total FROM UmrahReciept WHERE is_deleted=0 AND DATE(RecieptDate) BETWEEN ? AND ?`,
    [from, to]
  );
  const [pending] = await query(
    `SELECT IFNULL(SUM(i.NetAmount - IFNULL(r.received,0)),0) AS total
     FROM UmrahInvoice i
     LEFT JOIN (SELECT InvoiceCode, SUM(RecievedAmount) received FROM UmrahReciept WHERE is_deleted=0 GROUP BY InvoiceCode) r
       ON r.InvoiceCode = i.InvoiceCode
     WHERE i.is_deleted = 0 AND TRIM(IFNULL(i.CancelYesNo,'N')) <> 'Y' AND (i.NetAmount - IFNULL(r.received,0)) > 0`
  );
  const [unbooked] = await query(SQL_UNBOOKED);
  const [toApprove] = await query(SQL_TO_APPROVE);

  const trend = await query(
    `SELECT DATE_FORMAT(RecieptDate, '%Y-%m-%d') AS d, SUM(RecievedAmount) AS amount
     FROM UmrahReciept WHERE is_deleted=0 AND DATE(RecieptDate) BETWEEN ? AND ?
     GROUP BY DATE_FORMAT(RecieptDate, '%Y-%m-%d') ORDER BY d`,
    [from, to]
  );

  const byPackage = await query(
    `SELECT IFNULL(p.PackageName,'Other') AS name, SUM(r.RecievedAmount) AS amount
     FROM UmrahReciept r
     JOIN UmrahInvoice i ON i.InvoiceCode = r.InvoiceCode
     LEFT JOIN UmrahPackage p ON p.PackageCode = i.PackageCode
     WHERE r.is_deleted = 0 AND DATE(r.RecieptDate) BETWEEN ? AND ?
     GROUP BY IFNULL(p.PackageName,'Other') ORDER BY amount DESC LIMIT 5`,
    [from, to]
  );

  const incomeExpense = await query(
    `SELECT m, SUM(income) AS income, SUM(expense) AS expense FROM (
       SELECT DATE_FORMAT(RecieptDate,'%Y-%m') AS m, RecievedAmount AS income, 0 AS expense
       FROM UmrahReciept WHERE is_deleted=0 AND RecieptDate >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
       UNION ALL
       SELECT DATE_FORMAT(PaymentDate,'%Y-%m'), 0, PaymentAmount
       FROM UmrahPayment WHERE is_deleted=0 AND PaymentDate >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
     ) x GROUP BY m ORDER BY m`
  );

  const departures = await query(
    `SELECT DATE_FORMAT(DepartureDate, '%Y-%m-%d') AS d, SUM(IFNULL(PassengerCount,0)) AS pax
     FROM UmrahInvoice
     WHERE is_deleted = 0 AND DepartureDate >= CURDATE() AND TRIM(IFNULL(CancelYesNo,'N')) <> 'Y'
     GROUP BY DATE_FORMAT(DepartureDate, '%Y-%m-%d') ORDER BY d LIMIT 8`
  );

  const recentInvoices = await query(
    `SELECT i.InvoiceCode, i.InvoiceNo, i.InvoiceDate, i.CustomerName, i.NetAmount,
            IFNULL(r.received,0) AS received,
            CASE WHEN TRIM(IFNULL(i.CancelYesNo,'N'))='Y' THEN 'Cancelled'
                 WHEN i.NetAmount - IFNULL(r.received,0) <= 0 THEN 'Paid'
                 WHEN IFNULL(r.received,0) > 0 THEN 'Partially Paid'
                 ELSE 'Not Paid' END AS status
     FROM UmrahInvoice i
     LEFT JOIN (SELECT InvoiceCode, SUM(RecievedAmount) received FROM UmrahReciept WHERE is_deleted=0 GROUP BY InvoiceCode) r
       ON r.InvoiceCode = i.InvoiceCode
     WHERE i.is_deleted = 0
     ORDER BY i.InvoiceCode DESC LIMIT 6`
  );

  const recentReceipts = await query(
    `SELECT r.RecieptCode, r.RecieptNo, r.RecieptDate, r.RecievedAmount, i.CustomerName
     FROM UmrahReciept r LEFT JOIN UmrahInvoice i ON i.InvoiceCode = r.InvoiceCode
     WHERE r.is_deleted = 0
     ORDER BY r.RecieptCode DESC LIMIT 6`
  );

  res.json({
    kpis: {
      totalCollection: Number(collection.total),
      pendingBalance: Number(pending.total),
      unbookedReceipts: unbooked.c,
      invoicesToApprove: toApprove.c,
    },
    trend, byPackage, incomeExpense, departures, recentInvoices, recentReceipts,
    period: { from, to },
  });
});

module.exports = router;
