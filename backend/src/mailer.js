const nodemailer = require('nodemailer');
const { query } = require('./db');
const { buildBrandedEmail } = require('./emailTemplate');

/** Load the saved email config from app_settings (Settings → Email Settings). */
async function getConfig() {
  const rows = await query("SELECT v FROM app_settings WHERE k = 'email'").catch(() => []);
  if (!rows.length) return null;
  try { return JSON.parse(rows[0].v); } catch { return null; }
}

function transportFor(cfg) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: Number(cfg.port) || (cfg.security === 'ssl' ? 465 : 587),
    secure: cfg.security === 'ssl',
    requireTLS: cfg.security === 'tls',
    auth: cfg.username ? { user: cfg.username, pass: cfg.password || '' } : undefined,
    connectionTimeout: 10000,
  });
}

/** Is SMTP configured enough to attempt sending? */
async function isConfigured() {
  const cfg = await getConfig();
  return !!(cfg && cfg.host && cfg.fromEmail);
}

/** Is a given notification toggle enabled? (notifyWelcome / notifyReceipt / notifyInvoice / notifyDailySummary) */
async function notifyEnabled(key) {
  const cfg = await getConfig();
  return !!(cfg && cfg[key]);
}

/**
 * Send an email using the saved config. Returns {ok} or {ok:false, error}.
 * Never throws — callers can fire-and-forget.
 */
async function sendMail({ to, subject, text, html, attachments }) {
  try {
    const cfg = await getConfig();
    if (!cfg || !cfg.host || !cfg.fromEmail) return { ok: false, error: 'SMTP not configured' };
    if (!to) return { ok: false, error: 'No recipient' };
    // wrap every message in the standard branded template (logo + header/footer)
    const { html: brandedHtml, logoAttachments } = await buildBrandedEmail({ text, html });
    const info = await transportFor(cfg).sendMail({
      from: cfg.fromName ? `"${cfg.fromName}" <${cfg.fromEmail}>` : cfg.fromEmail,
      to,
      replyTo: cfg.replyTo || undefined,
      subject,
      text: text || undefined, // plain-text fallback for clients that don't render HTML
      html: brandedHtml,
      attachments: [...(attachments || []), ...logoAttachments],
    });
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { sendMail, isConfigured, notifyEnabled, getConfig };
