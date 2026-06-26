const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host: 'localhost', user: 'root', password: 'admin@123', database: 'travels' });
  const [r] = await c.query(
    `SELECT TABLE_NAME, COLUMN_NAME, EXTRA FROM information_schema.columns
     WHERE table_schema='travels'
       AND TABLE_NAME IN ('UmrahInvoice','UmrahReciept','UmrahPayment','UmrahPackage','UmrahVisaType','UmrahPassengers','AdminCountryInfo')
       AND ORDINAL_POSITION = 1`);
  for (const x of r) console.log(`${x.TABLE_NAME}.${x.COLUMN_NAME} -> ${x.EXTRA || '(none)'}`);
  await c.end();
})();
