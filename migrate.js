require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrate() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'railway',
    multipleStatements: false,
  });

  console.log('🔌 Terhubung ke MySQL...');

  const queries = [
    `CREATE TABLE IF NOT EXISTS admins (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      username VARCHAR(60) NOT NULL UNIQUE,
      email VARCHAR(120) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      role ENUM('superadmin','admin','cs') NOT NULL DEFAULT 'admin',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      last_login DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB`,

    `INSERT IGNORE INTO admins (username, email, password, role) VALUES
      ('admin', 'admin@gameflash.id', '$2a$12$KIX3xWd8R1g.2/0OqvpXzekW5qRGJH7Vx5HHUxpXjLaC2Y1RHxvOy', 'superadmin')`,

    `CREATE TABLE IF NOT EXISTS games (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      code VARCHAR(60) NOT NULL UNIQUE,
      name VARCHAR(100) NOT NULL,
      icon VARCHAR(10) NOT NULL DEFAULT '🎮',
      icon_url MEDIUMTEXT NULL,
      banner_url MEDIUMTEXT NULL,
      params VARCHAR(60) NOT NULL DEFAULT 'userId',
      zone_label VARCHAR(40) NULL,
      vip_code VARCHAR(60) NOT NULL,
      sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_active (is_active, sort_order)
    ) ENGINE=InnoDB`,

    `INSERT IGNORE INTO games (code, name, icon, params, zone_label, vip_code, sort_order, is_active) VALUES
      ('mobile-legends', 'Mobile Legends: Bang Bang', '⚔️', 'userId,zoneId', 'Zone ID', 'mobile-legends', 1, 1),
      ('mobile-legends-region', 'Mobile Legends Region', '🗺️', 'userId,zoneId', 'Zone ID', 'mobile-legends-region', 2, 1),
      ('free-fire', 'Free Fire', '🔥', 'userId', NULL, 'free-fire', 3, 1),
      ('free-fire-max', 'Free Fire MAX', '💥', 'userId', NULL, 'free-fire', 4, 1),
      ('pubgm', 'PUBG Mobile', '🪖', 'userId', NULL, 'pubgm', 5, 1),
      ('valorant', 'Valorant', '🎯', 'userId', NULL, 'valorant', 6, 1),
      ('genshin-impact', 'Genshin Impact', '🌸', 'userId,zone', 'Zone', 'genshin-impact', 7, 1),
      ('honkai-star-rail', 'Honkai: Star Rail', '🚂', 'userId,zone', 'Zone', 'honkai-star-rail', 8, 1)`,

    `CREATE TABLE IF NOT EXISTS packages (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      game_id INT UNSIGNED NOT NULL,
      sku VARCHAR(60) NOT NULL UNIQUE,
      name VARCHAR(100) NOT NULL,
      digiflazz_sku VARCHAR(100) NOT NULL,
      base_price INT UNSIGNED NOT NULL,
      is_hot TINYINT(1) NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_game (game_id, is_active, sort_order),
      CONSTRAINT fk_pkg_game FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,

    `INSERT IGNORE INTO packages (game_id, sku, name, digiflazz_sku, base_price, is_hot, sort_order) VALUES
      (1, 'ML-11', '11 Diamonds', 'MLBB-11', 3000, 0, 1),
      (1, 'ML-86', '86 Diamonds', 'MLBB-86', 21000, 1, 2),
      (1, 'ML-344', '344 Diamonds', 'MLBB-344', 84000, 1, 3),
      (1, 'ML-WKPASS', 'Weekly Pass', 'MLBB-WKPASS', 29000, 1, 4),
      (3, 'FF-70', '70 Diamond', 'FF-70', 12000, 0, 1),
      (3, 'FF-140', '140 Diamond', 'FF-140', 23500, 1, 2),
      (5, 'PUBG-60', '60 UC', 'PUBGM-60', 14000, 0, 1),
      (5, 'PUBG-325', '325 UC', 'PUBGM-325', 70000, 1, 2)`,

    `CREATE TABLE IF NOT EXISTS banners (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      title VARCHAR(120) NOT NULL,
      image_url MEDIUMTEXT NOT NULL,
      link_url VARCHAR(500) NULL,
      sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS settings (
      key_name VARCHAR(100) NOT NULL,
      value MEDIUMTEXT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (key_name)
    ) ENGINE=InnoDB`,

    `INSERT IGNORE INTO settings (key_name, value) VALUES
      ('site_name', 'GameFlash'),
      ('site_tagline', 'Top Up Game Instan'),
      ('logo_url', ''),
      ('accent_color', '#ff6b1a'),
      ('markup_percent', '5'),
      ('markup_minimum', '500'),
      ('fee_bca_va', '0'),
      ('fee_bni_va', '0'),
      ('fee_bri_va', '0'),
      ('fee_mandiri_va', '4000'),
      ('fee_dana', '1000'),
      ('fee_ovo', '1000'),
      ('fee_gopay', '1500'),
      ('fee_shopeepay', '1000'),
      ('fee_qris', '1500'),
      ('feature_check_nickname', '1'),
      ('feature_guest_checkout', '1'),
      ('feature_whatsapp_notif', '0'),
      ('feature_maintenance', '0'),
      ('contact_wa', ''),
      ('contact_email', 'cs@gameflash.id'),
      ('social_instagram', ''),
      ('social_telegram', ''),
      ('footer_text', '© 2025 GameFlash. Semua hak dilindungi.')`,

    `CREATE TABLE IF NOT EXISTS orders (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      order_id VARCHAR(30) NOT NULL UNIQUE,
      game_id INT UNSIGNED NOT NULL,
      package_id INT UNSIGNED NOT NULL,
      customer_no VARCHAR(60) NOT NULL,
      customer_name VARCHAR(100) NULL,
      customer_email VARCHAR(120) NULL,
      customer_wa VARCHAR(20) NULL,
      base_price INT UNSIGNED NOT NULL,
      sell_price INT UNSIGNED NOT NULL,
      service_fee INT UNSIGNED NOT NULL DEFAULT 0,
      total_amount INT UNSIGNED NOT NULL,
      payment_method VARCHAR(30) NOT NULL,
      payment_url TEXT NULL,
      va_number VARCHAR(30) NULL,
      expired_at DATETIME NULL,
      payment_status ENUM('unpaid','paid','expired','failed') NOT NULL DEFAULT 'unpaid',
      topup_status ENUM('pending','processing','success','failed','refunded') NOT NULL DEFAULT 'pending',
      digiflazz_ref VARCHAR(60) NULL UNIQUE,
      sn VARCHAR(200) NULL,
      notes TEXT NULL,
      paid_at DATETIME NULL,
      completed_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_order_id (order_id),
      INDEX idx_payment_status (payment_status),
      INDEX idx_topup_status (topup_status),
      CONSTRAINT fk_order_game FOREIGN KEY (game_id) REFERENCES games(id),
      CONSTRAINT fk_order_package FOREIGN KEY (package_id) REFERENCES packages(id)
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS topup_logs (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      order_id VARCHAR(30) NOT NULL,
      event VARCHAR(40) NOT NULL,
      status VARCHAR(20) NULL,
      payload JSON NULL,
      response JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_order (order_id)
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS payment_logs (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      order_id VARCHAR(30) NOT NULL,
      event VARCHAR(40) NOT NULL,
      provider VARCHAR(20) NOT NULL DEFAULT 'tokopay',
      payload JSON NULL,
      response JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_order (order_id)
    ) ENGINE=InnoDB`,

    // Add Digiflazz settings keys
    `INSERT IGNORE INTO settings (key_name, value) VALUES
      ('digiflazz_username',''),
      ('digiflazz_key_dev',''),
      ('digiflazz_key_prod',''),
      ('digiflazz_mode','development')`,

    // Default: QRIS only aktif, sisanya nonaktif
    `INSERT IGNORE INTO settings (key_name, value) VALUES
      ('pay_enabled_QRIS','1'),
      ('pay_enabled_DANA','0'),
      ('pay_enabled_OVO','0'),
      ('pay_enabled_GOPAY','0'),
      ('pay_enabled_SHOPEEPAY','0'),
      ('pay_enabled_BCA','0'),
      ('pay_enabled_BNI','0'),
      ('pay_enabled_BRI','0'),
      ('pay_enabled_MANDIRI','0'),
      ('pay_enabled_PERMATA','0'),
      ('pay_channel_QRIS','QRIS'),
      ('pay_channel_DANA','DANA'),
      ('pay_channel_OVO','OVO'),
      ('pay_channel_GOPAY','GOPAY'),
      ('pay_channel_SHOPEEPAY','SHOPEEPAY'),
      ('pay_channel_BCA','BCA'),
      ('pay_channel_BNI','BNI'),
      ('pay_channel_BRI','BRI'),
      ('pay_channel_MANDIRI','MANDIRI'),
      ('pay_channel_PERMATA','PERMATA')`,

    // Upgrade kolom ke MEDIUMTEXT + tambah kolom yang belum ada
    `ALTER TABLE games
       MODIFY COLUMN icon_url MEDIUMTEXT NULL`,
    `ALTER TABLE games
       MODIFY COLUMN banner_url MEDIUMTEXT NULL`,
    `ALTER TABLE banners
       MODIFY COLUMN image_url MEDIUMTEXT NOT NULL`,
    `ALTER TABLE settings
       MODIFY COLUMN value MEDIUMTEXT NULL`,
  ];

  // Jalankan ALTER ADD COLUMN untuk kolom yang mungkin belum ada
  const addCols = [
    `ALTER TABLE games ADD COLUMN icon_url MEDIUMTEXT NULL`,
    `ALTER TABLE games ADD COLUMN banner_url MEDIUMTEXT NULL`,
  ];
  for (const q of addCols) {
    try { await conn.query(q); } catch(e) { /* sudah ada, skip */ }
  }

  let ok = 0, skip = 0;
  for (const q of queries) {
    try {
      await conn.query(q);
      ok++;
    } catch (err) {
      if (
        err.message.includes('already exists') ||
        err.message.includes('Duplicate entry') ||
        err.message.includes('Duplicate column name') ||
        err.message.includes('Multiple primary key') ||
        err.code === 'ER_DUP_FIELDNAME'
      ) {
        skip++;
      } else {
        console.error('❌ Error:', err.message);
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
