'use strict';
const db      = require('./db');
const bcrypt  = require('bcryptjs');

const isPg = !!(process.env.DATABASE_URL || process.env.DB_TYPE === 'postgres');

// Helper: AUTO_INCREMENT -> SERIAL (postgres), TINYINT(1) -> BOOLEAN
function sql(q) {
  if (!isPg) return q;
  return q
    .replace(/INT AUTO_INCREMENT PRIMARY KEY/g, 'SERIAL PRIMARY KEY')
    .replace(/TINYINT\(1\)/g, 'SMALLINT')
    .replace(/MEDIUMTEXT/g, 'TEXT')
    .replace(/VARCHAR\((\d+)\)/g, 'VARCHAR($1)')
    .replace(/ENUM\([^)]+\)/g, 'VARCHAR(30)')
    .replace(/JSON/g, 'TEXT')
    .replace(/TIMESTAMP DEFAULT CURRENT_TIMESTAMP/g, 'TIMESTAMP DEFAULT NOW()')
    .replace(/TIMESTAMP NULL/g, 'TIMESTAMP')
    .replace(/charset=utf8mb4/gi, '')
    .replace(/ENGINE=InnoDB[^;]*/gi, '');
}

async function migrate() {
  const c = await db.getConnection();
  try {
    const ifNotExists = isPg ? 'IF NOT EXISTS' : 'IF NOT EXISTS';

    await c.query(sql(`CREATE TABLE IF NOT EXISTS admins (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`));

    await c.query(sql(`CREATE TABLE IF NOT EXISTS settings (
      key_name VARCHAR(100) PRIMARY KEY,
      value TEXT
    )`));

    await c.query(sql(`CREATE TABLE IF NOT EXISTS games (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(50) UNIQUE NOT NULL,
      name VARCHAR(100) NOT NULL,
      category VARCHAR(30) DEFAULT 'game',
      icon VARCHAR(10) DEFAULT '🎮',
      icon_url TEXT,
      banner_url TEXT,
      is_active TINYINT(1) DEFAULT 1,
      is_trending TINYINT(1) DEFAULT 0,
      sort_order INT DEFAULT 0,
      instructions TEXT,
      fields TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`));

    await c.query(sql(`CREATE TABLE IF NOT EXISTS packages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      game_id INT NOT NULL,
      game_code VARCHAR(50) NOT NULL,
      name VARCHAR(150) NOT NULL,
      sku VARCHAR(100) NOT NULL,
      base_price INT NOT NULL DEFAULT 0,
      sell_price INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) DEFAULT 1,
      is_flash TINYINT(1) DEFAULT 0,
      notes TEXT,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`));

    await c.query(sql(`CREATE TABLE IF NOT EXISTS banners (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(150),
      image_url TEXT NOT NULL,
      link_url TEXT,
      is_active TINYINT(1) DEFAULT 1,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`));

    await c.query(sql(`CREATE TABLE IF NOT EXISTS orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id VARCHAR(30) UNIQUE NOT NULL,
      game_id INT,
      game_code VARCHAR(50),
      game_name VARCHAR(100),
      package_id INT,
      package_name VARCHAR(150),
      sku VARCHAR(100),
      customer_no VARCHAR(100),
      zone_id VARCHAR(50),
      customer_name VARCHAR(100),
      customer_wa VARCHAR(20),
      sell_price INT DEFAULT 0,
      fee INT DEFAULT 0,
      total INT DEFAULT 0,
      payment_method VARCHAR(30),
      payment_status VARCHAR(20) DEFAULT 'unpaid',
      topup_status VARCHAR(20) DEFAULT 'pending',
      pay_url TEXT,
      pay_code TEXT,
      pay_qr TEXT,
      sn TEXT,
      digiflazz_ref VARCHAR(100),
      paid_at TIMESTAMP,
      completed_at TIMESTAMP,
      expired_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`));

    // Default settings
    const defaults = [
      ['site_name','TopUp Game'],['site_tagline','Top Up Game Murah & Cepat'],
      ['site_logo',''],['admin_wa',''],['fonnte_token',''],
      ['digiflazz_username',''],['digiflazz_api_key',''],['digiflazz_mode','development'],
      ['tokopay_merchant_id',''],['tokopay_secret_key',''],
      ['tokopay_base_url','https://api.tokopay.id'],
      ['wa_notif_admin','0'],['wa_notif_buyer','1'],
      ['footer_text','© 2025 TopUp Game. Semua hak dilindungi.'],
      ['primary_color','#ff6b1a'],['markup_pct','0'],
    ];

    for (const [k,v] of defaults) {
      if (isPg) {
        await c.query(`INSERT INTO settings (key_name,value) VALUES ($1,$2) ON CONFLICT (key_name) DO NOTHING`, [k,v]);
      } else {
        await c.query('INSERT IGNORE INTO settings (key_name,value) VALUES (?,?)', [k,v]);
      }
    }

    // Default admin
    const user = process.env.ADMIN_USERNAME || 'admin';
    const pass = process.env.ADMIN_PASSWORD || 'admin123';
    const hash = await bcrypt.hash(pass, 10);
    if (isPg) {
      await c.query(`INSERT INTO admins (username,password) VALUES ($1,$2) ON CONFLICT (username) DO NOTHING`, [user, hash]);
    } else {
      await c.query('INSERT IGNORE INTO admins (username,password) VALUES (?,?)', [user, hash]);
    }

    console.log('[Migrate] Selesai ✅');
  } catch(e) {
    console.error('[Migrate] Error:', e.message);
  } finally {
    c.release();
  }
}

module.exports = migrate;
