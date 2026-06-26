const { query } = require('./db');
const { sendMail, getConfig, notifyEnabled } = require('./mailer');
const { buildInvoicePdf, buildReceiptPdf } = require('./pdf');

/** Where internal notifications go. Customer emails aren't stored in the
 *  migrated data, so event/summary mails are addressed to management. */
async function recipient() {
  const cfg = (await getConfig()) || {};
  return cfg.notifyRecipient || cfg.replyTo || cfg.fromEmail || null;
}

/** Recipients for the daily summary — its own list (one or more addresses,
 *  separated by comma/semicolon/space). Falls back to the management recipient. */
async function summaryRecipients() {
  const cfg = (await getConfig()) || {};
  const list = String(cfg.summaryRecipients || '')
    .split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  return list.length ? list.join(',') : recipient();
}

const today = () => new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD

/* ---- event notifications (fire-and-forget) ---- */
async function notifyInvoiceCreated(code) {
  try {
    if (!(await notifyEnabled('notifyInvoice'))) return;
    const to = await recipient();
    if (!to) return;
    const doc = await buildInvoicePdf(code, 'a4');
    if (!doc) return;
    const r = doc.row;
    await sendMail({
      to,
      subject: `New invoice ${r.InvoiceNo} — ${r.CustomerName}`,
      text: `A new invoice was created.\n\nInvoice: ${r.InvoiceNo}\nCustomer: ${r.CustomerName}\nNet amount: QAR ${Number(r.NetAmount).toLocaleString()}\nBalance due: QAR ${Number(r.balance).toLocaleString()}\nCreated by: ${r.CreatedByName || '—'}\n\nThe invoice PDF is attached.`,
      attachments: [{ filename: doc.name, content: doc.buffer }],
    });
  } catch { /* never break the request */ }
}

async function notifyReceiptCreated(code) {
  try {
    if (!(await notifyEnabled('notifyReceipt'))) return;
    const to = await recipient();
    if (!to) return;
    const doc = await buildReceiptPdf(code, 'a5');
    if (!doc) return;
    const r = doc.row;
    await sendMail({
      to,
      subject: `Receipt ${r.RecieptNo} — ${r.CustomerName}`,
      text: `A receipt was recorded.\n\nReceipt: ${r.RecieptNo}\nCustomer: ${r.CustomerName}\nReceived: QAR ${Number(r.RecievedAmount).toLocaleString()}\nRemaining balance: QAR ${Number(r.CurrentBalanceAmount).toLocaleString()}\nCreated by: ${r.CreatedByName || '—'}\n\nThe receipt PDF is attached.`,
      attachments: [{ filename: doc.name, content: doc.buffer }],
    });
  } catch { /* never break the request */ }
}

/* ---- security notifications (fire-and-forget) ---- */
// alert when an account signs in from an IP it hasn't been seen from before
async function notifyNewDeviceLogin(user, ip, userAgent) {
  try {
    const when = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    const body = `A new sign-in to the AL RAWDA ERP account "${user.display_name}" (${user.username}) was detected from a device/network not seen before.\n\nWhen: ${when}\nIP address: ${ip || '—'}\nDevice: ${(userAgent || '—').slice(0, 160)}\n\nIf this was you, no action is needed. If not, change your password immediately and tell an administrator.`;
    const subject = `New sign-in to ${user.display_name}'s account`;
    // notify the user (if we have their email) and management
    const to = [user.email, await recipient()].filter(Boolean).join(',');
    if (!to) return;
    await sendMail({ to, subject, text: body });
  } catch { /* never break login */ }
}

// alert management when a sensitive admin action happens (role change, password reset)
async function notifyAdminAction(actorName, summary, detail) {
  try {
    const to = await recipient();
    if (!to) return;
    const when = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    await sendMail({
      to,
      subject: `Admin action: ${summary}`,
      text: `A sensitive administrative action was performed on AL RAWDA ERP.\n\nAction: ${summary}\n${detail ? detail + '\n' : ''}Performed by: ${actorName || '—'}\nWhen: ${when}\n\nIf this was not expected, review the Activity Log and User Management.`,
    });
  } catch { /* never break the request */ }
}

