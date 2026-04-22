'use strict';
const mysql = require('mysql2/promise');

// Auto-detect semua kemungkinan nama variable Railway MySQL
const host = process.env.MYSQLHOST || process.env.DB_HOST || process.env.MYSQL_HOST || 'localhost';
const port = parseInt(process.env.MYSQLPORT || process.env.DB_PORT || process.env.MYSQL_PORT || '3306');
const user = process.env.MYSQLUSER || process.env.DB_USER || process.env.MYSQL_USER || 'root';
const password = process.env.MYSQLPASSWORD || process.env.MYSQL_ROOT_PASSWORD || process.env.DB_PASS || process.env.MYSQL_PASSWORD || '';
const database = process.env.MYSQLDATABASE || process.env.DB_NAME || process.env.MYSQL_DATABASE || 'railway';

console.log(`[DB] Connecting: ${user}@${host}:${port}/${database}`);

const pool = mysql.createPool({
  host, port, user, password, database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 20000,
  timezone: 'Z',
});

pool.getConnection()
  .then(c => { console.log('[DB] Connected ✅'); c.release(); })
  .catch(e => console.error('[DB] Connection failed:', e.message));

module.exports = pool;
