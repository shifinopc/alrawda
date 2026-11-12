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
  // Dates come back as plain strings ('2026-10-31 00:00:00'), not JS Dates. A Date is sent as a
  // UTC instant, so a browser in a timezone behind the server showed the previous day.
  dateStrings: true,
  supportBigNumbers: true,
  namedPlaceholders: true,
});

async function query(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

module.exports = { pool, query };
