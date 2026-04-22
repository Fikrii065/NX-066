const mysql = require('mysql2/promise');

// Railway MySQL bisa pakai nama variable berbeda tergantung cara setup
// Coba semua kemungkinan secara otomatis
const host     = process.env.DB_HOST      || process.env.MYSQLHOST     || process.env.MYSQL_HOST     || 'localhost';
const port     = parseInt(process.env.DB_PORT  || process.env.MYSQLPORT     || process.env.MYSQL_PORT     || '3306');
const database = process.env.DB_NAME      || process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE || process.env.MYSQL_DB || 'railway';
const user     = process.env.DB_USER      || process.env.MYSQLUSER     || process.env.MYSQL_USER     || 'root';
const password = process.env.DB_PASS      || process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD || process.env.MYSQL_ROOT_PASSWORD || '';

console.log(`DB config: ${user}@${host}:${port}/${database}`);

const pool = mysql.createPool({
  host,
  port,
  database,
  user,
  password,
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  timezone:           '+07:00',
  connectTimeout:     15000,
});

module.exports = pool;
