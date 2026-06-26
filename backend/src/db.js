const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'travels',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: false,
  supportBigNumbers: true,
  namedPlaceholders: true,
});

async function query(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

module.exports = { pool, query };
