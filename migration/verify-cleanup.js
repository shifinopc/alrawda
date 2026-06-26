const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host: 'localhost', user: 'root', password: 'admin@123' });
  const [[a]] = await c.query(`SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema='travels' AND TABLE_TYPE='BASE TABLE'`);
  const [[b]] = await c.query(`SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema='travels_archive' AND TABLE_TYPE='BASE TABLE'`);
  console.log(`travels: ${a.n} tables | travels_archive: ${b.n} tables`);
  const [rows] = await c.query(`SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema='travels' AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME`);
  console.log('\nWorking DB tables:\n' + rows.map((r) => r.name).join(', '));
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
