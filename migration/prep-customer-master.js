/** Prepare sopCustomerInfo as the web customer master: PK + AUTO_INCREMENT on CustomerCode. */
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host: 'localhost', user: 'root', password: 'admin@123', database: 'travels' });
  const [pk] = await c.query(
    `SELECT COUNT(*) AS c FROM information_schema.table_constraints
     WHERE table_schema='travels' AND table_name='sopCustomerInfo' AND constraint_type='PRIMARY KEY'`);
  const addPk = pk[0].c === 0 ? ', ADD PRIMARY KEY (`CustomerCode`)' : '';
  await c.query(`ALTER TABLE sopCustomerInfo MODIFY CustomerCode INT NOT NULL AUTO_INCREMENT${addPk}`);
  const [[m]] = await c.query(
    `SELECT AUTO_INCREMENT AS ai FROM information_schema.tables
     WHERE table_schema='travels' AND table_name='sopCustomerInfo'`);
  const [[{ total }]] = await c.query('SELECT COUNT(*) AS total FROM sopCustomerInfo');
  console.log(`sopCustomerInfo ready — ${total} existing rows, next code ${m.ai}`);
  await c.end();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
