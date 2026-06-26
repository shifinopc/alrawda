/* Verifies soft-delete/restore + forced-change flag. Cleans up. */
const mysql = require('mysql2/promise');
const B = 'http://localhost:5001';
const pass = (n, ok, d = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`);
(async () => {
  const adm = (await (await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin@123' }) })).json()).token;
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adm };
  const get = async (p) => (await fetch(B + p, { headers: H })).json();

  const r = await (await fetch(B + '/api/payments', { method: 'POST', headers: H, body: JSON.stringify({ type: 'Expense', paidTo: 'SOFT DEL TEST', amount: 5 }) })).json();
  const code = r.paymentCode;
  await fetch(B + '/api/payments/' + code, { method: 'DELETE', headers: H });
  let active = await get('/api/payments?payee=SOFT DEL TEST&deleted=0');
  let bin = await get('/api/payments?payee=SOFT DEL TEST&deleted=1');
  pass('soft-delete: gone from active list', !active.rows.find((x) => x.PaymentCode === code));
  pass('soft-delete: present in recycle bin', !!bin.rows.find((x) => x.PaymentCode === code));
  await fetch(B + '/api/payments/' + code + '/restore', { method: 'POST', headers: H });
  active = await get('/api/payments?payee=SOFT DEL TEST&deleted=0');
  pass('restore: back in active list', !!active.rows.find((x) => x.PaymentCode === code));

  const u = await get('/api/users');
  const jassim = u.rows.find((x) => x.username === 'jassim');
  pass('forced-change flag set on migrated user', jassim && jassim.must_change_password === 1, 'jassim=' + jassim?.must_change_password);

  const c = await mysql.createConnection({ host: 'localhost', user: 'root', password: 'admin@123', database: 'travels' });
  await c.query("DELETE FROM UmrahPayment WHERE PaidTo='SOFT DEL TEST'");
  await c.end();
  console.log('cleanup done');
})().catch((e) => { console.error(e); process.exit(1); });
