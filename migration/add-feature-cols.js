/** Columns for soft-delete (payments) and forced-password-change (users). Idempotent. */
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host: 'localhost', user: 'root', password: 'admin@123', database: 'travels' });
  const addCol = async (table, col, def) => {
    const [x] = await c.query(
      `SELECT COUNT(*) AS n FROM information_schema.columns
       WHERE table_schema=DATABASE() AND table_name=? AND column_name=?`, [table, col]);
    if (x[0].n === 0) { await c.query(`ALTER TABLE \`${table}\` ADD COLUMN ${col} ${def}`); console.log(`added ${table}.${col}`); }
    else console.log(`${table}.${col} exists`);
  };
  await addCol('UmrahPayment', 'is_deleted', 'TINYINT(1) NOT NULL DEFAULT 0');
  await addCol('UmrahPayment', 'deleted_at', 'DATETIME NULL');
  await addCol('UmrahPayment', 'deleted_by_name', 'VARCHAR(100) NULL');
  await addCol('app_users', 'must_change_password', 'TINYINT(1) NOT NULL DEFAULT 0');
  // migrated users (jassim, faheem) still hold their issued temp passwords → force change
  const [r] = await c.query("UPDATE app_users SET must_change_password=1 WHERE username IN ('jassim','faheem') AND last_login IS NULL");
  console.log(`flagged ${r.affectedRows} migrated user(s) to change password on next login`);
  await c.end();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
