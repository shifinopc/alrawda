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

/* ---------- PDF export (server-rendered, with "Page X of Y" footer) ----------
   The frontend already formats every cell (doc-number prefixes, money, badges, agent
   merges) so it POSTs the display-ready table; we just wrap it in a branded, paginated
   PDF. Body: { title, from, to, landscape, sections:[{title,columns:[{label,num}],rows:[[..]],totals:[..]|null}] } */
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function reportHeader() {
  let pt = {};
  try { const rows = await query("SELECT v FROM app_settings WHERE k = 'printTemplate'"); if (rows.length) pt = JSON.parse(rows[0].v) || {}; } catch { /* defaults */ }
  return {
    name: (pt.headerLine1 || 'AL RAWDA GROUP').trim(),
    ar: (pt.headerLine2 || '').trim(),
    contact: (pt.headerContact || '').trim(),
    address: (pt.headerContact2 || '').trim(),
    logo: pt.logoImage || null,
  };
}

function reportHtml({ title, from, to, sections, header }) {
  const tbl = (s) => {
    const cols = s.columns || [];
    const head = `<tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr>`;
    const body = (s.rows || []).map((r) =>
      `<tr>${r.map((cell, i) => `<td class="${cols[i] && cols[i].num ? 'num' : ''}">${esc(cell)}</td>`).join('')}</tr>`).join('');
    const tot = s.totals
      ? `<tr class="tot">${s.totals.map((cell, i) => `<td class="${cols[i] && cols[i].num ? 'num' : ''}">${esc(cell)}</td>`).join('')}</tr>` : '';
    return `${s.title ? `<div class="sec">${esc(s.title)}</div>` : ''}<table><thead>${head}</thead><tbody>${body}${tot}</tbody></table>`;
  };
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}
    body{font-family:Arial,'Segoe UI',sans-serif;margin:0;color:#222}
    .hdr{text-align:center;border-bottom:2px solid #8a1538;padding-bottom:7px;margin-bottom:8px}
    .hdr img{height:42px;margin-bottom:3px}
    .hdr .ar{color:#8a1538;font-size:14px;font-weight:bold}
    .hdr .en{color:#8a1538;font-size:15px;font-weight:bold}
    .hdr .c{font-size:10px;color:#444}
    .rtitle{display:flex;justify-content:space-between;align-items:center;margin:4px 0 8px}
    .rtitle h2{color:#8a1538;font-size:15px;margin:0}
    .rtitle .range{border:1px solid #8a1538;border-radius:20px;padding:2px 10px;font-size:11px;color:#8a1538}
    table{width:100%;border-collapse:collapse;font-size:10px;margin-bottom:10px}
    thead{display:table-header-group}
    th{background:#8a1538;color:#fff;padding:5px 6px;text-align:left;font-size:11px}
    td{padding:4px 6px;border-bottom:1px solid #e6e6e6}
    .num{text-align:right;font-variant-numeric:tabular-nums}
    tbody tr:nth-child(even){background:#f7f6f9}
    tr.tot td{font-weight:bold;border-top:2px solid #8a1538;background:#fff}
    .sec{font-weight:bold;color:#8a1538;margin:8px 0 4px;font-size:12px}
  </style></head><body>
    <div class="hdr">
      ${header.logo ? `<img src="${header.logo}"/>` : ''}
      ${header.ar ? `<div class="ar">${esc(header.ar)}</div>` : ''}
      <div class="en">${esc(header.name)}</div>
      ${header.contact ? `<div class="c">${esc(header.contact)}</div>` : ''}
      ${header.address ? `<div class="c">${esc(header.address)}</div>` : ''}
    </div>
    <div class="rtitle"><h2>${esc(title)}</h2>${from ? `<span class="range">${esc(from)} — ${esc(to)}</span>` : ''}</div>
    ${(sections || []).map(tbl).join('')}
  </body></html>`;
}

// POST /api/reports/pdf
router.post('/pdf', async (req, res) => {
  const { renderReportPdf } = require('../pdf');
  const b = req.body || {};
  const header = await reportHeader();
  const html = reportHtml({ title: b.title || 'Report', from: b.from, to: b.to, sections: b.sections || [], header });
  try {
    const pdf = Buffer.from(await renderReportPdf(html, { landscape: b.landscape !== false }));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${(b.title || 'report').replace(/[^\w-]+/g, '_')}.pdf"`);
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf);
  } catch (e) {
    res.status(500).json({ error: `PDF generation failed: ${e.message}` });
  }
});

module.exports = router;
