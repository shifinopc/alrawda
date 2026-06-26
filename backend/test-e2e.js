/* eslint-disable no-console */
/** Full end-to-end test of AL RAWDA ERP backend + DB (run: node test-e2e.js). Cleans up after itself. */
const BASE = 'http://localhost:5001';
const mysql = require('mysql2/promise');

let token = '';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
async function call(method, path, body, tok = token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  let invCode, invCode2, recCode, reqId, testUserId;

  /* ============ AUTH ============ */
  let r = await call('POST', '/api/auth/login', { username: 'admin', password: 'admin@123' }, '');
  check('Auth: admin login', r.status === 200 && !!r.data.token, r.data.user?.role);
  token = r.data.token;

  r = await call('POST', '/api/auth/login', { username: 'admin', password: 'WRONG' }, '');
  check('Auth: wrong password rejected', r.status === 401);

  for (const [u, p] of [['hasnain', 'admin@123'], ['jassim', 'jassim@123'], ['faheem', 'faheem@123']]) {
    r = await call('POST', '/api/auth/login', { username: u, password: p }, '');
    check(`Auth: migrated user '${u}' login`, r.status === 200, r.data.user?.role);
  }

  r = await call('GET', '/api/auth/me');
  check('Auth: token validates (/me)', r.status === 200 && r.data.user?.username === 'admin');

  /* ============ DASHBOARD ============ */
  r = await call('GET', '/api/dashboard');
  const k = r.data.kpis || {};
  check('Dashboard: KPIs', r.status === 200 && ['totalCollection', 'pendingBalance', 'unbookedReceipts', 'invoicesToApprove'].every((x) => typeof k[x] === 'number'),
    `collection=${k.totalCollection}, open=${k.unbookedReceipts}`);
  check('Dashboard: charts data', Array.isArray(r.data.trend) && Array.isArray(r.data.incomeExpense) && Array.isArray(r.data.recentInvoices));

  /* ============ INVOICE LIFECYCLE ============ */
  r = await call('GET', '/api/invoices/next-no');
  const nextNo = r.data.next;
  check('Invoice: next number', r.status === 200 && nextNo > 0, `next=${nextNo}`);

  r = await call('POST', '/api/invoices', {
    invoiceDate: today, departureDate: today, customerName: 'E2E FULL TEST', nationalityCode: 118,
    packageCode: 8, mobile1: '+974 50000111', passengerCount: 2, seatCount: 2, visaCount: 2,
    roomType: 'Normal', amount: 1000, discountAmount: 0, netAmount: 1000,
    passengers: [
      { passengerName: 'E2E PAX ONE', visaTypeCode: 1, visaRequiredCode: 1 },
      { passengerName: 'E2E PAX TWO', visaTypeCode: 1, visaRequiredCode: 0 },
    ],
  });
  invCode = r.data.invoiceCode;
  check('Invoice: create with passengers', r.status === 201 && !!invCode, `code=${invCode}, no=${r.data.invoiceNo}`);

  r = await call('GET', `/api/invoices/${invCode}`);
  check('Invoice: detail + passengers', r.status === 200 && r.data.passengers?.length === 2 && r.data.invoice.status === 'Not Paid',
    `status=${r.data.invoice?.status}, balance=${r.data.invoice?.balance}`);

  r = await call('GET', `/api/invoices?customer=E2E FULL TEST`);
  check('Invoice: list filter by customer', r.status === 200 && r.data.rows?.some((x) => x.InvoiceCode === invCode));

  r = await call('PUT', `/api/invoices/${invCode}`, {
    invoiceDate: today, departureDate: today, customerName: 'E2E FULL TEST', nationalityCode: 118,
    packageCode: 8, mobile1: '+974 50000111', passengerCount: 3, seatCount: 3, visaCount: 3,
    roomType: 'Separate', amount: 1000, discountAmount: 0, netAmount: 1000,
    passengers: [
      { passengerName: 'E2E PAX ONE', visaTypeCode: 1, visaRequiredCode: 1 },
      { passengerName: 'E2E PAX TWO', visaTypeCode: 1, visaRequiredCode: 0 },
      { passengerName: 'E2E PAX THREE', visaTypeCode: 2, visaRequiredCode: 1 },
    ],
  });
  const det = await call('GET', `/api/invoices/${invCode}`);
  check('Invoice: update + passenger replace', r.status === 200 && det.data.passengers?.length === 3 && det.data.invoice.RoomType === 'Separate');

  /* ============ RECEIPT ============ */
  r = await call('POST', '/api/receipts', { invoiceCode: invCode, receiptDate: today, receivedAmount: 400, paymentMode: 'Cash' });
  recCode = r.data.receiptCode;
  check('Receipt: create partial payment', r.status === 201 && r.data.preBalance === 1000 && r.data.currentBalance === 600,
    `pre=${r.data.preBalance}, after=${r.data.currentBalance}`);

  r = await call('GET', `/api/invoices/${invCode}`);
  check('Receipt: invoice now Partially Paid', r.data.invoice?.status === 'Partially Paid' && Number(r.data.invoice?.balance) === 600);

  r = await call('GET', `/api/receipts?recNo=&customer=E2E FULL TEST`);
  check('Receipt: status Open in list', r.data.rows?.find((x) => x.RecieptCode === recCode)?.status === 'Open');

  /* ============ RECEIPT REQUEST WORKFLOW ============ */
  r = await call('POST', '/api/receipt-requests', { requestDate: today, note: 'E2E SUITE', receiptCodes: [recCode] });
  reqId = r.data.id;
  check('Request: create (book receipt)', r.status === 201 && !!r.data.requestNo, r.data.requestNo);

  r = await call('GET', `/api/receipts?customer=E2E FULL TEST`);
  check('Request: receipt now Booked', r.data.rows?.find((x) => x.RecieptCode === recCode)?.status === 'Booked');

  r = await call('POST', '/api/receipt-requests', { requestDate: today, note: 'E2E DUP', receiptCodes: [recCode] });
  check('Request: double-booking blocked', r.status === 409);

  r = await call('POST', `/api/receipt-requests/${reqId}/process`, { approveCodes: [recCode], comment: '' });
  check('Request: approve locks receipt', r.status === 200 && r.data.status === 'Approved');
  r = await call('GET', `/api/receipts?customer=E2E FULL TEST`);
  check('Request: receipt now Approved', r.data.rows?.find((x) => x.RecieptCode === recCode)?.status === 'Approved');

  r = await call('POST', `/api/receipt-requests/${reqId}/process`, { approveCodes: [recCode], comment: '' });
  check('Request: re-process blocked', r.status === 409);

  /* ============ ADJUSTMENT ============ */
  r = await call('POST', `/api/invoices/${invCode}/adjust`, { amount: 9999, reason: 'too much' });
  check('Adjustment: over-balance rejected', r.status === 400);

  r = await call('POST', `/api/invoices/${invCode}/adjust`, { amount: 600, reason: 'Write-off', remarks: 'E2E' });
  const afterAdj = await call('GET', `/api/invoices/${invCode}`);
  check('Adjustment: write-off → Paid', r.status === 200 && r.data.newBalance === 0 && afterAdj.data.invoice.status === 'Paid');

  /* ============ PAYMENTS ============ */
  r = await call('POST', '/api/payments', { type: 'Expense', paymentDate: today, paidTo: 'E2E SUPPLIER', narration: 'test', amount: 50 });
  const payExp = r.data.paymentCode;
  check('Payment: expense create', r.status === 201 && !!payExp, `no=${r.data.paymentNo}`);

  // second invoice for refund + cancel flow
  r = await call('POST', '/api/invoices', {
    invoiceDate: today, customerName: 'E2E FULL TEST', amount: 500, discountAmount: 0, netAmount: 500, passengers: [],
  });
  invCode2 = r.data.invoiceCode;
  await call('POST', '/api/receipts', { invoiceCode: invCode2, receivedAmount: 500, paymentMode: 'Cash' });
  r = await call('POST', '/api/payments', { type: 'Refund', paymentDate: today, invoiceCode: invCode2, amount: 500, reason: 'Invoice cancelled', cancelInvoice: true });
  const payRef = r.data.paymentCode;
  const inv2 = await call('GET', `/api/invoices/${invCode2}`);
  check('Payment: refund + invoice cancel', r.status === 201 && inv2.data.invoice.status === 'Cancelled',
    `collected=${r.data?.paymentNo ? 'ok' : ''} status=${inv2.data.invoice?.status}`);

  r = await call('DELETE', `/api/payments/${payExp}`);
  const r2 = await call('DELETE', `/api/payments/${payRef}`);
  check('Payment: delete', r.status === 200 && r2.status === 200);

  /* ============ REPORTS ============ */
  const range = `?from=${today}&to=${today}`;
  for (const rep of ['income-summary', 'pending', 'passengers', 'departure-wise', 'expense', 'refund']) {
    r = await call('GET', `/api/reports/${rep}${range}`);
    check(`Report: ${rep}`, r.status === 200 && Array.isArray(r.data.rows));
  }
  r = await call('GET', `/api/reports/income-report${range}`);
  check('Report: income-report', r.status === 200 && Array.isArray(r.data.invoices) && Array.isArray(r.data.receipts) && Array.isArray(r.data.refunds));

  /* ============ MASTERS + AUDIT ============ */
  r = await call('POST', '/api/masters/packages', { packageName: 'E2E PKG', rate: 100 });
  const pkgCode = r.data.packageCode;
  await call('PUT', `/api/masters/packages/${pkgCode}`, { packageName: 'E2E PKG', rate: 150 });
  const hist = await call('GET', `/api/masters/history?type=package&code=${pkgCode}`);
  const rateChange = hist.data.rows?.find((h) => h.action === 'update')?.changes?.find((c) => c.field === 'Rate');
  check('Master: package create + rate audit', !!pkgCode && rateChange && Number(rateChange.old) === 100 && Number(rateChange.new) === 150,
    rateChange ? `${rateChange.old} -> ${rateChange.new}` : 'no audit');
  r = await call('DELETE', `/api/masters/packages/${pkgCode}`);
  check('Master: package delete + audit', r.status === 200);

  r = await call('DELETE', '/api/masters/packages/8');
  check('Master: in-use delete blocked (409)', r.status === 409, r.data.error?.slice(0, 50));

  r = await call('POST', '/api/masters/visa-types', { visaType: 'E2E VISA', visaAmount: 10 });
  const visaCode = r.data.visaTypeCode;
  const dv = await call('DELETE', `/api/masters/visa-types/${visaCode}`);
  check('Master: visa type create/delete', r.status === 201 && dv.status === 200);

  r = await call('POST', '/api/masters/nationalities', { countryName: 'E2E LAND', shortName: 'E2E' });
  const natCode = r.data.countryCode;
  const un = await call('PUT', `/api/masters/nationalities/${natCode}`, { countryName: 'E2E LAND X', shortName: 'E2E' });
  const dn = await call('DELETE', `/api/masters/nationalities/${natCode}`);
  check('Master: nationality create/update/delete', r.status === 201 && un.status === 200 && dn.status === 200);

  r = await call('POST', '/api/masters/customer-master', { customerName: 'E2E CUSTOMER M', countryCode: 118, mobileNo: '+974 1' });
  const custCode = r.data.customerCode;
  const dc = await call('DELETE', `/api/masters/customer-master/${custCode}`);
  check('Master: customer create/delete', r.status === 201 && dc.status === 200);

  r = await call('GET', '/api/masters/customers?q=MOHAMMAD');
  check('Master: customer autocomplete', r.status === 200 && r.data.rows?.length > 0, `${r.data.rows?.length} matches`);
  r = await call('GET', '/api/masters/open-invoices');
  check('Master: open invoices selector', r.status === 200 && r.data.rows?.length > 0, `${r.data.rows?.length} open`);

  /* ============ USERS + RBAC ============ */
  r = await call('POST', '/api/users', { username: 'e2etest', password: 'E2e@1234', displayName: 'E2E Tester', role: 'Employee', department: 'Operations', status: 'Active' });
  testUserId = r.data.id;
  check('Users: create', r.status === 201 && !!testUserId);

  let empTok = (await call('POST', '/api/auth/login', { username: 'e2etest', password: 'E2e@1234' }, '')).data.token;
  check('Users: new user can login', !!empTok);

  r = await call('POST', '/api/users', { username: 'x', password: 'x12345678', displayName: 'X' }, empTok);
  check('RBAC: Employee blocked from creating users (403)', r.status === 403);

  await call('POST', `/api/users/${testUserId}/reset-password`, { newPassword: 'New@1234' });
  empTok = (await call('POST', '/api/auth/login', { username: 'e2etest', password: 'New@1234' }, '')).data.token;
  check('Users: password reset works', !!empTok);

  await call('PUT', `/api/users/${testUserId}`, { displayName: 'E2E Tester', role: 'Employee', status: 'Suspended' });
  r = await call('POST', '/api/auth/login', { username: 'e2etest', password: 'New@1234' }, '');
  check('Users: suspended user blocked from login', r.status === 401);

  r = await call('GET', '/api/users/sessions/recent');
  check('Users: sessions audit', r.status === 200 && r.data.rows?.length > 0, `${r.data.rows?.length} sign-ins`);
  r = await call('GET', '/api/users/1/activity');
  check('Users: desktop activity mapping', r.status === 200 && r.data.totalActions > 0, `${r.data.totalActions} actions`);

  /* ============ SETTINGS ============ */
  r = await call('GET', '/api/settings/company');
  const origCompany = r.data.company;
  check('Settings: company read', r.status === 200 && r.data.company?.CurrencyShort === 'QAR', `currency=${r.data.company?.CurrencyShort}`);
  r = await call('GET', '/api/settings/currencies');
  check('Settings: currency list', r.status === 200 && r.data.rows?.length >= 130, `${r.data.rows?.length} currencies`);
  r = await call('PUT', '/api/settings/company', { companyName: origCompany.CompanyName, currencyCode: origCompany.HCurrencyCode });
  check('Settings: company save', r.status === 200);
  r = await call('PUT', '/api/settings/prefs', { _e2e: { x: 1 } });
  const pr = await call('GET', '/api/settings/prefs');
  check('Settings: prefs roundtrip', r.status === 200 && pr.data.prefs?._e2e?.x === 1);
  r = await call('GET', '/api/settings/numbering-stats');
  check('Settings: numbering stats', r.status === 200 && r.data.invoice?.length >= 3, `${r.data.invoice?.length} yearly blocks`);
  r = await call('POST', '/api/settings/email-test', { to: 'x@x.qa' });
  check('Settings: email-test validates config', r.status === 400 || r.status === 502, r.data.error?.slice(0, 40));

  /* ============ CLEANUP ============ */
  const c = await mysql.createConnection({ host: 'localhost', user: 'root', password: 'admin@123', database: 'travels' });
  await c.query(`DELETE FROM receipt_request_dtl WHERE request_id IN (SELECT id FROM receipt_request WHERE note IN ('E2E SUITE','E2E DUP'))`);
  await c.query(`DELETE FROM receipt_request WHERE note IN ('E2E SUITE','E2E DUP')`);
  await c.query(`DELETE FROM UmrahReciept WHERE InvoiceCode IN (SELECT InvoiceCode FROM UmrahInvoice WHERE CustomerName='E2E FULL TEST')`);
  await c.query(`DELETE FROM UmrahPassengers WHERE InvoiceCode IN (SELECT InvoiceCode FROM UmrahInvoice WHERE CustomerName='E2E FULL TEST')`);
  await c.query(`DELETE FROM UmrahInvoice WHERE CustomerName='E2E FULL TEST'`);
  await c.query(`DELETE FROM master_audit WHERE record_name LIKE 'E2E%'`);
  await c.query(`DELETE FROM app_login_audit WHERE user_id = ?`, [testUserId]);
  await c.query(`DELETE FROM app_users WHERE username='e2etest'`);
  await c.query(`DELETE FROM app_settings WHERE k='_e2e'`);
  await c.end();
  console.log('\ncleanup done — all test data removed');

  const pass = results.filter((x) => x.ok).length;
  console.log(`\n=== ${pass}/${results.length} checks passed ===`);
  if (pass < results.length) {
    console.log('FAILED:', results.filter((x) => !x.ok).map((x) => x.name).join(' | '));
    process.exit(2);
  }
})().catch((e) => { console.error('SUITE ERROR:', e); process.exit(1); });
