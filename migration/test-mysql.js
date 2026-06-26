const mysql = require('mysql2/promise');

(async () => {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost', port: 3306, user: 'root', password: 'admin@123',
      connectTimeout: 10000,
    });
    const [ver] = await conn.query('SELECT VERSION() AS v');
    console.log('MySQL version:', ver[0].v);
    const [dbs] = await conn.query("SHOW DATABASES LIKE 'travels'");
    console.log('travels db exists:', dbs.length > 0);
    if (dbs.length) {
      const [tbls] = await conn.query("SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema='travels'");
      console.log('tables in travels:', tbls[0].c);
    }
    await conn.end();
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exit(1);
  }
})();
