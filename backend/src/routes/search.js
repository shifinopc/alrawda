const express = require('express');
const { query } = require('../db');

const router = express.Router();

// GET /api/search?q= — unified search across invoices, receipts, payments, customers
router.get('/', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ invoices: [], receipts: [], payments: [], customers: [] });
  const like = `%${q}%`;

  const invoices = await query(
    `SELECT i.InvoiceCode, i.InvoiceNo, i.InvoiceDate, i.CustomerName, i.NetAmount,
            CASE WHEN TRIM(IFNULL(i.CancelYesNo,'N'))='Y' THEN 'Cancelled'
                 WHEN i.NetAmount - IFNULL(r.received,0) <= 0 THEN 'Paid'
                 WHEN IFNULL(r.received,0) > 0 THEN 'Partially Paid'
                 ELSE 'Not Paid' END AS status
     FROM UmrahInvoice i
     LEFT JOIN (SELECT InvoiceCode, SUM(RecievedAmount) received FROM UmrahReciept WHERE is_deleted=0 GROUP BY InvoiceCode) r
       ON r.InvoiceCode = i.InvoiceCode
     WHERE i.is_deleted = 0 AND (i.InvoiceNo LIKE ? OR i.CustomerName LIKE ? OR i.Mobile1 LIKE ?)
     ORDER BY i.InvoiceCode DESC LIMIT 10`,
    [like, like, like]
  );

  const receipts = await query(
    `SELECT r.RecieptCode, r.RecieptNo, r.RecieptDate, i.CustomerName, r.RecievedAmount
     FROM UmrahReciept r LEFT JOIN UmrahInvoice i ON i.InvoiceCode = r.InvoiceCode
     WHERE r.is_deleted = 0 AND (r.RecieptNo LIKE ? OR i.CustomerName LIKE ?)
     ORDER BY r.RecieptCode DESC LIMIT 10`,
    [like, like]
  );

  const payments = await query(
    `SELECT p.PaymentCode, p.PaymentNo, p.PaymentDate, p.PaidTo, p.PaymentAmount, TRIM(p.TypeOfPayment) AS TypeOfPayment
     FROM UmrahPayment p LEFT JOIN UmrahInvoice i ON i.InvoiceCode = p.InvoiceCode
     WHERE p.is_deleted = 0 AND (p.PaymentNo LIKE ? OR p.PaidTo LIKE ? OR i.CustomerName LIKE ?)
     ORDER BY p.PaymentCode DESC LIMIT 10`,
    [like, like, like]
  );

  const customers = await query(
    `SELECT i.CustomerName, MAX(i.Mobile1) AS Mobile1, COUNT(*) AS invoices,
            (SUM(CASE WHEN TRIM(IFNULL(i.CancelYesNo,'N'))='Y' THEN 0 ELSE i.NetAmount END) - IFNULL(SUM(r.received),0)) AS balance
     FROM UmrahInvoice i
     LEFT JOIN (SELECT InvoiceCode, SUM(RecievedAmount) received FROM UmrahReciept WHERE is_deleted=0 GROUP BY InvoiceCode) r
       ON r.InvoiceCode = i.InvoiceCode
     WHERE i.is_deleted = 0 AND i.CustomerName LIKE ?
     GROUP BY i.CustomerName ORDER BY MAX(i.InvoiceCode) DESC LIMIT 10`,
    [like]
  );

  res.json({ invoices, receipts, payments, customers });
});

module.exports = router;
