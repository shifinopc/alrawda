/**
 * Migrate desktop AdminUserMaster users into app_users (full migration, no legacy UI).
 * - Links each web user to the desktop UserCode (legacy_user_code) so all history stays attributed.
 * - Renames the seeded 'admin' account to 'hasnain' (same person, password unchanged).
 * - Category mapping: ADMIN -> Admin, PU -> Manager, USR/none -> Employee.
 */
const mysql = require('mysql2/promise');
const bcrypt = require('M:/Travels/backend/node_modules/bcryptjs');

(async () => {
  const c = await mysql.createConnection({
    host: 'localhost', user: 'root', password: 'admin@123', database: 'travels',
  });

  // ensure link column
  const [cols] = await c.query(
    `SELECT COLUMN_NAME FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'app_users'`);
  const have = new Set(cols.map((x) => x.COLUMN_NAME));
  if (!have.has('legacy_user_code')) {
    await c.query('ALTER TABLE app_users ADD COLUMN legacy_user_code INT NULL');
    console.log('added app_users.legacy_user_code');
  }

  // 1) existing seeded admin (display Hasnain) becomes the desktop user Hasnain (UserCode 12)
  const [admin] = await c.query(`SELECT id, username FROM app_users WHERE username IN ('admin','hasnain') ORDER BY id LIMIT 1`);
  if (admin.length) {
    await c.query(
      `UPDATE app_users SET username='hasnain', display_name='Hasnain', legacy_user_code=12,
         department=IFNULL(department,'Management'), designation=IFNULL(designation,'Administrator')
       WHERE id=?`, [admin[0].id]);
    console.log(`linked '${admin[0].username}' -> username 'hasnain', desktop UserCode 12`);
  }

  // 2) create the other desktop users
  const newUsers = [
    { username: 'jassim', display: 'Jassim', role: 'Admin', legacy: 11, dept: 'Management', desig: 'Administrator', pwd: 'jassim@123' },
    { username: 'faheem', display: 'Faheem', role: 'Employee', legacy: 13, dept: 'Operations', desig: 'Counter Staff', pwd: 'faheem@123' },
  ];
  for (const u of newUsers) {
    const [exists] = await c.query('SELECT id FROM app_users WHERE username=?', [u.username]);
    if (exists.length) {
      await c.query('UPDATE app_users SET legacy_user_code=? WHERE id=?', [u.legacy, exists[0].id]);
      console.log(`'${u.username}' already exists — linked desktop UserCode ${u.legacy}`);
      continue;
    }
    const hash = await bcrypt.hash(u.pwd, 10);
    await c.query(
      `INSERT INTO app_users (username, password_hash, display_name, role, active, status,
         department, designation, legacy_user_code)
       VALUES (?,?,?,?,1,'Active',?,?,?)`,
      [u.username, hash, u.display, u.role, u.dept, u.desig, u.legacy]);
    console.log(`created '${u.username}' (${u.role}) — desktop UserCode ${u.legacy}, password ${u.pwd}`);
  }

  const [all] = await c.query(
    'SELECT id, username, display_name, role, status, legacy_user_code FROM app_users ORDER BY id');
  console.table(all);
  await c.end();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
