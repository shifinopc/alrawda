/**
 * Reset the new-document number counters so the FIRST document created after a
 * migration starts at 0001 for every type/period.
 *
 * Why this is safe with the "keep old data, new from 1" plan:
 *   - Old/migrated invoices keep their original InvoiceNo and have created_at = NULL,
 *     so they always print their RAW number (e.g. 8457) — see backend/src/docNumber.js:34.
 *   - New invoices set created_at = NOW() and draw their sequence from doc_counter,
 *     so they print with the prefix (e.g. INV-2026-0001).
 *   - doc_counter is independent of the invoice rows, so resetting it does NOT touch
 *     any existing data — it only decides where the NEXT new number begins.
 *
 * It also verifies that migrated rows really do have created_at = NULL (raw display)
 * and warns if any are unexpectedly stamped, which would make old docs show a prefix.
 *
 * Usage: node reset-doc-counters.js
 */
const mysql = require('mysql2/promise');

(async () => {
  const c = await mysql.createConnection({
    host: 'localhost', user: 'root', password: 'admin@123', database: 'travels',
  });

  // doc_counter mirrors the DDL in backend/src/docNumber.js so this works on a
  // fresh DB where the app has not allocated a number yet.
  await c.query(`CREATE TABLE IF NOT EXISTS doc_counter (
    doc_type VARCHAR(20) NOT NULL,
    period INT NOT NULL,
    last_no INT NOT NULL DEFAULT 0,
    PRIMARY KEY (doc_type, period)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  const [[before]] = await c.query('SELECT COUNT(*) AS n FROM doc_counter');
  await c.query('TRUNCATE TABLE doc_counter');
  console.log(`doc_counter reset (cleared ${before.n} period row(s)) — next of every type/period = 0001`);

  // Sanity check: old documents must be created_at = NULL so they display raw numbers.
  for (const [tbl, noCol] of [
    ['UmrahInvoice', 'InvoiceNo'],
    ['UmrahReciept', 'RecieptNo'],
    ['UmrahPayment', 'PaymentNo'],
  ]) {
    const [cols] = await c.query(
      `SELECT COLUMN_NAME FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ? AND COLUMN_NAME = 'created_at'`, [tbl]);
    if (!cols.length) { console.log(`  ${tbl}: no created_at column (run add-creator-cols.js first)`); continue; }
    const [[r]] = await c.query(
      `SELECT COUNT(*) AS total,
              SUM(created_at IS NOT NULL) AS stamped
       FROM \`${tbl}\``);
    const stamped = Number(r.stamped || 0);
    if (stamped > 0) {
      console.log(`  WARN ${tbl}: ${stamped}/${r.total} existing rows have created_at set — those will show the NEW prefix, not their raw number.`);
    } else {
      console.log(`  OK   ${tbl}: all ${r.total} existing rows are raw (created_at NULL).`);
    }
  }

  await c.end();
  console.log('\nDone. The next invoice/receipt/payment created in the app will be number 0001 (with prefix); old data is unchanged.');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