/* ---- daily summary ---- */
async function buildSummaryData(day) {
  const d = day || today();
  const [[col]] = [await query(
    `SELECT IFNULL(SUM(RecievedAmount),0) AS collected, COUNT(*) AS receipts
     FROM UmrahReciept WHERE is_deleted=0 AND DATE(RecieptDate) = ?`, [d])];
  const [[inv]] = [await query(
    `SELECT COUNT(*) AS invoices, IFNULL(SUM(NetAmount),0) AS invoiced
     FROM UmrahInvoice WHERE is_deleted=0 AND DATE(InvoiceDate) = ?`, [d])];
  const [[pend]] = [await query(
    `SELECT IFNULL(SUM(bal),0) AS pending, COUNT(*) AS pendingInvoices FROM (
        SELECT i.NetAmount - IFNULL((SELECT SUM(RecievedAmount) FROM UmrahReciept WHERE InvoiceCode=i.InvoiceCode AND is_deleted=0),0) AS bal
        FROM UmrahInvoice i WHERE i.is_deleted=0 AND TRIM(IFNULL(i.CancelYesNo,'N')) <> 'Y'
        HAVING bal > 0
      ) x`)];
  return { day: d, ...col, ...inv, ...pend };
}

async function sendDailySummary(force) {
  if (!force && !(await notifyEnabled('notifyDailySummary'))) return { ok: false, error: 'disabled' };
  const to = await summaryRecipients();
  if (!to) return { ok: false, error: 'no recipient' };
  const s = await buildSummaryData();
  const n = (v) => `QAR ${Number(v || 0).toLocaleString()}`;
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;color:#221a35">
      <h2 style="color:#8a1538;margin:0 0 4px">AL RAWDA — Daily Summary</h2>
      <div style="color:#666;margin-bottom:14px">${s.day}</div>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:6px 14px 6px 0">Collections today</td><td style="font-weight:700">${n(s.collected)} <span style="color:#888">(${s.receipts} receipts)</span></td></tr>
        <tr><td style="padding:6px 14px 6px 0">Invoiced today</td><td style="font-weight:700">${n(s.invoiced)} <span style="color:#888">(${s.invoices} invoices)</span></td></tr>
        <tr><td style="padding:6px 14px 6px 0;border-top:1px solid #eee">Total pending balance</td><td style="font-weight:700;color:#b3261e;border-top:1px solid #eee">${n(s.pending)} <span style="color:#888">(${s.pendingInvoices} open invoices)</span></td></tr>
      </table>
      <p style="color:#999;font-size:12px;margin-top:18px">Automated summary from AL RAWDA ERP.</p>
    </div>`;
  const text = `AL RAWDA — Daily Summary (${s.day})\nCollections today: ${n(s.collected)} (${s.receipts} receipts)\nInvoiced today: ${n(s.invoiced)} (${s.invoices} invoices)\nTotal pending balance: ${n(s.pending)} (${s.pendingInvoices} open invoices)`;
  return sendMail({ to, subject: `AL RAWDA — Daily Summary ${s.day}`, text, html });
}

/* ---- lightweight scheduler: fires the summary once per day at the configured hour ---- */
let lastSummaryDay = null;
function startScheduler() {
  const tick = async () => {
    try {
      const cfg = (await getConfig()) || {};
      if (!cfg.notifyDailySummary) return;
      const hour = Number.isFinite(Number(cfg.summaryHour)) ? Number(cfg.summaryHour) : 20;
      const now = new Date();
      const day = today();
      if (now.getHours() === hour && lastSummaryDay !== day) {
        lastSummaryDay = day;
        const r = await sendDailySummary();
        console.log(`[summary] ${day}:`, r && r.ok ? 'sent' : (r && r.error) || 'skipped');
      }
    } catch (e) { console.error('[summary] tick failed:', e.message); }
  };
  setInterval(tick, 60 * 1000); // check every minute
  tick();
}

module.exports = { notifyInvoiceCreated, notifyReceiptCreated, notifyNewDeviceLogin, notifyAdminAction, sendDailySummary, buildSummaryData, startScheduler };
