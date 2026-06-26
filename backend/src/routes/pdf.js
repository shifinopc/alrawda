const express = require('express');
const { buildReceiptPdf, buildPaymentPdf, buildInvoicePdf } = require('../pdf');

const router = express.Router();

function send(res, doc) {
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${doc.name}"`);
  res.setHeader('Content-Length', doc.buffer.length);
  res.end(doc.buffer);
}

// paper = a5 (default) | a4
const paperOf = (req) => (req.query.paper === 'a4' ? 'a4' : 'a5');

router.get('/receipt/:code', async (req, res) => send(res, await buildReceiptPdf(req.params.code, paperOf(req))));
router.get('/payment/:code', async (req, res) => send(res, await buildPaymentPdf(req.params.code, paperOf(req))));
router.get('/invoice/:code', async (req, res) => send(res, await buildInvoicePdf(req.params.code, paperOf(req))));

module.exports = router;
