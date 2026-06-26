const crypto = require('crypto');

// RFC 4648 base32 (Google Authenticator secret encoding), no padding
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  let bits = 0, value = 0; const out = [];
  for (const ch of String(str).toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function generateSecret(bytes = 20) { return base32Encode(crypto.randomBytes(bytes)); }

// RFC 4226 HOTP (SHA1, 6 digits)
function hotp(secretB32, counter) {
  const key = base32Decode(secretB32);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(buf).digest();
  const off = h[h.length - 1] & 0xf;
  const code = ((h[off] & 0x7f) << 24) | ((h[off + 1] & 0xff) << 16) | ((h[off + 2] & 0xff) << 8) | (h[off + 3] & 0xff);
  return String(code % 1e6).padStart(6, '0');
}

function totp(secretB32, tMs = Date.now(), step = 30) {
  return hotp(secretB32, Math.floor(tMs / 1000 / step));
}

// verify with ±1 step tolerance for clock drift
function verifyTotp(secretB32, code, tMs = Date.now(), step = 30, window = 1) {
  const c = String(code || '').replace(/\D/g, '');
  if (!secretB32 || c.length !== 6) return false;
  const counter = Math.floor(tMs / 1000 / step);
  for (let w = -window; w <= window; w++) if (hotp(secretB32, counter + w) === c) return true;
  return false;
}

function otpauthUri(secretB32, account, issuer = 'AL RAWDA ERP') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const p = new URLSearchParams({ secret: secretB32, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${p.toString()}`;
}

module.exports = { generateSecret, totp, verifyTotp, otpauthUri };
