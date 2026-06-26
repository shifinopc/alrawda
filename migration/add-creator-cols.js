/** Add creator tracking columns to invoice / receipt / payment tables (idempotent). */
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host: 'localhost', user: 'root', password: 'admin@123', database: 'travels' });
  for (const tbl of ['UmrahInvoice', 'UmrahReciept', 'UmrahPayment']) {
    const [cols] = await c.query(
      `SELECT COLUMN_NAME FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ?`, [tbl]);
    const have = new Set(cols.map((x) => x.COLUMN_NAME));
    if (!have.has('created_by')) await c.query(`ALTER TABLE ${tbl} ADD COLUMN created_by INT NULL`);
    if (!have.has('created_by_name')) await c.query(`ALTER TABLE ${tbl} ADD COLUMN created_by_name VARCHAR(100) NULL`);
    if (!have.has('created_at')) await c.query(`ALTER TABLE ${tbl} ADD COLUMN created_at DATETIME NULL`);
    console.log(`${tbl}: creator columns ready`);
  }
  await c.end();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
