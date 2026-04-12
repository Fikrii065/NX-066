require('dotenv').config();
const fs    = require('fs');
const path  = require('path');
const mysql = require('mysql2/promise');

async function migrate() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'railway',
  });

  console.log('🔌 Terhubung ke MySQL...');

  const sqlFile = path.join(__dirname, 'database.sql');
  if (!fs.existsSync(sqlFile)) {
    console.error('❌ File database.sql tidak ditemukan');
    process.exit(1);
  }

  const sql = fs.readFileSync(sqlFile, 'utf8');

  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  let ok = 0, skip = 0;
  for (const stmt of statements) {
    try {
      await conn.query(stmt);
      ok++;
    } catch (err) {
      if (
        err.message.includes('already exists') ||
        err.message.includes('Duplicate entry')
      ) {
        skip++;
      } else {
        console.error('❌ Error:', err.message);
        console.error('   Statement:', stmt.substring(0, 80));
      }
    }
  }

  console.log(`✅ Migrasi selesai! (${ok} sukses, ${skip} dilewati)`);
  console.log('   Default admin: admin / admin123');
  await conn.end();
}

migrate().catch(err => {
  console.error('❌ Migrasi gagal:', err.message);
  process.exit(1);
});
