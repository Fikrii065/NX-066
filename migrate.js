require('dotenv').config();
const fs    = require('fs');
const path  = require('path');
const mysql = require('mysql2/promise');

async function migrate() {
  const conn = await mysql.createConnection({
    host:             process.env.DB_HOST || 'localhost',
    port:             parseInt(process.env.DB_PORT) || 3306,
    user:             process.env.DB_USER || 'root',
    password:         process.env.DB_PASS || '',
    multiStatements:  true,
  });

  console.log('🔌 Terhubung ke MySQL...');

  const sqlFile = path.join(__dirname, 'database.sql');
  if (!fs.existsSync(sqlFile)) {
    console.error('❌ File database.sql tidak ditemukan');
    process.exit(1);
  }

  const sql = fs.readFileSync(sqlFile, 'utf8');

  try {
    await conn.query(sql);
    console.log('✅ Migrasi database berhasil!');
    console.log('   Default admin: admin / admin123');
  } catch (err) {
    if (err.message && err.message.includes('already exists')) {
      console.log('✅ Tabel sudah ada, skip migrasi.');
    } else {
      console.error('❌ Migrasi gagal:', err.message);
      process.exit(1);
    }
  } finally {
    await conn.end();
  }
}

migrate();
