const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT) || 3306,
  database:           process.env.DB_NAME     || 'gameflash',
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASS     || '',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  timezone:           '+07:00',
  // FIX: Tambah timeout agar DB tidak hang selamanya saat Railway cold start
  connectTimeout:     10000,  // 10 detik untuk buka koneksi baru
  acquireTimeout:     10000,  // 10 detik untuk ambil koneksi dari pool
});

module.exports = pool;
