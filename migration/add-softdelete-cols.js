// Adds soft-delete columns to UmrahInvoice and UmrahReciept (idempotent).
const mysql = require('mysql2/promise');

const COLS = [
  ['is_deleted', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ['deleted_at', 'DATETIME NULL'],
  ['deleted_by_name', 'VARCHAR(100) NULL'],
];

(async () => {
  const c = await mysql.createConnection({ host: 'localhost', port: 3306, user: 'root', password: 'admin@123', database: 'travels' });
  for (const table of ['UmrahInvoice', 'UmrahReciept']) {
    const [have] = await c.query(
      "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=?",
      [table]
    );
    const names = new Set(have.map((r) => r.COLUMN_NAME));
    for (const [col, def] of COLS) {
      if (!names.has(col)) {
        await c.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
        console.log(`Added ${table}.${col}`);
      } else {
        console.log(`${table}.${col} already exists`);
      }
    }
    await c.query(`UPDATE ${table} SET is_deleted = 0 WHERE is_deleted IS NULL`);
  }
  await c.end();
  console.log('Done.');
})().catch((e) => { console.error(e.message); process.exit(1); });
