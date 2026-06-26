const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host: 'localhost', user: 'root', password: 'admin@123', database: 'travels' });
  const [r] = await c.query(
    `SELECT CurrencyCode, TRIM(CurrShortName) AS s, TRIM(CurrName) AS n, TRIM(IFNULL(Symbol,'')) AS sym
     FROM AdminCurrencyInfo ORDER BY CurrencyCode`);
  console.log(JSON.stringify(r));
  const [co] = await c.query('SELECT CompanyCode, HCurrencyCode FROM AdminCompanyInfo');
  console.log('company:', JSON.stringify(co));
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
