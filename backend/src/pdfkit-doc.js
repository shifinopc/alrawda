const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { format: fmtDocNo } = require('./docNumber');

/* Browser-free voucher renderer (fallback for hosts without Chrome).
   English-only: PDFKit can't shape Arabic/RTL, so Arabic labels/footers are omitted. */

const ACCENT = '#8a1538';
// font scale — bumped to >1 for the invoice (bigger fonts) and reset to 1 for others
let FS = 1;
const sz = (n) => n * FS;
const money = (v) => Number(v ?? 0).toLocaleString('en-QA', { maximumFractionDigits: 2 });
const fdate = (v) => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }); };

let LOGO;
function logoBuf() {
  if (LOGO !== undefined) return LOGO;
  const candidates = [
    process.env.LOGO_PATH,
    path.join(__dirname, '..', 'assets', 'alrawda-logo.jpg'),
    path.join(__dirname, '..', '..', 'frontend', 'public', 'alrawda-logo.jpg'),
    path.join(__dirname, '..', '..', 'frontend', 'dist', 'alrawda-logo.jpg'),
  ].filter(Boolean);
  for (const p of candidates) { try { LOGO = fs.readFileSync(p); return LOGO; } catch { /* next */ } }
  LOGO = null; return LOGO;
}

function run(paper, build) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: paper === 'a4' ? 'A4' : 'A5', margin: 26 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try { build(doc); doc.end(); } catch (e) { reject(e); }
  });
}

