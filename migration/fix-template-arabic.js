const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host: 'localhost', user: 'root', password: 'admin@123', database: 'travels', charset: 'utf8mb4' });
  const [rows] = await c.query("SELECT v FROM app_settings WHERE k='printTemplate'");
  if (!rows.length) { console.log('no saved template'); await c.end(); return; }
  const tpl = JSON.parse(rows[0].v);
  tpl.headerLine2 = 'الروضة للحج والعمرة';
  // repair any other mangled values (all-question-mark strings)
  for (const [k, v] of Object.entries(tpl)) {
    if (typeof v === 'string' && /^[?\s]+$/.test(v) && v.includes('?')) delete tpl[k];
  }
  await c.query("UPDATE app_settings SET v=? WHERE k='printTemplate'", [JSON.stringify(tpl)]);
  console.log('repaired headerLine2:', tpl.headerLine2);
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
