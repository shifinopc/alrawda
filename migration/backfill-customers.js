/** Backfill the customer master (sopCustomerInfo) from invoice history:
 *  one row per distinct customer name, carrying the latest mobile + nationality. */
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host: 'localhost', user: 'root', password: 'admin@123', database: 'travels' });
  // widen columns that are larger on invoices than in the legacy master
  await c.query('ALTER TABLE sopCustomerInfo MODIFY CustomerName VARCHAR(250) NULL, MODIFY MobileNo VARCHAR(50) NULL');
  const [r] = await c.query(`
    INSERT INTO sopCustomerInfo (CustomerName, CountryCode, MobileNo, CustomerStatus)
    SELECT i.CustomerName, i.NatinalityCode, NULLIF(TRIM(IFNULL(i.Mobile1,'')),''), 'Active'
    FROM UmrahInvoice i
    JOIN (
      SELECT CustomerName, MAX(InvoiceCode) AS mx
      FROM UmrahInvoice
      WHERE CustomerName IS NOT NULL AND TRIM(CustomerName) <> ''
      GROUP BY CustomerName
    ) m ON m.CustomerName = i.CustomerName AND m.mx = i.InvoiceCode
    WHERE NOT EXISTS (SELECT 1 FROM sopCustomerInfo s WHERE s.CustomerName = i.CustomerName)`);
  const [[{ total }]] = await c.query('SELECT COUNT(*) AS total FROM sopCustomerInfo');
  console.log(`backfilled ${r.affectedRows} customers from invoices (master total: ${total})`);
  await c.end();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
