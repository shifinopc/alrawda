const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host: 'localhost', user: 'root', password: 'admin@123', database: 'travels' });
  // revert the receipt approved during the workflow test (12752 was Open before)
  const [r1] = await c.query(`UPDATE UmrahReciept SET ReceiptApproved = NULL WHERE RecieptNo = 12752 AND ReceiptApproved = 'Y'`);
  const [r2] = await c.query(`DELETE FROM receipt_request_dtl WHERE request_id IN (SELECT id FROM receipt_request WHERE note = 'E2E workflow test')`);
  const [r3] = await c.query(`DELETE FROM receipt_request WHERE note = 'E2E workflow test'`);
  console.log(`reverted receipt: ${r1.affectedRows}, removed dtl: ${r2.affectedRows}, removed request: ${r3.affectedRows}`);
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
