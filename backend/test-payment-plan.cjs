/* Instalment (EMI) plan rules (run: node test-payment-plan.cjs — needs the API on :5001).
   Guards the two things that would quietly go wrong: instalments showing as paid
   because of money banked BEFORE the plan, and a plan whose rows don't add up to
   the balance. Creates its own invoice and removes everything it made. */
const BASE = process.env.BASE || 'http://localhost:5001';
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { query, pool } = require('./src/db');
const { createSession } = require('./src/sessionStore');
const { splitEqually, addMonths } = require('./src/paymentPlan');

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
const plan = async (code) => (await call('GET', `/api/invoices/${code}/plan`)).body.plan;
const schedule = (first, parts) => parts.map((amount, i) => ({ dueDate: addMonths(first, i), amount }));

(async () => {
  /* ---- pure helpers: no database needed ---- */
  ok('equal split totals the balance exactly',
    splitEqually(18000, 5).reduce((a, b) => a + b, 0) === 18000,
    splitEqually(18000, 5).join('+'));
  ok('uneven split still totals the balance exactly',
    splitEqually(18000, 7).reduce((a, b) => a + b, 0) === 18000,
    splitEqually(18000, 7).join('+'));
  ok('month step keeps the same day', addMonths('2026-12-01', 4) === '2027-04-01',
    addMonths('2026-12-01', 4));
  ok('month step clamps to a short month', addMonths('2027-01-31', 1) === '2027-02-28',
    addMonths('2027-01-31', 1));

  const [u] = await query("SELECT * FROM app_users WHERE role='Super Admin' AND active=1 LIMIT 1");
  const jti = await createSession(u.id, '127.0.0.1', 'test');
  token = jwt.sign({ id: u.id, username: u.username, name: u.display_name, role: u.role, jti },
    process.env.JWT_SECRET, { expiresIn: '5m' });

  let invoiceCode = null;
  try {
    // the sheet from the office: package 28,000, 10,000 already paid, 18,000 over 5 months
    const inv = await call('POST', '/api/invoices',
      { customerName: 'ZZ TEST payment-plan', invoiceDate: '2026-11-01', amount: 28000, discountAmount: 0 });
    invoiceCode = inv.body.invoiceCode;
    ok('invoice created', inv.status === 201 && !!invoiceCode, `net 28000, code ${invoiceCode}`);

    const early = await call('POST', '/api/receipts',
      { invoiceCode, receivedAmount: 10000, receiptDate: '2026-11-02' });
    ok('10,000 received before any plan', early.status === 201);

    const rows = schedule('2026-12-01', splitEqually(18000, 5));

    const tooEarly = await call('POST', `/api/invoices/${invoiceCode}/plan`, { lines: rows });
    ok('plan refused on an unapproved invoice', tooEarly.status === 400,
      tooEarly.body.error || `got ${tooEarly.status}`);

    await call('POST', `/api/invoices/${invoiceCode}/approve`, { status: 'Approved' });

    const short = await call('POST', `/api/invoices/${invoiceCode}/plan`,
      { lines: schedule('2026-12-01', [3600, 3600, 3600, 3600, 3500]) });
    ok('plan totalling less than the balance is refused', short.status === 400,
      short.body.error || `got ${short.status}`);

    const over = await call('POST', `/api/invoices/${invoiceCode}/plan`,
      { lines: schedule('2026-12-01', [3600, 3600, 3600, 3600, 4000]) });
    ok('plan totalling more than the balance is refused', over.status === 400,
      over.body.error || `got ${over.status}`);

    const made = await call('POST', `/api/invoices/${invoiceCode}/plan`, { lines: rows });
    ok('plan matching the balance is accepted', made.status === 200, made.body.error || '');

    // the bug this exists to catch: the 10,000 must not tick off instalments 1 and 2
    let p = await plan(invoiceCode);
    ok('plan starts at 0 of 5 despite the earlier 10,000',
      p && p.paidCount === 0 && p.count === 5, p ? `${p.paidCount}/${p.count}` : 'no plan');
    ok('plan covers the balance, not the package', p.plannedAmount === 18000, `${p.plannedAmount}`);

    const dup = await call('POST', `/api/invoices/${invoiceCode}/plan`, { lines: rows });
    ok('a second plan is refused while one is active', dup.status === 400, dup.body.error || '');

    const r1 = await call('POST', '/api/receipts',
      { invoiceCode, receivedAmount: 3600, receiptDate: '2026-12-01' });
    p = await plan(invoiceCode);
    ok('a payment after the plan fills the oldest instalment',
      r1.status === 201 && p.paidCount === 1 && p.instalments[0].status === 'Paid',
      `${p.paidCount}/${p.count}, first ${p.instalments[0].status}`);

    // 5,400 = one and a half instalments: it must spill into the next row
    const r2 = await call('POST', '/api/receipts',
      { invoiceCode, receivedAmount: 5400, receiptDate: '2026-12-20' });
    p = await plan(invoiceCode);
    ok('an overpayment spills into the next instalment',
      r2.status === 201 && p.paidCount === 2 && p.instalments[2].status === 'Part paid'
      && p.instalments[2].paid === 1800,
      `${p.paidCount}/${p.count}, third paid ${p.instalments[2].paid}`);

    // binning a pre-plan receipt must not "unpay" instalments past zero
    await call('DELETE', `/api/receipts/${early.body.receiptCode}`);
    p = await plan(invoiceCode);
    ok('binning the pre-plan receipt does not drive allocation negative',
      p.instalments.every((i) => i.paid >= 0) && p.paidCount >= 0,
      `${p.paidCount}/${p.count}`);
    await call('POST', `/api/receipts/${early.body.receiptCode}/restore`);

    /* ---- rescheduling the unpaid tail, keeping what is already settled ---- */
    // state here: 5 x 3600, instalments 1-2 Paid, 3 part paid 1800
    const moved = schedule('2027-06-01', [3600, 3600, 3600]);
    const resc = await call('PUT', `/api/invoices/${invoiceCode}/plan`, { lines: moved });
    ok('unpaid instalments rescheduled', resc.status === 200, resc.body.error || '');
    ok('the two settled instalments were kept', resc.body.kept === 2, `kept ${resc.body.kept}`);
    p = await plan(invoiceCode);
    ok('settled rows keep their original dates',
      p.instalments[0].dueDate === '2026-12-01' && p.instalments[1].dueDate === '2027-01-01',
      `${p.instalments[0].dueDate}, ${p.instalments[1].dueDate}`);
    ok('settled rows are still Paid', p.instalments.slice(0, 2).every((i) => i.status === 'Paid'));
    ok('the tail moved to the new dates', p.instalments[2].dueDate === '2027-06-01', p.instalments[2].dueDate);
    ok('part payment still counts against the tail', p.instalments[2].paid === 1800, `${p.instalments[2].paid}`);
    ok('the plan still covers the same total',
      p.instalments.reduce((t, i) => t + i.amount, 0) === p.plannedAmount, `${p.plannedAmount}`);
    ok('still not stale', p.stale === false);

    const short2 = await call('PUT', `/api/invoices/${invoiceCode}/plan`, { lines: schedule('2027-06-01', [3600, 3600, 3000]) });
    ok('a reschedule that changes the total is refused', short2.status === 400, short2.body.error || '');

    const backwards = await call('PUT', `/api/invoices/${invoiceCode}/plan`, { lines: schedule('2026-12-15', [3600, 3600, 3600]) });
    ok('a reschedule landing before a paid instalment is refused', backwards.status === 400, backwards.body.error || '');

    const gone = await call('DELETE', `/api/invoices/${invoiceCode}/plan`);
    ok('plan can be cancelled', gone.status === 200, gone.body.error || '');
    ok('a cancelled plan is no longer returned', (await plan(invoiceCode)) === null);
  } finally {
    if (invoiceCode) {
      await query('DELETE FROM payment_plan_dtl WHERE invoice_code=?', [invoiceCode]);
      await query('DELETE FROM payment_plan WHERE invoice_code=?', [invoiceCode]);
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
