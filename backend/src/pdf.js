const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { query } = require('./db');
const { loadNumbering, format: fmtDocNo } = require('./docNumber');

/* ------------------------------------------------------------------ *
 * Template defaults — kept in sync with frontend/src/printTemplate.js *
 * (only the fields the PDF actually renders).                         *
 * ------------------------------------------------------------------ */
const TEMPLATE_DEFAULTS = {
  showLogo: true,
  logoImage: null,
  headerImage: null,
  headerAlign: 'center',
  headerLine1: 'AL RAWDA GROUP HAJJ & UMRAH SERVICES',
  headerLine2: 'الروضة للحج والعمرة',
  headerContact: 'Tel: 44424434 - Mob: +974 50604031 / 50604032 / 66141245 / 66767829',
  headerContact2: 'Bank Street, Street No. 910 Doha - Qatar',
  footerImage: null,
  showSignatures: true,
  wmEnabled: true,
  wmText: 'AL RAWDA',
};
const RECEIPT_DEFAULTS = {
  accentColor: '#8a1538', titleEn: 'Receipt Voucher', titleAr: 'سند قبض', currencyLabel: 'QAR',
  showNotes: true, showCounts: true, showPassengers: true, showSignatures: true,
  notesArabic: [
    'في حالة قيام المعتمر بإلغاء الرحلة فلن نتمكن من إسترداد قيمة رسوم برنامج العمرة',
    'فقط يمكن مراجعة الخطوط الناقلة بخصوص تذكرة الطيران حسب شروط الحجز',
    'التسكين في فنادق مكة والمدينة بعد الساعة الثالثة عصراً',
    'يرجى مراجعة جميع البيانات قبل مغادرة مكتبنا',
  ].join('\n'),
  footerBandText: 'يرجى إحضار الفاتورة لأنها ضرورية في الحالات التالية',
  footerCasesText: '(١) عند إستلام الجواز   (٢) عند إسترداد أي مبالغ مستحقة   (٣) عند دفع المبالغ المتبقية',
};
const INVOICE_DEFAULTS = {
  accentColor: '#8a1538', titleEn: 'Invoice', titleAr: 'فاتورة', currencyLabel: 'QAR',
  showPassengers: true, showReceipts: true, showSignatures: true,
  footerBandText: RECEIPT_DEFAULTS.footerBandText, footerCasesText: RECEIPT_DEFAULTS.footerCasesText,
};
const PAYMENT_DEFAULTS = {
  accentColor: '#8a1538', titleEn: 'Payment Voucher', titleAr: 'سند صرف', currencyLabel: 'QAR',
  showSignatures: true, footerBandText: '', footerCasesText: '',
};

/* ---- load saved templates from app_settings ---- */
async function loadSetting(key, fallback) {
  const rows = await query('SELECT v FROM app_settings WHERE k = ?', [key]).catch(() => []);
  if (!rows.length) return fallback;
  try { return { ...fallback, ...JSON.parse(rows[0].v) }; } catch { return fallback; }
}
async function loadTemplates() {
  const [base, receipt, invoice, payment, numbering] = await Promise.all([
    loadSetting('printTemplate', TEMPLATE_DEFAULTS),
    loadSetting('receiptTemplate', RECEIPT_DEFAULTS),
    loadSetting('invoiceTemplate', INVOICE_DEFAULTS),
    loadSetting('paymentTemplate', PAYMENT_DEFAULTS),
    loadNumbering(),
  ]);
  return { base, receipt, invoice, payment, numbering };
}

