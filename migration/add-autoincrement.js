/** Add AUTO_INCREMENT to PKs of transactional tables the web app inserts into. */
const mysql = require('mysql2/promise');

const TARGETS = [
  ['UmrahInvoice', 'InvoiceCode'],
  ['UmrahReciept', 'RecieptCode'],
  ['UmrahPayment', 'PaymentCode'],
  ['UmrahPackage', 'PackageCode'],
  ['UmrahVisaType', 'VisaTypeCode'],
];

(async () => {
  const c = await mysql.createConnection({ host: 'localhost', user: 'root', password: 'admin@123', database: 'travels' });
  for (const [tbl, col] of TARGETS) {
    const [pk] = await c.query(
      `SELECT COUNT(*) AS c FROM information_schema.table_constraints
       WHERE table_schema='travels' AND table_name=? AND constraint_type='PRIMARY KEY'`, [tbl]);
    const addPk = pk[0].c === 0 ? `, ADD PRIMARY KEY (\`${col}\`)` : '';
    await c.query(`ALTER TABLE \`${tbl}\` MODIFY \`${col}\` INT NOT NULL AUTO_INCREMENT${addPk}`);
    const [[m]] = await c.query(`SELECT AUTO_INCREMENT AS ai FROM information_schema.tables WHERE table_schema='travels' AND table_name=?`, [tbl]);
    console.log(`OK ${tbl}.${col} AUTO_INCREMENT (next = ${m.ai})`);
  }
  await c.end();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
