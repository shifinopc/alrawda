/**
 * Build the clean production database `travelsnew` from the proven `travels` DB.
 *
 *  1. Mirror every base table of `travels` into `travelsnew` (structure + data),
 *     same MySQL server so it's a direct CREATE TABLE LIKE + INSERT SELECT.
 *  2. Remove development/test transactional rows — anything the WEB APP created
 *     during development carries created_at IS NOT NULL (real historical rows are
 *     created_at NULL). That cleanly drops the 6 test invoices and any test
 *     receipts/payments, plus the passengers of deleted invoices.
 *  3. Reset doc_counter so the first NEW document starts at 0001.
 *
 * `travels` is only ever READ here; re-running rebuilds travelsnew from scratch.
 * Usage: node clone-to-travelsnew.js
 */
const mysql = require('mysql2/promise');

const SRC = 'travels';
const DST = 'travelsnew';

(async () => {
  const c = await mysql.createConnection({
    host: 'localhost', port: 3306, user: 'root', password: 'admin@123',
    multipleStatements: false,
  });
  const q = async (s, p) => { const [r] = await c.query(s, p); return r; };

  await c.query('SET SESSION foreign_key_checks=0');
  await c.query('SET SESSION unique_checks=0');
  await c.query(`CREATE DATABASE IF NOT EXISTS \`${DST}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  // wipe any existing tables in DST for a clean rebuild
  const dstTables = await q(
    `SELECT TABLE_NAME AS t FROM information_schema.tables
     WHERE table_schema=? AND TABLE_TYPE='BASE TABLE'`, [DST]);
  for (const { t } of dstTables) await c.query(`DROP TABLE IF EXISTS \`${DST}\`.\`${t}\``);
  if (dstTables.length) console.log(`cleared ${dstTables.length} pre-existing table(s) in ${DST}`);

  // copy every base table from SRC
  const srcTables = await q(
    `SELECT TABLE_NAME AS t FROM information_schema.tables
     WHERE table_schema=? AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME`, [SRC]);
  let copied = 0, rows = 0, failed = [];
  for (const { t } of srcTables) {
    try {
      await c.query(`CREATE TABLE \`${DST}\`.\`${t}\` LIKE \`${SRC}\`.\`${t}\``);
      const r = await q(`INSERT INTO \`${DST}\`.\`${t}\` SELECT * FROM \`${SRC}\`.\`${t}\``);
      copied++; rows += r.affectedRows || 0;
    } catch (e) {
      failed.push(`${t}: ${e.message}`);
      console.log(`FAIL ${t} — ${e.message}`);
    }
  }
  console.log(`copied ${copied}/${srcTables.length} tables, ${rows} rows total`);
  if (failed.length) console.log('FAILURES:\n  ' + failed.join('\n  '));

  // ---- strip development/test transactional data (created_at IS NOT NULL) ----
  await c.query(`USE \`${DST}\``);
  const before = {};
  for (const t of ['UmrahInvoice', 'UmrahReciept', 'UmrahPayment']) {
    const [r] = await c.query(`SELECT COUNT(*) n FROM \`${t}\` WHERE created_at IS NOT NULL`);
    before[t] = r[0].n;
  }
  // passengers belong to invoices; remove those tied to the test invoices first
  const delPax = await q(
    `DELETE FROM UmrahPassengers WHERE InvoiceCode IN
       (SELECT InvoiceCode FROM UmrahInvoice WHERE created_at IS NOT NULL)`);
  const delRec = await q('DELETE FROM UmrahReciept WHERE created_at IS NOT NULL');
  const delPay = await q('DELETE FROM UmrahPayment WHERE created_at IS NOT NULL');
  const delInv = await q('DELETE FROM UmrahInvoice WHERE created_at IS NOT NULL');
  console.log(`removed dev/test rows — invoices ${delInv.affectedRows}, receipts ${delRec.affectedRows}, payments ${delPay.affectedRows}, passengers ${delPax.affectedRows}`);

  // ---- reset new-document counters so the first new doc = 0001 ----
  await c.query(`CREATE TABLE IF NOT EXISTS doc_counter (
    doc_type VARCHAR(20) NOT NULL, period INT NOT NULL, last_no INT NOT NULL DEFAULT 0,
    PRIMARY KEY (doc_type, period)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await c.query('TRUNCATE TABLE doc_counter');
  console.log('doc_counter reset — next invoice/receipt/payment = 0001 (with prefix)');

  // ---- final verification ----
  console.log('\n=== travelsnew final counts ===');
  for (const t of ['UmrahInvoice', 'UmrahReciept', 'UmrahPayment', 'UmrahPassengers', 'sopCustomerInfo', 'app_users']) {
    try {
      const [r] = await c.query(`SELECT COUNT(*) n FROM \`${t}\``);
      const [mx] = t === 'UmrahInvoice'
        ? await c.query('SELECT MAX(InvoiceNo) mx, SUM(created_at IS NOT NULL) appnew FROM UmrahInvoice')
        : [[{}]];
      console.log(t.padEnd(16), String(r[0].n).padStart(7),
        t === 'UmrahInvoice' ? `| maxNo=${mx[0].mx} app-created=${mx[0].appnew}` : '');
    } catch (e) { console.log(t.padEnd(16), 'ERR', e.message); }
  }
  await c.end();
  console.log('\nDone. travelsnew is the clean go-live DB.');
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