/* ---- logo: inline the saved data-URL, else the bundled brand logo ---- */
let LOGO_CACHE;
function bundledLogo() {
  if (LOGO_CACHE !== undefined) return LOGO_CACHE;
  const candidates = [
    process.env.LOGO_PATH,
    path.join(__dirname, '..', 'assets', 'alrawda-logo.jpg'),
    path.join(__dirname, '..', '..', 'frontend', 'public', 'alrawda-logo.jpg'),
    path.join(__dirname, '..', '..', 'frontend', 'dist', 'alrawda-logo.jpg'),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      const buf = fs.readFileSync(p);
      LOGO_CACHE = `data:image/jpeg;base64,${buf.toString('base64')}`;
      return LOGO_CACHE;
    } catch { /* try next */ }
  }
  LOGO_CACHE = null;
  return LOGO_CACHE;
}
function logoSrc(t) {
  if (t.logoImage && /^data:/.test(t.logoImage)) return t.logoImage;
  return bundledLogo();
}

/* ---- helpers ---- */
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (v) => Number(v ?? 0).toLocaleString('en-QA', { maximumFractionDigits: 2 });
const fdate = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

/* ---- shared chrome (CSS) for every voucher ---- */
function shell(accent, t, inner, titleband, footer) {
  const logo = t.showLogo ? logoSrc(t) : null;
  const header = t.headerImage
    ? `<img class="headimg" src="${esc(t.headerImage)}"/>`
    : `<div class="head">
        ${logo ? `<img class="logo" src="${logo}"/>` : ''}
        <div class="titles" style="text-align:${t.headerAlign === 'left' ? 'left' : 'center'}">
          <div class="ar-title">${esc(t.headerLine2)}</div>
          <div class="en-title">${esc(t.headerLine1)}</div>
          <div class="contact">${esc(t.headerContact)}</div>
          <div class="contact">${esc(t.headerContact2)}</div>
        </div>
        ${t.headerAlign !== 'left' && logo ? '<div style="width:62px"></div>' : ''}
       </div>`;
  return `<!doctype html><html><head><meta charset="utf-8"/>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #221a35; font-size: 11px; }
    .doc { position: relative; padding: 4mm 6mm; }
    .wm { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
          font-size: 52px; font-weight: 800; color: #7c00ff; opacity: .07; transform: rotate(-28deg);
          pointer-events: none; letter-spacing: 4px; }
    .head { display: flex; align-items: center; gap: 12px; padding-bottom: 6px; }
    .headimg { width: 100%; display: block; }
    .logo { width: 62px; height: 62px; object-fit: contain; border-radius: 8px; }
    .titles { flex: 1; }
    .ar-title { font-size: 17px; font-weight: 800; color: ${accent}; }
    .en-title { font-size: 12px; font-weight: 700; letter-spacing: .3px; }
    .contact { font-size: 8.5px; color: #555; }
    .accentbar { height: 3px; background: ${accent}; border-radius: 3px; margin: 4px 0 8px; }
    .titleband { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
    .doctitle { font-size: 14px; font-weight: 800; color: ${accent}; }
    .chip { font-size: 11px; font-weight: 700; padding: 2px 9px; border: 1px solid ${accent}; color: ${accent}; border-radius: 20px; }
    .chip-num { font-size: 11px; font-weight: 700; color: #1a1a1a; }
    .chip-red { font-size: 11px; font-weight: 700; padding: 2px 9px; background: ${accent}; color: #fff; border-radius: 20px; }
    .mode { font-size: 10px; color: #555; }
    .meta { font-size: 10px; color: #333; margin-left: auto; }
    .rtl { direction: rtl; }
    .amount { display: flex; align-items: center; justify-content: space-between; gap: 10px;
              background: ${accent}; color: #fff; padding: 6px 14px; border-radius: 8px; margin-bottom: 9px; font-size: 11px; }
    .amount b { font-size: 18px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 8px; margin-bottom: 8px; }
    .cell { border: 1px solid #e7e3f0; border-radius: 7px; padding: 4px 9px; }
    .cell.span { grid-column: 1 / -1; }
    .lbl { display: flex; justify-content: space-between; font-size: 8px; color: #888; text-transform: uppercase; letter-spacing: .3px; }
    .lbl .rtl { font-size: 9px; }
    .val { font-size: 11.5px; font-weight: 600; margin-top: 1px; }
    .counts { display: flex; gap: 8px; margin-bottom: 8px; }
    .counts > div { flex: 1; border: 1px solid #e7e3f0; border-radius: 7px; padding: 4px 9px; text-align: center; }
    .counts small { font-size: 8px; color: #888; display: block; }
    .counts b { font-size: 14px; }
    .split { display: flex; gap: 10px; align-items: flex-start; }
    .pax { flex: 1; border: 1px solid #e7e3f0; border-radius: 7px; padding: 5px 9px; }
    .paxline { font-size: 10.5px; padding: 1px 0; }
    .totals { min-width: 210px; display: flex; flex-direction: column; gap: 4px; }
    .totals .row { display: flex; justify-content: space-between; padding: 4px 10px; border: 1px solid #e7e3f0; border-radius: 7px; font-size: 10px; }
    .totals .row.acc { background: ${accent}11; border-color: ${accent}; font-weight: 700; }
    .totals .row b { font-size: 12.5px; }
    table.items { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    table.items th { background: ${accent}; color: #fff; font-size: 9px; padding: 4px 7px; text-align: left; }
    table.items td { border-bottom: 1px solid #eee; font-size: 10px; padding: 4px 7px; }
    .notes { font-size: 8.5px; color: #444; border-top: 1px dashed #ccc; padding: 5px 0; line-height: 1.6; }
    .sigs { display: flex; gap: 24px; margin: 18px 0 6px; }
    .sigs > div { flex: 1; border-top: 1px solid #999; padding-top: 4px; font-size: 9.5px; text-align: center; }
    .foot { text-align: center; font-size: 10.5px; color: ${accent}; font-weight: 700; padding: 4px; }
    .cases { text-align: center; font-size: 9px; color: #555; }
    .printmeta { margin-top: 6px; border-top: 1px solid #eee; padding-top: 4px; font-size: 8px; color: #999; display: flex; justify-content: space-between; }
  </style></head>
  <body><div class="doc">
    ${t.wmEnabled ? `<div class="wm">${esc(t.wmText)}</div>` : ''}
    ${header}
    <div class="accentbar"></div>
    ${titleband}
    ${inner}
    ${footer}
  </div></body></html>`;
}

