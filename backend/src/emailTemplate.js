const path = require('path');
const fs = require('fs');
const { query } = require('./db');

// fallback logo shipped with the app; the uploaded Company logo (if any) takes priority.
// the logo is embedded as a CID inline attachment (base64/data-URIs get stripped by Gmail etc.)
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'alrawda-logo.jpg');
const DEFAULT_ACCENT = '#8a1538';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// turn a plain-text body into simple paragraph HTML
function textToHtml(text) {
  return esc(text).split(/\n{2,}/).filter(Boolean)
    .map((p) => `<p style="margin:0 0 12px;">${p.replace(/\n/g, '<br>')}</p>`).join('') || '<p></p>';
}

async function readSetting(key) {
  try {
    const rows = await query('SELECT v FROM app_settings WHERE k = ?', [key]);
    if (rows.length) return JSON.parse(rows[0].v);
  } catch { /* ignore */ }
  return {};
}

// Single source of truth for company identity — the live Company Info (Settings → Company).
// Stimes/AL RAWDA branding flows from here into every email.
async function getCompany() {
  let c = {}, b = {};
  try { [c] = await query('SELECT CompanyName, Address, Phone1, EMail, WebSite FROM AdminCompanyInfo LIMIT 1'); } catch { /* none */ }
  try { [b] = await query('SELECT BranchNameinArabic, Address1, Phone1 AS BPhone, EMailID FROM AdminBranchInfo LIMIT 1'); } catch { /* none */ }
  c = c || {}; b = b || {};
  return {
    name: (c.CompanyName || '').trim() || 'AL RAWDA GROUP',
    nameAr: (b.BranchNameinArabic || '').trim() || '',
    address: (c.Address || b.Address1 || '').trim(),
    phone: (c.Phone1 || b.BPhone || '').trim(),
    email: (c.EMail || b.EMailID || '').trim(),
    website: (c.WebSite || '').trim(),
  };
}

// Logo data-URI: uploaded Company logo first, then the Invoice template logo, else null (asset file used).
async function getLogoDataUri() {
  const cp = await readSetting('companyProfile');
  if (cp.logo) return cp.logo;
  const pt = await readSetting('printTemplate');
  if (pt.logoImage) return pt.logoImage;
  return null;
}

