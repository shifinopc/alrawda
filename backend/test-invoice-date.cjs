/* Invoice date must survive a save and read back the same, in any viewer timezone.
   (run: node test-invoice-date.cjs — needs the API on :5001)
   Guards the bug where a browser behind the server's timezone saw the previous day,
   so editing the invoice date looked like it never saved. Cleans up after itself. */
const BASE = process.env.BASE || 'http://localhost:5001';
const { execFileSync } = require('child_process');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { query, pool } = require('./src/db');
const { createSession } = require('./src/sessionStore');

const DATE = '2026-10-31';            // what the user picks in the date field
const EXPECTED = '31/10/2026';        // what every screen must show
let token = '', fails = 0;
const ok = (n, pass, d = '') => { if (!pass) fails++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); };
const call = async (m, p, b) => {
  const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: b === undefined ? undefined : JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
// how a browser in `tz` would render the value the API sent — exactly what fmtDate does
const renderIn = (tz, value) => execFileSync(process.execPath,
  ['-e', `console.log(new Date(${JSON.stringify(value)}).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric'}))`],
  { env: { ...process.env, TZ: tz }, encoding: 'utf8' }).trim();

(async () => {
  const [u] = await query("SELECT * FROM app_users WHERE role='Super Admin' AND active=1 LIMIT 1");
  const jti = await createSession(u.id, '127.0.0.1', 'test');
  token = jwt.sign({ id: u.id, username: u.username, name: u.display_name, role: u.role, jti }, process.env.JWT_SECRET, { expiresIn: '5m' });

  let code = null;
  try {
    const c = await call('POST', '/api/invoices', { customerName: 'ZZ TEST invoice-date', invoiceDate: DATE, amount: 100, discountAmount: 0 });
    code = c.body.invoiceCode;
    ok('invoice created', c.status === 201 && !!code);

    const got = (await call('GET', `/api/invoices/${code}`)).body.invoice.InvoiceDate;
    ok('API sends a plain date, not a UTC instant', typeof got === 'string' && !got.includes('Z'), String(got));

    for (const tz of ['Asia/Qatar', 'Asia/Kolkata', 'Europe/London', 'America/New_York']) {
      ok(`shows ${EXPECTED} to a viewer in ${tz}`, renderIn(tz, got) === EXPECTED, renderIn(tz, got));
    }

    // editing it must stick
    await call('PUT', `/api/invoices/${code}`, { customerName: 'ZZ TEST invoice-date', invoiceDate: '2026-11-02', amount: 100, discountAmount: 0 });
    const after = (await call('GET', `/api/invoices/${code}`)).body.invoice.InvoiceDate;
    ok('edited date saves as 02/11/2026', renderIn('Asia/Qatar', after) === '02/11/2026', renderIn('Asia/Qatar', after));
  } finally {
    if (code) {
      await query('DELETE FROM UmrahPassengers WHERE InvoiceCode=?', [code]);
      await query('DELETE FROM UmrahInvoice WHERE InvoiceCode=?', [code]);
      console.log(`cleaned up invoice ${code}`);
    }
    await pool.end();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