function printMeta(row) {
  const printedOn = new Date().toLocaleString('en-GB');
  return `<div class="printmeta">
    <span>Created by: ${esc(row.CreatedByName || '—')}${row.CreatedAt ? ` · ${fdate(row.CreatedAt)}` : ''}</span>
    <span>Printed: ${esc(printedOn)}</span>
  </div>`;
}

function footerBlock(t, tpl) {
  if (t.footerImage) return `<img src="${esc(t.footerImage)}" style="display:block;width:100%"/>`;
  let h = '';
  if (tpl.footerBandText) h += `<div class="foot rtl">${esc(tpl.footerBandText)}</div>`;
  if (tpl.footerCasesText) h += `<div class="cases rtl">${esc(tpl.footerCasesText)}</div>`;
  return h;
}

/* ---- RECEIPT ---- */
function receiptHtml(r, tpl) {
  const { base: t, receipt: rt } = tpl;
  const accent = rt.accentColor || '#8a1538';
  const cur = rt.currencyLabel || 'QAR';
  const total = r.InvoiceAmount;
  const received = Number(r.RecievedAmount) || 0;
  const curBal = r.CurrentBalanceAmount != null ? Number(r.CurrentBalanceAmount)
    : r.PreBalanceAmount != null ? Number(r.PreBalanceAmount) - received
    : total != null ? Number(total) - received : null;
  const preBal = r.PreBalanceAmount != null ? Number(r.PreBalanceAmount)
    : r.CurrentBalanceAmount != null ? Number(r.CurrentBalanceAmount) + received
    : total != null ? Number(total) : null;
  const amt = (v) => (v == null ? '—' : `${money(v)} ${esc(cur)}`);
  const pax = String(r.PassengerDetails || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const notes = String(rt.notesArabic || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const recNo = fmtDocNo(tpl.numbering, 'receipt', r.RecieptNo, r.RecieptDate, r.CreatedAt);
  const invRef = r.InvoiceNo ? fmtDocNo(tpl.numbering, 'invoice', r.InvoiceNo) : '—';
  const titleband = `<div class="titleband">
    <span class="doctitle">${esc(rt.titleEn)}</span>
    <span class="chip-num">No. ${esc(recNo)}</span>
    <span class="mode">${esc(r.PaymentMode)}${r.PaymentMode === 'Bank' && r.Bank ? ` — ${esc(r.Bank)}${r.ChequeNo ? ` / ${esc(r.ChequeNo)}` : ''}` : ''}</span>
    <span class="meta">Date: <b>${fdate(r.RecieptDate)}</b></span>
    ${r.InvoiceNo ? `<span class="chip-red">Invoice ${esc(invRef)}</span>` : ''}
    <span class="doctitle rtl">${esc(rt.titleAr)}</span>
  </div>`;
  const cell = (en, ar, val, span) => `<div class="cell${span ? ' span' : ''}">
    <div class="lbl"><span>${en}</span><span class="rtl">${ar}</span></div>
    <div class="val">${val == null || val === '' ? '—' : val}</div></div>`;
  const inner = `
    <div class="amount"><span>Received Amount (${esc(cur)})</span><b>${money(r.RecievedAmount)}</b><span class="rtl">المبلغ المستلم</span></div>
    <div class="grid">
      ${cell('Received from', 'استلمت من', `<b>${esc(r.CustomerName)}</b>${r.Nationality ? ` (${esc(r.Nationality)})` : ''}`, true)}
      ${cell('Contact No. 1', 'رقم الاتصال 1', esc(r.Mobile1))}
      ${cell('Contact No. 2', 'رقم الاتصال 2', esc(r.Mobile2))}
      ${cell('Room Details', 'تفاصيل الغرفة', esc(r.RoomDetails) || 'Nil')}
      ${cell('Departure Date', 'تاريخ المغادرة', fdate(r.DepartureDate))}
      ${cell('Package', 'باقة', esc(r.PackageName), true)}
    </div>
    ${rt.showCounts ? `<div class="counts">
      <div><small>Passengers عدد الركاب</small><b>${r.PassengerCount ?? 0}</b></div>
      <div><small>Seat عدد المقاعد</small><b>${r.SeatCount ?? 0}</b></div>
      <div><small>Visa عدد تأشيرات</small><b>${r.VisaCount ?? 0}</b></div>
    </div>` : ''}
    <div class="split">
      ${rt.showPassengers ? `<div class="pax"><div class="lbl"><span>Passengers Details</span><span class="rtl">تفاصيل الركاب</span></div>
        ${pax.length ? pax.map((l) => `<div class="paxline">${esc(l)}</div>`).join('') : '<div class="paxline" style="color:#999">—</div>'}</div>` : ''}
      <div class="totals">
        <div class="row"><span>Invoice Amount</span><b>${amt(total)}</b></div>
        <div class="row"><span>Received Amount</span><b>${amt(received)}</b></div>
        <div class="row acc"><span>Current Balance</span><b>${amt(curBal)}</b></div>
      </div>
    </div>
    ${cell('Remarks', 'ملاحظات', esc(r.InvRemarks), true)}
    ${rt.showNotes && notes.length ? `<div class="notes rtl">${notes.map((n) => `• ${esc(n)}`).join('<br/>')}</div>` : ''}
    ${rt.showSignatures ? '<div class="sigs"><div>Manager مدير</div><div>Customer عميل</div><div>Receiver توقيع المستلم</div></div>' : ''}
  `;
  return shell(accent, t, inner, titleband, footerBlock(t, rt) + printMeta(r));
}

/* ---- PAYMENT ---- */
function paymentHtml(p, tpl) {
  const { base: t, payment: pt } = tpl;
  const accent = pt.accentColor || '#8a1538';
  const cur = pt.currencyLabel || 'QAR';
  const payNo = fmtDocNo(tpl.numbering, 'payment', p.PaymentNo, p.PaymentDate, p.CreatedAt);
  const invRef = p.InvoiceNo ? fmtDocNo(tpl.numbering, 'invoice', p.InvoiceNo) : '';
  const titleband = `<div class="titleband">
    <span class="doctitle">${esc(pt.titleEn)}</span>
    <span class="chip">No. ${esc(payNo)}</span>
    <span class="mode">${esc(p.TypeOfPayment)}</span>
    <span class="meta">Date: <b>${fdate(p.PaymentDate)}</b>${p.InvoiceNo ? ` · Invoice: <b>${esc(invRef)}</b>` : ''}</span>
    <span class="doctitle rtl">${esc(pt.titleAr)}</span>
  </div>`;
  const cell = (en, ar, val, span) => `<div class="cell${span ? ' span' : ''}">
    <div class="lbl"><span>${en}</span><span class="rtl">${ar}</span></div>
    <div class="val">${val == null || val === '' ? '—' : val}</div></div>`;
  const inner = `
    <div class="amount"><span>Amount Paid (${esc(cur)})</span><b>${money(p.PaymentAmount)}</b><span class="rtl">المبلغ المدفوع</span></div>
    <div class="grid">
      ${cell('Paid To', 'صرف إلى', `<b>${esc(p.PaidTo)}</b>`, true)}
      ${cell('Type', 'النوع', esc(p.TypeOfPayment))}
      ${cell('Contact', 'رقم الاتصال', esc(p.MobileNo))}
      ${cell('Narration', 'البيان', esc(p.Narration), true)}
      ${cell('Remarks', 'ملاحظات', esc(p.Remark), true)}
    </div>
    ${pt.showSignatures ? '<div class="sigs"><div>Prepared by أعد بواسطة</div><div>Approved by اعتمد</div><div>Receiver المستلم</div></div>' : ''}
  `;
  return shell(accent, t, inner, titleband, footerBlock(t, pt) + printMeta(p));
}

/* ---- INVOICE ---- */
function invoiceHtml(inv, passengers, receipts, tpl) {
  const { base: t, invoice: it } = tpl;
  const accent = it.accentColor || '#8a1538';
  const cur = it.currencyLabel || 'QAR';
  const invNo = fmtDocNo(tpl.numbering, 'invoice', inv.InvoiceNo, inv.InvoiceDate, inv.CreatedAt);
  const titleband = `<div class="titleband">
    <span class="doctitle">${esc(it.titleEn)}</span>
    <span class="chip">No. ${esc(invNo)}</span>
    <span class="mode">${esc(inv.status)}</span>
    <span class="meta">Date: <b>${fdate(inv.InvoiceDate)}</b></span>
    <span class="doctitle rtl">${esc(it.titleAr)}</span>
  </div>`;
  const cell = (en, ar, val, span) => `<div class="cell${span ? ' span' : ''}">
    <div class="lbl"><span>${en}</span><span class="rtl">${ar}</span></div>
    <div class="val">${val == null || val === '' ? '—' : val}</div></div>`;
  const paxRows = (passengers || []).map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.PassengerName)}</td><td>${esc(p.VisaType || '—')}</td></tr>`).join('');
  const inner = `
    <div class="grid">
      ${cell('Customer', 'العميل', `<b>${esc(inv.CustomerName)}</b>${inv.Nationality ? ` (${esc(inv.Nationality)})` : ''}`, true)}
      ${cell('Contact No. 1', 'رقم الاتصال 1', esc(inv.Mobile1))}
      ${cell('Contact No. 2', 'رقم الاتصال 2', esc(inv.Mobile2))}
      ${cell('Package', 'باقة', esc(inv.PackageName))}
      ${cell('Departure Date', 'تاريخ المغادرة', fdate(inv.DepartureDate))}
      ${cell('Room', 'الغرفة', `${esc(inv.RoomType || '')} ${esc(inv.RoomDetails || '')}`.trim(), true)}
    </div>
    ${it.showPassengers && paxRows ? `<table class="items"><thead><tr><th>#</th><th>Passenger</th><th>Visa Type</th></tr></thead><tbody>${paxRows}</tbody></table>` : ''}
    <div class="split">
      <div class="pax"><div class="lbl"><span>Remarks</span><span class="rtl">ملاحظات</span></div>
        <div class="paxline">${esc(inv.Remarks) || '—'}</div></div>
      <div class="totals">
        <div class="row"><span>Amount</span><b>${money(inv.Amount)} ${esc(cur)}</b></div>
        <div class="row"><span>Discount</span><b>${money(inv.DiscountAmount)} ${esc(cur)}</b></div>
        <div class="row"><span>Net Amount</span><b>${money(inv.NetAmount)} ${esc(cur)}</b></div>
        <div class="row"><span>Received</span><b>${money(inv.received)} ${esc(cur)}</b></div>
        <div class="row acc"><span>Balance Due</span><b>${money(inv.balance)} ${esc(cur)}</b></div>
      </div>
    </div>
    ${it.showSignatures ? '<div class="sigs"><div>Manager مدير</div><div>Customer عميل</div><div>Authorised Signature التوقيع المعتمد</div></div>' : ''}
  `;
  return shell(accent, t, inner, titleband, footerBlock(t, it) + printMeta(inv));
}

/* ------------------------------------------------------------------ *
 * Puppeteer (system Chrome — no Chromium download)                   *
 * ------------------------------------------------------------------ */
function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const c = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe` : '',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return c.find((p) => p && fs.existsSync(p)) || null;
}

