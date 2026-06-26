const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host: 'localhost', user: 'root', password: 'admin@123', database: 'travels' });
  const [r] = await c.query("DELETE FROM master_audit WHERE record_name = 'AUDIT TEST PACKAGE'");
  console.log('cleaned audit test rows:', r.affectedRows);
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