// Build the logo CID attachment from a data-URI, or the bundled asset file. [] when none.
function logoAttachment(dataUri) {
  const m = /^data:([\w/+.-]+);base64,(.+)$/i.exec(dataUri || '');
  if (m) {
    const ext = (m[1].split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    return [{ filename: `logo.${ext}`, content: Buffer.from(m[2], 'base64'), cid: 'applogo' }];
  }
  try { if (fs.existsSync(LOGO_PATH)) return [{ filename: 'logo.jpg', path: LOGO_PATH, cid: 'applogo' }]; } catch { /* none */ }
  return [];
}

// Turn any data-URI into a CID inline attachment (used by custom image blocks).
function dataUriAttachment(dataUri, cid) {
  const m = /^data:([\w/+.-]+);base64,(.+)$/i.exec(dataUri || '');
  if (!m) return null;
  const ext = (m[1].split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  return { filename: `${cid}.${ext}`, content: Buffer.from(m[2], 'base64'), cid };
}

// substitute company placeholders in user-entered text
function fill(s, ctx) {
  return String(s == null ? '' : s)
    .replace(/\{company\}/gi, ctx.company.name)
    .replace(/\{companyAr\}/gi, ctx.company.nameAr)
    .replace(/\{address\}/gi, ctx.company.address)
    .replace(/\{phone\}/gi, ctx.company.phone)
    .replace(/\{email\}/gi, ctx.company.email)
    .replace(/\{website\}/gi, ctx.company.website)
    .replace(/\{year\}/gi, ctx.year);
}

const ALIGN = (a) => (a === 'left' || a === 'right' ? a : 'center');
function bgColor(bg, accent) { return bg === 'accent' ? accent : bg === 'light' ? '#faf7f8' : '#ffffff'; }

// ---- one block -> one email-safe table row ----
function renderBlock(b, ctx) {
  const accent = ctx.accent;
  const bg = bgColor(b.bg, accent);
  const align = ALIGN(b.align);
  const pad = b.bg === 'accent' ? '20px 24px' : '14px 28px';
  const cell = (inner, padding = pad) =>
    `<tr><td align="${align}" style="background:${bg};padding:${padding};">${inner}</td></tr>`;

  switch (b.type) {
    case 'logo': {
      if (!ctx.hasLogo) return '';
      const sz = Math.max(28, Math.min(120, Number(b.size) || 54));
      return cell(`<img src="cid:applogo" width="${sz}" height="${sz}" alt="" style="display:block;${align === 'center' ? 'margin:0 auto;' : ''}border-radius:8px;background:#fff;" />`, '18px 24px 8px');
    }
    case 'companyName':
      return cell(`<div style="color:${b.color || '#ffffff'};font-size:${Number(b.fontSize) || 18}px;font-weight:bold;letter-spacing:.3px;">${esc(ctx.company.name)}</div>`, '0 24px 6px');
    case 'tagline':
      return cell(`<div style="color:${b.color || '#f1d4dc'};font-size:12px;">${esc(fill(b.text || ctx.company.nameAr, ctx))}</div>`, '0 24px 18px');
    case 'heading':
      return cell(`<div style="color:${b.color || '#222222'};font-size:${Number(b.fontSize) || 17}px;font-weight:bold;">${esc(fill(b.text, ctx))}</div>`);
    case 'text':
      return cell(`<div style="color:${b.color || '#444444'};font-size:14px;line-height:1.65;">${textToHtml(fill(b.text, ctx)).replace(/\n/g, '<br>')}</div>`);
    case 'body': // the actual per-email message content is injected here
      return cell(`<div style="color:#333333;font-size:14px;line-height:1.65;text-align:left;">${ctx.content}</div>`, '6px 28px');
    case 'button': {
      const url = fill(b.url || '#', ctx);
      return cell(`<a href="${esc(url)}" style="display:inline-block;background:${b.color || accent};color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:11px 26px;border-radius:6px;">${esc(fill(b.text || 'Open', ctx))}</a>`);
    }
    case 'image': { // custom uploaded image — embedded as a CID inline attachment
      if (!b.src) return '';
      const cid = `imgblk${ctx.images.length}`;
      ctx.images.push({ cid, dataUri: b.src });
      const width = Math.max(40, Math.min(600, Number(b.width) || 240));
      const margin = align === 'center' ? 'margin:0 auto;' : align === 'right' ? 'margin-left:auto;' : '';
      const img = `<img src="cid:${cid}" width="${width}" alt="${esc(b.alt || '')}" style="display:block;${margin}max-width:100%;height:auto;border:0;border-radius:${Math.max(0, Number(b.radius) || 0)}px;" />`;
      return cell(b.url ? `<a href="${esc(fill(b.url, ctx))}">${img}</a>` : img);
    }
    case 'columns': { // two side-by-side cells (stack on narrow clients via width:50%)
      const col = (txt) => `<div style="color:${b.color || '#444444'};font-size:14px;line-height:1.6;">${textToHtml(fill(txt, ctx))}</div>`;
      return `<tr><td style="background:${bg};padding:${pad};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>` +
        `<td valign="top" width="50%" style="padding-right:10px;">${col(b.left || '')}</td>` +
        `<td valign="top" width="50%" style="padding-left:10px;">${col(b.right || '')}</td>` +
        `</tr></table></td></tr>`;
    }
    case 'social': { // a row of text links (label → url)
      const links = (Array.isArray(b.links) ? b.links : []).filter((l) => l && l.url);
      if (!links.length) return '';
      const items = links.map((l) =>
        `<a href="${esc(fill(l.url, ctx))}" style="display:inline-block;margin:0 8px;color:${b.color || accent};text-decoration:none;font-size:13px;font-weight:bold;">${esc(fill(l.label || l.url, ctx))}</a>`
      ).join('');
      return cell(items);
    }
    case 'html': // raw custom HTML (placeholders filled, intentionally NOT escaped)
      return cell(`<div style="font-size:14px;line-height:1.6;color:#333333;">${fill(b.html || '', ctx)}</div>`);
    case 'divider':
      return `<tr><td style="background:${bg};padding:4px 28px;"><div style="border-top:1px solid ${b.color || '#ececec'};font-size:0;line-height:0;">&nbsp;</div></td></tr>`;
    case 'spacer':
      return `<tr><td style="background:${bg};font-size:0;line-height:0;height:${Math.max(4, Math.min(80, Number(b.height) || 16))}px;">&nbsp;</td></tr>`;
    case 'companyInfo': {
      const parts = [];
      if (b.showAddress !== false && ctx.company.address) parts.push(esc(ctx.company.address));
      const contact = [];
      if (b.showPhone !== false && ctx.company.phone) contact.push('Tel: ' + esc(ctx.company.phone));
      if (b.showEmail !== false && ctx.company.email) contact.push(esc(ctx.company.email));
      if (contact.length) parts.push(contact.join(' &nbsp;·&nbsp; '));
      if (b.showWebsite && ctx.company.website) parts.push(esc(ctx.company.website));
      if (!parts.length) return '';
      return cell(`<div style="color:${b.color || '#888888'};font-size:12px;line-height:1.6;">${parts.join('<br>')}</div>`);
    }
    case 'footer':
      return `<tr><td align="center" style="background:${bgColor(b.bg || 'light', accent)};border-top:1px solid #efe6e9;padding:16px 24px;color:#9a9a9a;font-size:11px;line-height:1.5;">${esc(fill(b.text || 'Automated message from Stimes ERP · {company}\nPlease do not reply to this email.', ctx)).replace(/\n/g, '<br/>')}</td></tr>`;
    default:
      return '';
  }
}

// outer email shell wrapping the rendered rows
function shell(rows) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:24px 0;font-family:Arial,Helvetica,sans-serif;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #ececec;border-radius:10px;overflow:hidden;">
        ${rows}
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// Default layout used when the builder has never been saved — reproduces the
// classic branded look, fully driven by Company Info.
function defaultBlocks() {
  return [
    { type: 'logo', align: 'center', size: 54, bg: 'accent' },
    { type: 'companyName', bg: 'accent', color: '#ffffff' },
    { type: 'tagline', bg: 'accent', color: '#f1d4dc' },
    { type: 'body' },
    { type: 'divider' },
    { type: 'companyInfo', showAddress: true, showPhone: true, showEmail: true },
    { type: 'footer' },
  ];
}

// wrap an email body (html content or plain text) in the branded shell; returns the
// full HTML plus the logo attachment to add to the message
async function buildBrandedEmail({ text, html }) {
  const [tmpl, company, logoUri] = await Promise.all([readSetting('emailTemplate'), getCompany(), getLogoDataUri()]);
  const accent = tmpl.accentColor || DEFAULT_ACCENT;
  const showLogo = tmpl.showLogo !== false;
  const logoAttachments = showLogo ? logoAttachment(logoUri) : [];
  const content = html || textToHtml(text || '');
  // ctx.images collects custom image-block data-URIs so they can be attached as CIDs
  const ctx = { accent, company, content, hasLogo: logoAttachments.length > 0, year: String(new Date().getFullYear()), images: [] };

  let blocks = Array.isArray(tmpl.blocks) && tmpl.blocks.length ? tmpl.blocks : defaultBlocks();
  // a layout must contain exactly one body slot; if the user removed it, append it
  if (!blocks.some((b) => b.type === 'body')) blocks = [...blocks, { type: 'body' }];

  const rows = blocks.map((b) => renderBlock(b, ctx)).join('');
  const imageAttachments = ctx.images.map((im) => dataUriAttachment(im.dataUri, im.cid)).filter(Boolean);
  return { html: shell(rows), logoAttachments: [...logoAttachments, ...imageAttachments] };
}

module.exports = { buildBrandedEmail, textToHtml, defaultBlocks };
