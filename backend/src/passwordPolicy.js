const { query } = require('./db');

const DEFAULTS = { pwMinLength: 8, pwComplexity: 'upper-number', pwLockout: 5 };

async function getPolicy() {
  const rows = await query("SELECT v FROM app_settings WHERE k = 'security'").catch(() => []);
  if (!rows.length) return DEFAULTS;
  try { return { ...DEFAULTS, ...JSON.parse(rows[0].v) }; } catch { return DEFAULTS; }
}

/** Validate a new password against the saved policy. Returns null if OK, else an error string. */
async function validatePassword(pw) {
  const p = await getPolicy();
  if (!pw || pw.length < (p.pwMinLength || 8)) {
    return `Password must be at least ${p.pwMinLength || 8} characters`;
  }
  const hasUpper = /[A-Z]/.test(pw);
  const hasNumber = /[0-9]/.test(pw);
  const hasSymbol = /[^A-Za-z0-9]/.test(pw);
  if (p.pwComplexity === 'upper-number-symbol' && !(hasUpper && hasNumber && hasSymbol)) {
    return 'Password must include an uppercase letter, a number and a symbol';
  }
  if (p.pwComplexity === 'upper-number' && !(hasUpper && hasNumber)) {
    return 'Password must include an uppercase letter and a number';
  }
  return null;
}

module.exports = { validatePassword, getPolicy };
