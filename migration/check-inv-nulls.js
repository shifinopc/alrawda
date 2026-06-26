const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host: 'localhost', user: 'root', password: 'admin@123', database: 'travels' });
  const [r] = await c.query(
    `SELECT COLUMN_NAME, IS_NULLABLE, DATA_TYPE FROM information_schema.columns
     WHERE table_schema='travels' AND table_name='UmrahInvoice' ORDER BY ORDINAL_POSITION`);
  for (const x of r) console.log(`${x.COLUMN_NAME} ${x.DATA_TYPE} ${x.IS_NULLABLE === 'NO' ? 'NOT NULL' : 'null ok'}`);
  const [z] = await c.query(`SELECT COUNT(*) AS c FROM UmrahInvoice WHERE PackageCode = 0`);
  console.log(`\nlegacy invoices with PackageCode=0: ${z[0].c}`);
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