const LEFT = (doc) => doc.page.margins.left;
const WIDTH = (doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right;

function header(doc, t) {
  const top = doc.y;
  const logo = t.showLogo !== false ? logoBuf() : null;
  let tx = LEFT(doc);
  if (logo) { try { doc.image(logo, LEFT(doc), top, { width: 44, height: 44 }); tx += 54; } catch { /* ignore */ } }
  const w = doc.page.width - doc.page.margins.right - tx;
  doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(sz(12.5)).text(t.headerLine1 || 'AL RAWDA GROUP HAJJ & UMRAH SERVICES', tx, top, { width: w });
  doc.fillColor('#555').font('Helvetica').fontSize(sz(7.5));
  if (t.headerContact) doc.text(t.headerContact, { width: w });
  if (t.headerContact2) doc.text(t.headerContact2, { width: w });
  const y = Math.max(doc.y, top + 48) + 4;
  doc.moveTo(LEFT(doc), y).lineTo(doc.page.width - doc.page.margins.right, y).lineWidth(2).strokeColor(ACCENT).stroke();
  doc.y = y + 8; doc.fillColor('#000');
}

function titleBand(doc, title, no, mode, dateLabel) {
  const y = doc.y;
  doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(sz(13)).text(title, LEFT(doc), y);
  doc.fillColor('#333').font('Helvetica').fontSize(sz(9))
    .text(`No. ${no}${mode ? '   ' + mode : ''}   ${dateLabel}`, LEFT(doc), doc.y + 1);
  doc.moveDown(0.6); doc.fillColor('#000');
}

function amountBox(doc, label, value, cur) {
  const x = LEFT(doc), w = WIDTH(doc), h = 26, y = doc.y;
  doc.roundedRect(x, y, w, h, 4).fill(ACCENT);
  doc.fillColor('#fff').font('Helvetica').fontSize(9).text(`${label} (${cur})`, x + 10, y + 9, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(14).text(money(value), x, y + 6, { width: w - 12, align: 'right' });
  doc.y = y + h + 10; doc.fillColor('#000');
}

function detailGrid(doc, pairs) {
  const left = LEFT(doc), colW = WIDTH(doc) / 2, rowH = 27;
  let y = doc.y;
  pairs.forEach((p, i) => {
    const col = i % 2;
    if (col === 0 && i > 0) y += rowH;
    const x = left + col * colW;
    doc.fillColor('#999').font('Helvetica').fontSize(sz(6.8)).text(String(p[0]).toUpperCase(), x, y, { width: colW - 8 });
    doc.fillColor('#111').font('Helvetica-Bold').fontSize(sz(9.5))
      .text(p[1] == null || p[1] === '' ? '—' : String(p[1]), x, y + 9, { width: colW - 8, lineBreak: false, ellipsis: true });
  });
  doc.y = y + rowH + 2; doc.fillColor('#000');
}

function totals(doc, rows) {
  const left = LEFT(doc), w = WIDTH(doc);
  rows.forEach(([label, val, acc]) => {
    const y = doc.y;
    doc.fillColor(acc ? ACCENT : '#333').font(acc ? 'Helvetica-Bold' : 'Helvetica').fontSize(sz(acc ? 11 : 9.5))
      .text(label, left, y, { width: w / 2 });
    doc.text(val, left + w / 2, y, { width: w / 2, align: 'right' });
    doc.moveDown(0.35);
  });
  doc.fillColor('#000');
}

function table(doc, cols, data) {
  const left = LEFT(doc), w = WIDTH(doc), y0 = doc.y;
  const widths = cols.map((c) => (c.w || 1));
  const tot = widths.reduce((a, b) => a + b, 0);
  const colX = []; let acc = left;
  widths.forEach((ww) => { colX.push(acc); acc += (ww / tot) * w; });
  doc.rect(left, y0, w, 16).fill(ACCENT);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(sz(7.5));
  cols.forEach((c, i) => doc.text(c.label, colX[i] + 4, y0 + 5, { width: ((widths[i] / tot) * w) - 6, lineBreak: false }));
  doc.y = y0 + 16; doc.fillColor('#000');
  data.forEach((rowArr) => {
    const ry = doc.y;
    doc.font('Helvetica').fontSize(sz(8.5)).fillColor('#111');
    rowArr.forEach((cell, i) => doc.text(cell == null ? '' : String(cell), colX[i] + 4, ry + 3, { width: ((widths[i] / tot) * w) - 6, lineBreak: false, ellipsis: true }));
    doc.y = ry + 15;
    doc.moveTo(left, doc.y).lineTo(left + w, doc.y).lineWidth(0.4).strokeColor('#eee').stroke();
  });
  doc.moveDown(0.4); doc.fillColor('#000');
}

function signatures(doc, labels) {
  doc.moveDown(1.5);
  const left = LEFT(doc), w = WIDTH(doc), colW = w / labels.length, y = doc.y;
  labels.forEach((l, i) => {
    const x = left + i * colW;
    doc.moveTo(x + 6, y).lineTo(x + colW - 6, y).lineWidth(0.7).strokeColor('#999').stroke();
    doc.fillColor('#444').font('Helvetica').fontSize(sz(8.5)).text(l, x, y + 4, { width: colW, align: 'center' });
  });
  doc.y = y + 22; doc.fillColor('#000');
}

function printMeta(doc, row) {
  const left = LEFT(doc), w = WIDTH(doc), y = doc.y + 2;
  doc.moveTo(left, y).lineTo(left + w, y).lineWidth(0.5).strokeColor('#ddd').stroke();
  doc.fillColor('#999').font('Helvetica').fontSize(sz(7))
    .text(`Created by: ${row.CreatedByName || '—'}${row.CreatedAt ? ' · ' + fdate(row.CreatedAt) : ''}`, left, y + 4, { width: w / 2 });
  doc.text(`Printed: ${new Date().toLocaleString('en-GB')}`, left + w / 2, y + 4, { width: w / 2, align: 'right' });
}

/* ---- public renderers ---- */
function receipt(r, tpl, paper) {
  const t = tpl.base, rt = tpl.receipt || {}, cur = rt.currencyLabel || 'QAR';
  return run(paper, (doc) => {
    FS = 1;
    header(doc, t);
    titleBand(doc, rt.titleEn || 'Receipt Voucher',
      fmtDocNo(tpl.numbering, 'receipt', r.RecieptNo, r.RecieptDate, r.CreatedAt),
      r.PaymentMode, `Date: ${fdate(r.RecieptDate)}`);
    amountBox(doc, 'Received Amount', r.RecievedAmount, cur);
    detailGrid(doc, [
      ['Received from', `${r.CustomerName || ''}${r.Nationality ? ` (${r.Nationality})` : ''}`],
      ['Invoice', r.InvoiceNo ? fmtDocNo(tpl.numbering, 'invoice', r.InvoiceNo) : '—'],
      ['Contact 1', r.Mobile1], ['Contact 2', r.Mobile2],
      ['Room', r.RoomDetails], ['Departure', fdate(r.DepartureDate)],
      ['Passengers', r.PassengerCount ?? 0], ['Package', r.PackageName],
    ]);
    const received = Number(r.RecievedAmount) || 0;
    const curBal = r.CurrentBalanceAmount != null ? Number(r.CurrentBalanceAmount)
      : r.PreBalanceAmount != null ? Number(r.PreBalanceAmount) - received
      : r.InvoiceAmount != null ? Number(r.InvoiceAmount) - received : null;
    const preBal = r.PreBalanceAmount != null ? Number(r.PreBalanceAmount)
      : r.CurrentBalanceAmount != null ? Number(r.CurrentBalanceAmount) + received
      : r.InvoiceAmount != null ? Number(r.InvoiceAmount) : null;
    const amt = (v) => (v == null ? '—' : `${money(v)} ${cur}`);
    totals(doc, [
      ['Invoice Amount', amt(r.InvoiceAmount)],
      ['Received Amount', amt(received)],
      ['Current Balance', amt(curBal), true],
    ]);
    if (r.InvRemarks) { doc.moveDown(0.4); doc.fillColor('#999').fontSize(6.8).text('REMARKS'); doc.fillColor('#111').font('Helvetica').fontSize(9).text(r.InvRemarks, { width: WIDTH(doc) }); }
    if (rt.showSignatures !== false) signatures(doc, ['Manager', 'Customer', 'Receiver']);
    printMeta(doc, r);
  });
}

function payment(p, tpl, paper) {
  const t = tpl.base, pt = tpl.payment || {}, cur = pt.currencyLabel || 'QAR';
  return run(paper, (doc) => {
    FS = 1;
    header(doc, t);
    titleBand(doc, pt.titleEn || 'Payment Voucher',
      fmtDocNo(tpl.numbering, 'payment', p.PaymentNo, p.PaymentDate, p.CreatedAt),
      p.TypeOfPayment, `Date: ${fdate(p.PaymentDate)}`);
    amountBox(doc, 'Amount Paid', p.PaymentAmount, cur);
    detailGrid(doc, [
      ['Paid To', p.PaidTo], ['Type', p.TypeOfPayment],
      ['Contact', p.MobileNo], ['Invoice', p.InvoiceNo ? fmtDocNo(tpl.numbering, 'invoice', p.InvoiceNo) : '—'],
      ['Narration', p.Narration], ['Remarks', p.Remark],
    ]);
    if (pt.showSignatures !== false) signatures(doc, ['Prepared by', 'Approved by', 'Receiver']);
    printMeta(doc, p);
  });
}

function invoice(inv, passengers, tpl, paper) {
  const t = tpl.base, it = tpl.invoice || {}, cur = it.currencyLabel || 'QAR';
  return run(paper, (doc) => {
    FS = 1.15; // bigger fonts for the invoice (customer request)
    header(doc, t);
    titleBand(doc, it.titleEn || 'Invoice',
      fmtDocNo(tpl.numbering, 'invoice', inv.InvoiceNo, inv.InvoiceDate, inv.CreatedAt),
      inv.status, `Date: ${fdate(inv.InvoiceDate)}`);
    detailGrid(doc, [
      ['Customer', `${inv.CustomerName || ''}${inv.Nationality ? ` (${inv.Nationality})` : ''}`],
      ['Package', inv.PackageName],
      ['Contact 1', inv.Mobile1], ['Contact 2', inv.Mobile2],
      ['Departure', fdate(inv.DepartureDate)], ['Room', `${inv.RoomType || ''} ${inv.RoomDetails || ''}`.trim()],
    ]);
    if (it.showPassengers !== false && passengers && passengers.length) {
      doc.fillColor('#999').font('Helvetica').fontSize(sz(6.8)).text('PASSENGERS'); doc.moveDown(0.2);
      table(doc, [{ label: '#', w: 0.5 }, { label: 'Passenger', w: 3 }, { label: 'Visa Type', w: 2 }],
        passengers.map((p, i) => [i + 1, p.PassengerName, p.VisaType || '—']));
    }
    totals(doc, [
      ['Amount', `${money(inv.Amount)} ${cur}`],
      ['Discount', `${money(inv.DiscountAmount)} ${cur}`],
      ['Net Amount', `${money(inv.NetAmount)} ${cur}`],
      ['Received', `${money(inv.received)} ${cur}`],
      ['Balance Due', `${money(inv.balance)} ${cur}`, true],
    ]);
    if (it.showSignatures !== false) signatures(doc, ['Manager', 'Customer', 'Authorised Signature']);
    printMeta(doc, inv);
    FS = 1; // reset for any subsequent (receipt/payment) renders
  });
}

module.exports = { receipt, payment, invoice };
