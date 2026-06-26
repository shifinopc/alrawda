/**
 * SQL Server (Umrah) -> MySQL (travels) full schema + data migration.
 * Usage: node migrate.js [--only=Table1,Table2]
 */
const sql = require('mssql/msnodesqlv8');
const mysql = require('mysql2/promise');

const MSSQL = {
  connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=DESKTOP-4G0I7HU\\SQLEXPRESS;Database=Umrah;UID=sa;PWD=admin@789;TrustServerCertificate=yes;',
  requestTimeout: 300000,
};
const MYSQL = {
  host: 'localhost', port: 3306, user: 'root', password: 'admin@123',
  database: 'travels', connectTimeout: 30000,
  supportBigNumbers: true, bigNumberStrings: false,
  multipleStatements: false,
};

const BATCH_ROWS = 500;
const MAX_ROW_BYTES = 60000; // keep under InnoDB 65535 limit with margin

function mapType(c) {
  const t = c.DATA_TYPE.toLowerCase();
  const len = c.CHARACTER_MAXIMUM_LENGTH;
  const p = c.NUMERIC_PRECISION, s = c.NUMERIC_SCALE;
  switch (t) {
    case 'int': return 'INT';
    case 'bigint': return 'BIGINT';
    case 'smallint': return 'SMALLINT';
    case 'tinyint': return 'TINYINT UNSIGNED';
    case 'bit': return 'TINYINT(1)';
    case 'decimal': case 'numeric': return `DECIMAL(${p},${s})`;
    case 'money': return 'DECIMAL(19,4)';
    case 'smallmoney': return 'DECIMAL(10,4)';
    case 'float': return 'DOUBLE';
    case 'real': return 'FLOAT';
    case 'date': return 'DATE';
    case 'time': return 'TIME(6)';
    case 'datetime': case 'smalldatetime': return 'DATETIME';
    case 'datetime2': case 'datetimeoffset': return 'DATETIME(6)';
    case 'char': case 'nchar': return len > 0 && len <= 255 ? `CHAR(${len})` : 'TEXT';
    case 'varchar': case 'nvarchar': case 'sysname':
      if (len === -1 || len == null) return 'LONGTEXT';
      return len <= 8000 ? `VARCHAR(${len})` : 'TEXT';
    case 'text': case 'ntext': case 'xml': return 'LONGTEXT';
    case 'binary': return `BINARY(${len})`;
    case 'varbinary': return len === -1 ? 'LONGBLOB' : `VARBINARY(${len})`;
    case 'image': return 'LONGBLOB';
    case 'uniqueidentifier': return 'CHAR(36)';
    case 'timestamp': case 'rowversion': return 'BINARY(8)';
    default: return 'LONGTEXT';
  }
}

function varcharBytes(type) {
  const m = type.match(/^(VAR)?CHAR\((\d+)\)$/);
  return m ? parseInt(m[2], 10) * 4 + 2 : 0;
}

function sanitizeValue(v, mt) {
  if (v == null) return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime()) || v.getFullYear() < 1000) return null;
    return v;
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (Buffer.isBuffer(v)) return v;
  if (typeof v === 'string' && (mt === 'CHAR(36)')) return v.toLowerCase();
  return v;
}

