'use strict';
const db = require('./db');
const bcrypt = require('bcryptjs');

async function migrate() {
  const c = await db.getConnection();
  try {
    await c.query(`CREATE TABLE IF NOT EXISTS admins (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    await c.query(`CREATE TABLE IF NOT EXISTS settings (
      key_name VARCHAR(100) PRIMARY KEY,
      value MEDIUMTEXT
    )`);

    await c.query(`CREATE TABLE IF NOT EXISTS games (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(50) UNIQUE NOT NULL,
      name VARCHAR(100) NOT NULL,
      category ENUM('game','pulsa','ewallet','voucher','streaming','lainnya') DEFAULT 'game',
      icon VARCHAR(10) DEFAULT '🎮',
      icon_url TEXT,
      banner_url TEXT,
      is_active TINYINT(1) DEFAULT 1,
      is_trending TINYINT(1) DEFAULT 0,
      sort_order INT DEFAULT 0,
      instructions TEXT,
      fields JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    await c.query(`CREATE TABLE IF NOT EXISTS packages (
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    )`);

    await c.query(`CREATE TABLE IF NOT EXISTS banners (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(150),
      image_url TEXT NOT NULL,
      link_url TEXT,
      is_active TINYINT(1) DEFAULT 1,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    await c.query(`CREATE TABLE IF NOT EXISTS orders (
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
      payment_status ENUM('unpaid','paid','expired','failed') DEFAULT 'unpaid',
      topup_status ENUM('pending','processing','success','failed') DEFAULT 'pending',
      pay_url TEXT,
      pay_code TEXT,
      pay_qr TEXT,
      sn TEXT,
      digiflazz_ref VARCHAR(100),
      paid_at TIMESTAMP NULL,
      completed_at TIMESTAMP NULL,
      expired_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Default settings
    const defaults = [
      ['site_name','TopUp Game'],
      ['site_tagline','Top Up Game Murah & Cepat'],
      ['site_logo',''],
      ['admin_wa',''],
      ['fonnte_token',''],
      ['digiflazz_username',''],
      ['digiflazz_api_key',''],
      ['digiflazz_mode','development'],
      ['tokopay_merchant_id',''],
      ['tokopay_secret_key',''],
      ['tokopay_base_url','https://api.tokopay.id'],
      ['wa_notif_admin','0'],
      ['wa_notif_buyer','1'],
      ['footer_text','© 2025 TopUp Game. Semua hak dilindungi.'],
      ['primary_color','#6c5ce7'],
      ['hero_bg','#0d0d1a'],
      ['markup_pct','0'],
    ];
    for (const [k,v] of defaults) {
      await c.query('INSERT IGNORE INTO settings (key_name,value) VALUES (?,?)', [k,v]);
    }

    // Default admin
    const user = process.env.ADMIN_USERNAME || 'admin';
    const pass = process.env.ADMIN_PASSWORD || 'admin123';
    const hash = await bcrypt.hash(pass, 10);
    await c.query('INSERT IGNORE INTO admins (username,password) VALUES (?,?)', [user, hash]);

    console.log('[Migrate] Selesai ✅');
  } finally {
    c.release();
  }
}

module.exports = migrate;
