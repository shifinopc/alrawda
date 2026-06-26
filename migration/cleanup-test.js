const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host: 'localhost', user: 'root', password: 'admin@123', database: 'travels' });
  const [r1] = await c.query(`DELETE FROM UmrahReciept WHERE InvoiceCode IN (SELECT InvoiceCode FROM UmrahInvoice WHERE CustomerName='E2E TEST CUSTOMER')`);
  const [r2] = await c.query(`DELETE FROM UmrahPassengers WHERE InvoiceCode IN (SELECT InvoiceCode FROM UmrahInvoice WHERE CustomerName='E2E TEST CUSTOMER')`);
  const [r3] = await c.query(`DELETE FROM UmrahInvoice WHERE CustomerName='E2E TEST CUSTOMER'`);
  console.log(`deleted: receipts=${r1.affectedRows} passengers=${r2.affectedRows} invoices=${r3.affectedRows}`);
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