let browserPromise = null;
async function getBrowser() {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    if (b && b.connected) return b;
    browserPromise = null;
  }
  const executablePath = findChrome();
  if (!executablePath) throw new Error('No Chrome/Edge browser found for PDF generation (set CHROME_PATH)');
  browserPromise = puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  return browserPromise;
}

async function renderPdf(html, paper = 'a5') {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    return await page.pdf({
      format: paper === 'a4' ? 'A4' : 'A5',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
  } finally {
    await page.close().catch(() => {});
  }
}

/* ------------------------------------------------------------------ *
 * High-level builders — fetch data + render. Reused by routes/mailer *
 * ------------------------------------------------------------------ */
const RECEIPT_SQL = `
  SELECT r.RecieptCode, r.RecieptNo, r.RecieptDate, r.RecievedAmount, r.CurrentBalanceAmount, r.PreBalanceAmount,
         TRIM(IFNULL(r.PaymentMode,'Cash')) AS PaymentMode, r.Bank, r.ChequeNo, r.RoomDetails,
         r.PassengerDetails, r.InvRemarks, r.created_by_name AS CreatedByName, r.created_at AS CreatedAt,
         i.InvoiceNo, i.CustomerName, i.Mobile1, i.Mobile2, i.DepartureDate,
         i.PassengerCount, i.SeatCount, i.VisaCount, i.NetAmount AS InvoiceAmount,
         p.PackageName, c.CountryName AS Nationality
  FROM UmrahReciept r
  LEFT JOIN UmrahInvoice i ON i.InvoiceCode = r.InvoiceCode
  LEFT JOIN UmrahPackage p ON p.PackageCode = i.PackageCode
  LEFT JOIN AdminCountryInfo c ON c.CountryCode = i.NatinalityCode
  WHERE r.RecieptCode = ?`;

const PAYMENT_SQL = `
  SELECT p.PaymentCode, p.PaymentNo, p.PaymentDate, TRIM(p.TypeOfPayment) AS TypeOfPayment,
         p.PaidTo, p.Narration, p.Remark, p.PaymentAmount, p.MobileNo,
         p.created_by_name AS CreatedByName, p.created_at AS CreatedAt, i.InvoiceNo
  FROM UmrahPayment p LEFT JOIN UmrahInvoice i ON i.InvoiceCode = p.InvoiceCode
  WHERE p.PaymentCode = ?`;

const INVOICE_SQL = `
  SELECT i.InvoiceCode, i.InvoiceNo, i.InvoiceDate, i.CustomerName, i.Mobile1, i.Mobile2,
         c.CountryName AS Nationality, p.PackageName, i.DepartureDate, i.RoomType, i.RoomDetails,
         i.Amount, i.DiscountAmount, i.NetAmount, i.Remarks,
         i.created_by_name AS CreatedByName, i.created_at AS CreatedAt,
         IFNULL((SELECT SUM(RecievedAmount) FROM UmrahReciept WHERE InvoiceCode=i.InvoiceCode AND is_deleted=0),0) AS received,
         (i.NetAmount - IFNULL((SELECT SUM(RecievedAmount) FROM UmrahReciept WHERE InvoiceCode=i.InvoiceCode AND is_deleted=0),0)) AS balance,
         CASE WHEN TRIM(IFNULL(i.CancelYesNo,'N'))='Y' THEN 'Cancelled'
              WHEN i.NetAmount - IFNULL((SELECT SUM(RecievedAmount) FROM UmrahReciept WHERE InvoiceCode=i.InvoiceCode AND is_deleted=0),0) <= 0 THEN 'Paid'
              WHEN IFNULL((SELECT SUM(RecievedAmount) FROM UmrahReciept WHERE InvoiceCode=i.InvoiceCode AND is_deleted=0),0) > 0 THEN 'Partially Paid'
              ELSE 'Not Paid' END AS status
  FROM UmrahInvoice i
  LEFT JOIN UmrahPackage p ON p.PackageCode = i.PackageCode
  LEFT JOIN AdminCountryInfo c ON c.CountryCode = i.NatinalityCode
  WHERE i.InvoiceCode = ?`;

/* Choose the engine: Chrome/puppeteer for full-fidelity HTML, else the browser-free
   PDFKit fallback (for hosts without Chrome). Set PDF_ENGINE=pdfkit to force the fallback. */
const pdfkitDoc = require('./pdfkit-doc');
const chromeAvailable = () => process.env.PDF_ENGINE !== 'pdfkit' && !!findChrome();

async function renderVoucher(htmlFn, pdfkitFn, paper) {
  if (chromeAvailable()) {
    try { return await renderPdf(htmlFn(), paper); }
    catch (e) { console.error('[pdf] Chrome render failed, falling back to PDFKit:', e.message); }
  }
  return pdfkitFn();
}

async function buildReceiptPdf(code, paper) {
  const tpl = await loadTemplates();
  const [r] = await query(RECEIPT_SQL, [code]);
  if (!r) return null;
  const buffer = await renderVoucher(() => receiptHtml(r, tpl), () => pdfkitDoc.receipt(r, tpl, paper), paper);
  return { buffer, name: `Receipt-${r.RecieptNo}.pdf`, row: r };
}
async function buildPaymentPdf(code, paper) {
  const tpl = await loadTemplates();
  const [p] = await query(PAYMENT_SQL, [code]);
  if (!p) return null;
  const buffer = await renderVoucher(() => paymentHtml(p, tpl), () => pdfkitDoc.payment(p, tpl, paper), paper);
  return { buffer, name: `Payment-${p.PaymentNo}.pdf`, row: p };
}
async function buildInvoicePdf(code, paper) {
  const tpl = await loadTemplates();
  const [inv] = await query(INVOICE_SQL, [code]);
  if (!inv) return null;
  const passengers = await query(
    `SELECT ps.PassengerName, v.VisaType FROM UmrahPassengers ps
     LEFT JOIN UmrahVisaType v ON v.VisaTypeCode = ps.VisaTypeCode
     WHERE ps.InvoiceCode = ? ORDER BY ps.SlNo`, [code]).catch(() => []);
  const buffer = await renderVoucher(() => invoiceHtml(inv, passengers, [], tpl), () => pdfkitDoc.invoice(inv, passengers, tpl, paper), paper);
  return { buffer, name: `Invoice-${inv.InvoiceNo}.pdf`, row: inv };
}

module.exports = { buildReceiptPdf, buildPaymentPdf, buildInvoicePdf, renderPdf };