(async () => {
  const onlyArg = process.argv.find(a => a.startsWith('--only='));
  const only = onlyArg ? new Set(onlyArg.slice(7).split(',').map(s => s.toLowerCase())) : null;

  const ms = await sql.connect(MSSQL);
  const my = await mysql.createConnection(MYSQL);
  await my.query("SET SESSION sql_mode='NO_ENGINE_SUBSTITUTION'");
  await my.query('SET SESSION foreign_key_checks=0');
  await my.query('SET SESSION unique_checks=0');

  const tablesRs = await ms.request().query(`
    SELECT t.name FROM sys.tables t WHERE t.name <> 'sysdiagrams' ORDER BY t.name`);
  let tables = tablesRs.recordset.map(r => r.name);
  if (only) tables = tables.filter(t => only.has(t.toLowerCase()));

  const colsRs = await ms.request().query(`
    SELECT c.TABLE_NAME, c.COLUMN_NAME, c.ORDINAL_POSITION, c.DATA_TYPE,
           c.CHARACTER_MAXIMUM_LENGTH, c.NUMERIC_PRECISION, c.NUMERIC_SCALE, c.IS_NULLABLE,
           COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA)+'.'+QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'IsIdentity') AS IS_IDENTITY
    FROM INFORMATION_SCHEMA.COLUMNS c
    WHERE c.TABLE_SCHEMA='dbo'
    ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`);
  const colsByTable = {};
  for (const c of colsRs.recordset) {
    (colsByTable[c.TABLE_NAME] = colsByTable[c.TABLE_NAME] || []).push(c);
  }

  const pkRs = await ms.request().query(`
    SELECT ku.TABLE_NAME, ku.COLUMN_NAME, ku.ORDINAL_POSITION
    FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
    JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
      ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME AND tc.TABLE_NAME = ku.TABLE_NAME
    WHERE tc.CONSTRAINT_TYPE='PRIMARY KEY'
    ORDER BY ku.TABLE_NAME, ku.ORDINAL_POSITION`);
  const pkByTable = {};
  for (const k of pkRs.recordset) {
    (pkByTable[k.TABLE_NAME] = pkByTable[k.TABLE_NAME] || []).push(k.COLUMN_NAME);
  }

  let ok = 0, failed = [];
  for (const table of tables) {
    const cols = colsByTable[table];
    if (!cols) { console.log(`SKIP ${table} (no columns)`); continue; }
    try {
      // build DDL with row-size guard
      const defs = cols.map(c => ({ c, type: mapType(c) }));
      let rowBytes = defs.reduce((a, d) => a + varcharBytes(d.type), 0);
      if (rowBytes > MAX_ROW_BYTES) {
        const sorted = [...defs].sort((a, b) => varcharBytes(b.type) - varcharBytes(a.type));
        for (const d of sorted) {
          if (rowBytes <= MAX_ROW_BYTES) break;
          const b = varcharBytes(d.type);
          if (b > 0 && !((pkByTable[table] || []).includes(d.c.COLUMN_NAME))) {
            rowBytes -= b; d.type = 'TEXT';
          }
        }
      }
      const pk = pkByTable[table] || [];
      // MySQL forbids trailing spaces in identifiers; AUTO_INCREMENT only on integer types
      const myName = (n) => n.replace(/\s+$/, '');
      const isIntType = (t) => /^(TINYINT|SMALLINT|INT|BIGINT)/.test(t);
      const lines = defs.map(d => {
        const ident = d.c.IS_IDENTITY === 1 && isIntType(d.type) ? ' AUTO_INCREMENT' : '';
        const nullable = d.c.IS_NULLABLE === 'YES' && !pk.includes(d.c.COLUMN_NAME) ? ' NULL' : ' NOT NULL';
        return `\`${myName(d.c.COLUMN_NAME)}\` ${d.type}${pk.includes(d.c.COLUMN_NAME) || d.c.IS_IDENTITY === 1 ? ' NOT NULL' : nullable}${ident}`;
      });
      if (pk.length) lines.push(`PRIMARY KEY (${pk.map(c => `\`${myName(c)}\``).join(',')})`);
      else {
        const identCol = defs.find(d => d.c.IS_IDENTITY === 1);
        if (identCol) lines.push(`PRIMARY KEY (\`${myName(identCol.c.COLUMN_NAME)}\`)`);
      }
      await my.query(`DROP TABLE IF EXISTS \`${table}\``);
      await my.query(`CREATE TABLE \`${table}\` (\n  ${lines.join(',\n  ')}\n) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

      // copy data
      const countRs = await ms.request().query(`SELECT COUNT_BIG(*) AS c FROM [dbo].[${table}]`);
      const total = Number(countRs.recordset[0].c);
      if (total > 0) {
        const colList = cols.map(c => `[${c.COLUMN_NAME}]`).join(',');
        const myCols = cols.map(c => `\`${myName(c.COLUMN_NAME)}\``).join(',');
        const types = defs.map(d => d.type);
        let copied = 0;
        // stream rows
        const req = new sql.Request(ms);
        req.stream = true;
        let batch = [];
        const flush = async () => {
          if (!batch.length) return;
          const placeholders = batch.map(r => `(${r.map(() => '?').join(',')})`).join(',');
          await my.query(`INSERT INTO \`${table}\` (${myCols}) VALUES ${placeholders}`, batch.flat());
          copied += batch.length;
          batch = [];
        };
        await new Promise((resolve, reject) => {
          const pending = [];
          let paused = false;
          req.on('row', (row) => {
            batch.push(cols.map((c, i) => sanitizeValue(row[c.COLUMN_NAME], types[i])));
            if (batch.length >= BATCH_ROWS && !paused) {
              paused = true; req.pause();
              flush().then(() => { paused = false; req.resume(); }).catch(reject);
            }
          });
          req.on('error', reject);
          req.on('done', () => flush().then(resolve).catch(reject));
          req.query(`SELECT ${colList} FROM [dbo].[${table}]`);
        });
        console.log(`OK   ${table} — ${copied}/${total} rows`);
      } else {
        console.log(`OK   ${table} — empty`);
      }
      ok++;
    } catch (e) {
      failed.push({ table, error: e.message });
      console.log(`FAIL ${table} — ${e.message}`);
    }
  }

  console.log(`\n=== DONE: ${ok}/${tables.length} tables migrated, ${failed.length} failed ===`);
  for (const f of failed) console.log(`  FAILED ${f.table}: ${f.error}`);
  await my.end();
  await ms.close();
  process.exit(failed.length ? 2 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
