/* Receipt balance rules (run: node test-restore-balance.cjs — needs the API on :5001).
   Guards the bug where restoring a binned receipt double-counted money on one invoice.
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
const received = async (code) => {
  const [r] = await query(
    'SELECT IFNULL(SUM(RecievedAmount),0) s FROM UmrahReciept WHERE InvoiceCode=? AND is_deleted=0', [code]);
  return Number(r.s);
};

(async () => {
  const [u] = await query("SELECT * FROM app_users WHERE role='Super Admin' AND active=1 LIMIT 1");
  const jti = await createSession(u.id, '127.0.0.1', 'test');
  token = jwt.sign({ id: u.id, username: u.username, name: u.display_name, role: u.role, jti },
    process.env.JWT_SECRET, { expiresIn: '5m' });

  let invoiceCode = null;
  try {
    const inv = await call('POST', '/api/invoices',
      { customerName: 'ZZ TEST restore-balance', invoiceDate: '2026-01-15', amount: 1000, discountAmount: 0 });
    invoiceCode = inv.body.invoiceCode;
    ok('invoice created', inv.status === 201 && !!invoiceCode, `net 1000, code ${invoiceCode}`);

    const a = await call('POST', '/api/receipts', { invoiceCode, receivedAmount: 1000, receiptDate: '2026-01-16' });
    ok('receipt A of 1000 accepted', a.status === 201);

    ok('invoice fully paid', (await received(invoiceCode)) === 1000);

    ok('receipt A binned', (await call('DELETE', `/api/receipts/${a.body.receiptCode}`)).status === 200);

    const b = await call('POST', '/api/receipts', { invoiceCode, receivedAmount: 1000, receiptDate: '2026-01-17' });
    ok('receipt B of 1000 accepted while A is binned', b.status === 201);

    // the bug: this used to succeed and leave 2000 received on a 1000 invoice
    const restore = await call('POST', `/api/receipts/${a.body.receiptCode}/restore`);
    ok('restoring A is refused', restore.status === 400, restore.body.error || `got ${restore.status}`);

    ok('invoice still holds exactly 1000', (await received(invoiceCode)) === 1000,
      `received ${await received(invoiceCode)}`);

    // the normal case must still work: bin B, restore A
    await call('DELETE', `/api/receipts/${b.body.receiptCode}`);
    const r2 = await call('POST', `/api/receipts/${a.body.receiptCode}/restore`);
    ok('restoring A is allowed once B is binned', r2.status === 200, r2.body.error || '');
    ok('invoice holds 1000 again', (await received(invoiceCode)) === 1000);
  } finally {
    if (invoiceCode) {
      await query('DELETE FROM UmrahReciept WHERE InvoiceCode=?', [invoiceCode]);
      await query('DELETE FROM UmrahPassengers WHERE InvoiceCode=?', [invoiceCode]);
      await query('DELETE FROM UmrahInvoice WHERE InvoiceCode=?', [invoiceCode]);
      console.log(`cleaned up invoice ${invoiceCode}`);
    }
    await pool.end();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
