'use strict';
require('dotenv').config();

// Render free tier pakai PostgreSQL
// Tapi kita tetap support MySQL jika ada DB_HOST manual
const usePostgres = process.env.DATABASE_URL || process.env.DB_TYPE === 'postgres';

let pool;

if (usePostgres) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
  // Wrapper agar API sama dengan mysql2
  pool.query = async function(sql, params) {
    // Convert MySQL ? placeholders to PostgreSQL $1, $2...
    let i = 0;
    const pgSql = sql.replace(/\?/g, () => `$${++i}`);
    const result = await pool._query(pgSql, params);
    return [result.rows, result.fields];
  };
  pool._query = pool.query.bind(pool);
  pool.getConnection = async () => {
    const client = await pool.connect();
    client.query = async (sql, params) => {
      let i = 0;
      const pgSql = sql.replace(/\?/g, () => `$${++i}`);
      const result = await client._query(pgSql, params);
      return [result.rows, result.fields];
    };
    client._query = client.query.bind(client);
    client.release = client.release.bind(client);
    return client;
  };
} else {
  const mysql = require('mysql2/promise');
  pool = mysql.createPool({
    host:     process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'topupgame',
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4'
  });
}

module.exports = pool;
