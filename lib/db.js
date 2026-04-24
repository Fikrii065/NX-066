'use strict';
const mysql = require('mysql2/promise');

// Coba semua kemungkinan nama variable Railway MySQL
const host = process.env.DB_HOST
  || process.env.MYSQLHOST
  || process.env.MYSQL_HOST
  || process.env.RAILWAY_TCP_PROXY_DOMAIN
  || 'localhost';

const port = parseInt(
  process.env.DB_PORT
  || process.env.MYSQLPORT
  || process.env.MYSQL_PORT
  || process.env.RAILWAY_TCP_PROXY_PORT
  || '3306'
);

const user = process.env.DB_USER
  || process.env.MYSQLUSER
  || process.env.MYSQL_USER
  || 'root';

const password = process.env.DB_PASS
  || process.env.MYSQLPASSWORD
  || process.env.MYSQL_PASSWORD
  || process.env.MYSQL_ROOT_PASSWORD
  || '';

const database = process.env.DB_NAME
  || process.env.MYSQLDATABASE
  || process.env.MYSQL_DATABASE
  || 'railway';

console.log(`[DB] Config: user=${user} host=${host} port=${port} db=${database}`);

// Log semua env vars yang ada (untuk debug)
const dbVars = Object.keys(process.env).filter(k => 
  k.includes('MYSQL') || k.includes('DB_') || k.includes('RAILWAY')
);
console.log('[DB] Available env vars:', dbVars.join(', ') || 'NONE');

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
