const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host: 'localhost', user: 'root', password: 'admin@123', database: 'travels' });
  // derive entity from the stored path: '/api/<entity>/...' → '<entity>'
  const [r] = await c.query(
    `UPDATE activity_log
     SET entity = SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(path, '/api/', -1), '?', 1), '/', 1)
     WHERE (entity IS NULL OR entity = '') AND path LIKE '/api/%'`
  );
  console.log(`backfilled entity on ${r.affectedRows} activity rows`);
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
