/* Passenger visa fields (run: node test-passenger-visa.cjs — needs the API on :5001).
   Guards two things the UI got wrong: an unpicked visa type reaching a NOT NULL
   column as a 500, and "No" being stored as 0 — a code in no master table, which
   read back as "Yes" and silently flipped the answer on the next save.
   Creates its own invoice and removes everything it made. */
const BASE = process.env.BASE || 'http://localhost:5001';
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { query, pool } = require('./src/db');
const { createSession } = require('./src/sessionStore');

let token = '', fails = 0;
const ok = (name, pass, detail = '') => {
  if (!pass) fails++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const call = async (method, path, body) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const pax = (name, visaTypeCode, visaRequiredCode) => ({ passengerName: name, visaTypeCode, visaRequiredCode });
const base = { customerName: 'ZZ TEST passenger-visa', invoiceDate: '2026-11-01', amount: 1000, discountAmount: 0 };

(async () => {
  const [u] = await query("SELECT * FROM app_users WHERE role='Super Admin' AND active=1 LIMIT 1");
  const jti = await createSession(u.id, '127.0.0.1', 'test');
  token = jwt.sign({ id: u.id, username: u.username, name: u.display_name, role: u.role, jti },
    process.env.JWT_SECRET, { expiresIn: '5m' });

  let invoiceCode = null;
  try {
    // the save that used to return a bare 500
    const noVisa = await call('POST', '/api/invoices',
      { ...base, passengers: [pax('shihab', '', 1), pax('wdhwudh', '', 1)] });
    ok('missing visa type is refused, not a 500', noVisa.status === 400, `${noVisa.status}: ${noVisa.body.error || ''}`);
    ok('the message names the offending passenger',
      /Passenger 1 \(shihab\)/.test(noVisa.body.error || ''), noVisa.body.error || '');

    const second = await call('POST', '/api/invoices',
      { ...base, passengers: [pax('first', 2, 1), pax('second', '', 1)] });
    ok('a later row missing its visa type is caught too',
      second.status === 400 && /Passenger 2 \(second\)/.test(second.body.error || ''), second.body.error || '');

    // unnamed rows are blanks in the grid, not errors
    const blank = await call('POST', '/api/invoices',
      { ...base, passengers: [pax('only one', 2, 1), pax('   ', '', 1)] });
    invoiceCode = blank.body.invoiceCode;
    ok('a blank row is skipped, not reported', blank.status === 201, blank.body.error || '');

    // Yes/No must round-trip as the master's own codes
    const saved = await call('PUT', `/api/invoices/${invoiceCode}`,
      { ...base, passengers: [pax('says yes', 2, 1), pax('says no', 3, 2)] });
    ok('invoice saved with both answers', saved.status === 200, saved.body.error || '');

    const rows = await query(
      'SELECT PassengerName, VisaTypeCode, VisaRequiredCode FROM UmrahPassengers WHERE InvoiceCode=? ORDER BY SlNo', [invoiceCode]);
    ok('"Yes" stored as 1', rows[0] && rows[0].VisaRequiredCode === 1, `${rows[0] && rows[0].VisaRequiredCode}`);
    ok('"No" stored as 2, never 0', rows[1] && rows[1].VisaRequiredCode === 2, `${rows[1] && rows[1].VisaRequiredCode}`);
    ok('visa types stored as chosen',
      rows[0].VisaTypeCode === 2 && rows[1].VisaTypeCode === 3, rows.map((r) => r.VisaTypeCode).join(','));

    // a stale client sending the old 0 must not plant an off-master code again
    await call('PUT', `/api/invoices/${invoiceCode}`, { ...base, passengers: [pax('legacy client', 2, 0)] });
    const [legacy] = await query('SELECT VisaRequiredCode FROM UmrahPassengers WHERE InvoiceCode=?', [invoiceCode]);
    ok('a client sending 0 is clamped to a real code',
      legacy.VisaRequiredCode === 1 || legacy.VisaRequiredCode === 2, `${legacy.VisaRequiredCode}`);

    const detail = await call('GET', `/api/invoices/${invoiceCode}`);
    ok('the form reads the stored code back unchanged',
      detail.body.passengers[0].VisaRequiredCode === legacy.VisaRequiredCode);
  } finally {
    if (invoiceCode) {
      await query('DELETE FROM UmrahPassengers WHERE InvoiceCode=?', [invoiceCode]);
      await query('DELETE FROM UmrahInvoice WHERE InvoiceCode=?', [invoiceCode]);
      console.log(`cleaned up invoice ${invoiceCode}`);
    }
    await pool.end();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
