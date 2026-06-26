/**
 * Professionalize the working `travels` database: keep only the travel-agency tables the
 * application uses + a curated set of reference masters; move everything else (other ERP
 * modules, scratch/temp/import, empty tables) into `travels_archive`.
 *
 * SAFE & REVERSIBLE: uses RENAME TABLE (instant, cross-schema) — no data is dropped.
 * Restore any table with:  RENAME TABLE travels_archive.X TO travels.X;
 *
 * Dry run by default. Pass --apply to execute.
 */
const mysql = require('mysql2/promise');

// Tables the web application reads/writes (confirmed by grepping the backend) + new app tables
const USED = [
  'UmrahInvoice', 'UmrahReciept', 'UmrahPayment', 'UmrahPassengers', 'UmrahPackage', 'UmrahVisaType',
  'AdminCountryInfo', 'AdminCurrencyInfo', 'AdminCompanyInfo', 'AdminBranchInfo',
  'sopCustomerInfo', 'AdminUserMaster', 'adminUserAudit',
  'app_users', 'app_settings', 'app_login_audit', 'master_audit', 'activity_log',
  'receipt_request', 'receipt_request_dtl',
];

// Travel-relevant reference masters worth keeping in the working DB (not archived)
const KEEP_REFERENCE = [
  'VisaRequiredTable', 'AdminAirportInfo', 'AdminBankInfo', 'City', 'Area', 'DocumentTypeMaster',
  'AdminSettings', 'AdminAdminSettings', 'AdminSystemMaster', 'AdminUserCategoryInfo',
  'AdminYearInfo', 'AdminMonthInfo', 'AdminFinancialPeriodInfo',
  'sopCustCategoryInfo', 'sopPaymentScheduleInfo', 'purchaseSupplierInfo',
  'adminReligionInfo', 'BloodGroupInfo', 'MaritalStatus', 'IdType', 'AdminDepartmentInfo',
];

const KEEP = new Set([...USED, ...KEEP_REFERENCE].map((s) => s.toLowerCase()));

(async () => {
  const apply = process.argv.includes('--apply');
  const c = await mysql.createConnection({ host: 'localhost', user: 'root', password: 'admin@123', database: 'travels' });

  const [tables] = await c.query(
    `SELECT TABLE_NAME AS name FROM information_schema.tables
     WHERE table_schema='travels' AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME`);
  const toArchive = tables.map((t) => t.name).filter((n) => !KEEP.has(n.toLowerCase()));
  const kept = tables.map((t) => t.name).filter((n) => KEEP.has(n.toLowerCase()));

  console.log(`Working DB has ${tables.length} tables.`);
  console.log(`KEEP in travels: ${kept.length}`);
  console.log(`ARCHIVE to travels_archive: ${toArchive.length}`);

  if (!apply) {
    console.log('\n--- DRY RUN (pass --apply to execute) ---');
    console.log('\nKept tables:\n' + kept.join(', '));
    await c.end();
    return;
  }

  await c.query('CREATE DATABASE IF NOT EXISTS travels_archive CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  await c.query('SET FOREIGN_KEY_CHECKS=0');
  let moved = 0, failed = [];
  for (const name of toArchive) {
    try {
      await c.query(`RENAME TABLE \`travels\`.\`${name}\` TO \`travels_archive\`.\`${name}\``);
      moved++;
    } catch (e) {
      failed.push(`${name}: ${e.message}`);
    }
  }
  await c.query('SET FOREIGN_KEY_CHECKS=1');
  const [[{ left }]] = await c.query(
    `SELECT COUNT(*) AS left FROM information_schema.tables WHERE table_schema='travels' AND TABLE_TYPE='BASE TABLE'`);
  console.log(`\nArchived ${moved} tables. Working DB now has ${left} tables.`);
  if (failed.length) console.log('FAILED:\n' + failed.join('\n'));
  await c.end();
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
