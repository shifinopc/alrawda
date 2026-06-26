/** Compare row counts: SQL Server Umrah vs MySQL travels. */
const sql = require('mssql/msnodesqlv8');
const mysql = require('mysql2/promise');

(async () => {
  const ms = await sql.connect({
    connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=DESKTOP-4G0I7HU\\SQLEXPRESS;Database=Umrah;UID=sa;PWD=admin@789;TrustServerCertificate=yes;',
    requestTimeout: 120000,
  });
  const my = await mysql.createConnection({
    host: 'localhost', port: 3306, user: 'root', password: 'admin@123', database: 'travels',
  });
  const msRs = await ms.request().query(`
    SELECT t.name, SUM(p.rows) AS rows FROM sys.tables t
    JOIN sys.partitions p ON t.object_id=p.object_id AND p.index_id IN (0,1)
    WHERE t.name <> 'sysdiagrams' GROUP BY t.name`);
  const msCounts = new Map(msRs.recordset.map(r => [r.name.toLowerCase(), Number(r.rows)]));

  let mismatches = 0, missing = 0, checked = 0;
  for (const [tbl, msCount] of msCounts) {
    try {
      const [rows] = await my.query(`SELECT COUNT(*) AS c FROM \`${tbl}\``);
      checked++;
      const myCount = Number(rows[0].c);
      if (myCount !== msCount) { mismatches++; console.log(`MISMATCH ${tbl}: mssql=${msCount} mysql=${myCount}`); }
    } catch {
      missing++; console.log(`MISSING in MySQL: ${tbl}`);
    }
  }
  console.log(`\nChecked ${checked}/${msCounts.size} tables — ${mismatches} count mismatches, ${missing} missing.`);
  await my.end(); await ms.close();
})().catch(e => { console.error(e); process.exit(1); });
