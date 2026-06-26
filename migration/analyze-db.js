/** Classify the 447 migrated tables: web-app core, business history, and junk/scratch. */
const mysql = require('mysql2/promise');

// every table the web application reads or writes
const KEEP_CORE = new Set([
  'UmrahInvoice', 'UmrahReciept', 'UmrahPayment', 'UmrahPassengers', 'UmrahPackage',
  'UmrahVisaType', 'VisaRequiredTable', 'AdminCountryInfo', 'AdminCurrencyInfo',
  'AdminCompanyInfo', 'AdminBranchInfo', 'AdminUserMaster', 'adminUserAudit', 'sopCustomerInfo',
  'app_users', 'app_settings', 'app_login_audit', 'master_audit', 'receipt_request', 'receipt_request_dtl',
].map((s) => s.toLowerCase()));

// scratch / staging / recycle-bin patterns from the desktop app
const JUNK = /^(temp|tmp|ftmp|import|madreemp|tableforbudget)|_delete$/i;

(async () => {
  const c = await mysql.createConnection({ host: 'localhost', user: 'root', password: 'admin@123', database: 'travels' });
  const [tables] = await c.query(
    `SELECT TABLE_NAME AS name, TABLE_ROWS AS approxRows
     FROM information_schema.tables WHERE table_schema = 'travels' AND TABLE_TYPE='BASE TABLE'`);
  const buckets = { core: [], junk: [], emptyUnused: [], history: [] };
  for (const t of tables) {
    const [[{ n }]] = await c.query(`SELECT COUNT(*) AS n FROM \`${t.name}\``);
    if (KEEP_CORE.has(t.name.toLowerCase())) buckets.core.push(`${t.name} (${n})`);
    else if (JUNK.test(t.name)) buckets.junk.push(`${t.name} (${n})`);
    else if (n === 0) buckets.emptyUnused.push(t.name);
    else buckets.history.push(`${t.name} (${n})`);
  }
  console.log(`TOTAL: ${tables.length} tables`);
  console.log(`\nCORE (web app, keep): ${buckets.core.length}`);
  console.log(`JUNK/SCRATCH (archive): ${buckets.junk.length}`);
  console.log(buckets.junk.join(', '));
  console.log(`\nEMPTY + UNUSED (archive): ${buckets.emptyUnused.length}`);
  console.log(`\nOTHER ERP HISTORY with data (keep for now): ${buckets.history.length}`);
  console.log(buckets.history.join(', '));
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
