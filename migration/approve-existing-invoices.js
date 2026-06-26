// One-off: mark all already-created invoices as Approved.
// New invoices created after the draft/approve feature still start as Pending (Draft).
const mysql = require('mysql2/promise');

(async () => {
  const c = await mysql.createConnection({ host: 'localhost', port: 3306, user: 'root', password: 'admin@123', database: 'travels' });
  const [r] = await c.query("UPDATE UmrahInvoice SET ApprovalStatus='Approved' WHERE TRIM(IFNULL(ApprovalStatus,'Pending'))='Pending'");
  console.log('Approved existing invoices:', r.affectedRows);
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
