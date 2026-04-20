require('dotenv').config();
const mysql  = require('mysql2/promise');
const crypto = require('crypto');

// Coba load bcryptjs — tersedia karena ada di dependencies
let bcrypt;
try { bcrypt = require('bcryptjs'); } catch(e) { bcrypt = null; }

async function migrate() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'gameflash',
    multipleStatements: false,
  });

  console.log('🔌 Terhubung ke MySQL...');

  // ── Buat semua tabel ─────────────────────────────────────────────────────
  const queries = [
    `CREATE TABLE IF NOT EXISTS categories (
      id               INT UNSIGNED     NOT NULL AUTO_INCREMENT,
      name             VARCHAR(100)     NOT NULL,
      slug             VARCHAR(120)     NOT NULL UNIQUE,
      image_url        MEDIUMTEXT       NULL,
      guide_image_url  MEDIUMTEXT       NULL,
      description      TEXT             NULL,
      information      MEDIUMTEXT       NULL,
      has_zone_id      TINYINT(1)       NOT NULL DEFAULT 0,
      check_id         TINYINT(1)       NOT NULL DEFAULT 0,
      additional_data  TINYINT(1)       NOT NULL DEFAULT 0,
      nickname_code    VARCHAR(60)      NULL,
      placeholder_uid  VARCHAR(60)      NULL,
      placeholder_zid  VARCHAR(60)      NULL,
      server_list      TEXT             NULL,
      sort_order       TINYINT UNSIGNED NOT NULL DEFAULT 0,
      is_active        TINYINT(1)       NOT NULL DEFAULT 1,
      created_at       DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at       DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_slug (slug),
      INDEX idx_active (is_active, sort_order)
    ) ENGINE=InnoDB`,

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

    `CREATE TABLE IF NOT EXISTS games (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      code VARCHAR(60) NOT NULL UNIQUE,
      name VARCHAR(100) NOT NULL,
      icon VARCHAR(10) NOT NULL DEFAULT '🎮',
      icon_url MEDIUMTEXT NULL,
      banner_url MEDIUMTEXT NULL,
      link_url VARCHAR(255) NULL,
      params VARCHAR(60) NOT NULL DEFAULT 'userId',
      zone_label VARCHAR(40) NULL,
      zone_options TEXT NULL,
      vip_code VARCHAR(60) NOT NULL,
      sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      category VARCHAR(40) NOT NULL DEFAULT 'game',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_active (is_active, sort_order)
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS packages (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      game_id INT UNSIGNED NOT NULL,
      sku VARCHAR(80) NOT NULL UNIQUE,
      name VARCHAR(120) NOT NULL,
      digiflazz_sku VARCHAR(80) NULL,
      base_price INT UNSIGNED NOT NULL DEFAULT 0,
      is_hot TINYINT(1) NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_game_active (game_id, is_active, sort_order),
      INDEX idx_digiflazz_sku (digiflazz_sku)
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS orders (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      order_id VARCHAR(20) NOT NULL UNIQUE,
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
      payment_status ENUM('unpaid','paid','expired','failed') NOT NULL DEFAULT 'unpaid',
      topup_status ENUM('pending','processing','success','failed') NOT NULL DEFAULT 'pending',
      payment_url TEXT NULL,
      va_number VARCHAR(30) NULL,
      qr_code TEXT NULL,
      expired_at DATETIME NULL,
      paid_at DATETIME NULL,
      digiflazz_ref VARCHAR(60) NULL,
      sn TEXT NULL,
      notes TEXT NULL,
      completed_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_order_id (order_id),
      INDEX idx_status (payment_status, topup_status),
      INDEX idx_created (created_at)
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS payment_logs (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      order_id VARCHAR(20) NOT NULL,
      event VARCHAR(30) NOT NULL,
      provider VARCHAR(20) NOT NULL DEFAULT 'tokopay',
      payload JSON NULL,
      response JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_order (order_id)
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS topup_logs (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      order_id VARCHAR(20) NOT NULL,
      event VARCHAR(30) NOT NULL,
      status VARCHAR(30) NULL,
      payload JSON NULL,
      response JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_order (order_id)
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS settings (
      key_name VARCHAR(60) NOT NULL,
      value MEDIUMTEXT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (key_name)
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS banners (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      title VARCHAR(120) NOT NULL,
      image_url MEDIUMTEXT NULL,
      link_url VARCHAR(255) NULL,
      sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS vouchers (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      code VARCHAR(60) NOT NULL UNIQUE,
      name VARCHAR(100) NOT NULL,
      icon VARCHAR(10) NOT NULL DEFAULT '🎟️',
      icon_url MEDIUMTEXT NULL,
      link_url VARCHAR(255) NULL,
      category VARCHAR(40) NOT NULL DEFAULT 'platform',
      sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS users (
      id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
      name           VARCHAR(100)  NOT NULL,
      email          VARCHAR(120)  NOT NULL UNIQUE,
      username       VARCHAR(60)   NULL UNIQUE,
      phone          VARCHAR(20)   NULL,
      password       VARCHAR(255)  NOT NULL,
      balance        DECIMAL(15,2) NOT NULL DEFAULT 0.00,
      role           ENUM('member','reseller') NOT NULL DEFAULT 'member',
      is_active      TINYINT(1)    NOT NULL DEFAULT 1,
      email_verified TINYINT(1)    NOT NULL DEFAULT 0,
      reset_token    VARCHAR(64)   NULL,
      reset_expires  DATETIME      NULL,
      last_login     DATETIME      NULL,
      created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_email    (email),
      INDEX idx_username (username),
      INDEX idx_phone    (phone),
      INDEX idx_active   (is_active)
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS balance_topups (
      id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
      user_id        INT UNSIGNED  NOT NULL,
      amount         DECIMAL(15,2) NOT NULL,
      payment_method VARCHAR(50)   NOT NULL,
      proof_url      TEXT          NULL,
      status         ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      note           TEXT          NULL,
      created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      approved_at    DATETIME      NULL,
      PRIMARY KEY (id),
      INDEX idx_user   (user_id),
      INDEX idx_status (status)
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS balance_deposits (
      id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
      deposit_id     VARCHAR(60)   NOT NULL UNIQUE,
      user_id        INT UNSIGNED  NOT NULL,
      amount         DECIMAL(15,2) NOT NULL,
      payment_method VARCHAR(50)   NOT NULL,
      payment_url    TEXT          NULL,
      va_number      VARCHAR(50)   NULL,
      qr_code        TEXT          NULL,
      trx_id         VARCHAR(100)  NULL,
      status         ENUM('pending','paid','expired','failed') NOT NULL DEFAULT 'pending',
      expired_at     DATETIME      NULL,
      paid_at        DATETIME      NULL,
      note           TEXT          NULL,
      created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_deposit_id (deposit_id),
      INDEX idx_user       (user_id),
      INDEX idx_status     (status)
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS balance_logs (
      id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
      user_id        INT UNSIGNED  NOT NULL,
      type           ENUM('topup','deduct','refund') NOT NULL,
      amount         DECIMAL(15,2) NOT NULL,
      description    VARCHAR(255)  NULL,
      ref_id         VARCHAR(100)  NULL,
      created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_user (user_id)
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS discount_vouchers (
      id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
      code            VARCHAR(50)     NOT NULL UNIQUE,
      name            VARCHAR(100)    NOT NULL,
      description     TEXT            NULL,
      discount_type   ENUM('percent','fixed') NOT NULL DEFAULT 'percent',
      discount_value  DECIMAL(12,2)   NOT NULL DEFAULT 0,
      min_purchase    DECIMAL(12,2)   NOT NULL DEFAULT 0,
      max_discount    DECIMAL(12,2)   NULL COMMENT 'Maks diskon (untuk tipe percent), NULL = tidak ada batas',
      quota           INT UNSIGNED    NULL COMMENT 'NULL = tidak terbatas',
      used_count      INT UNSIGNED    NOT NULL DEFAULT 0,
      valid_from      DATETIME        NULL,
      valid_until     DATETIME        NULL,
      is_active       TINYINT(1)      NOT NULL DEFAULT 1,
      created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_code (code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  ];

  // Tambahkan kolom username ke users jika belum ada (untuk DB yang sudah ada)
  try {
    await conn.query('ALTER TABLE users ADD COLUMN username VARCHAR(60) NULL UNIQUE AFTER email');
    console.log('✅ Kolom username ditambahkan ke tabel users');
  } catch(e) {
    if (!e.message.includes('Duplicate column')) console.warn('username column:', e.message);
  }

  // Tambahkan kolom balance ke users jika belum ada (untuk DB yang sudah ada)
  try {
    await conn.query('ALTER TABLE users ADD COLUMN balance DECIMAL(15,2) NOT NULL DEFAULT 0.00 AFTER password');
    console.log('✅ Kolom balance ditambahkan ke tabel users');
  } catch(e) {
    if (!e.message.includes('Duplicate column')) console.warn('balance column:', e.message);
  }

  // Tambahkan kolom role ke users jika belum ada
  try {
    await conn.query("ALTER TABLE users ADD COLUMN role ENUM('member','reseller') NOT NULL DEFAULT 'member' AFTER balance");
    console.log('✅ Kolom role ditambahkan ke tabel users');
  } catch(e) {
    if (!e.message.includes('Duplicate column')) console.warn('role column:', e.message);
  }

  // Tambahkan kolom is_trending ke games jika belum ada
  try {
    await conn.query('ALTER TABLE games ADD COLUMN is_trending TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active');
    console.log('✅ Kolom is_trending ditambahkan ke tabel games');
  } catch(e) {
    if (!e.message.includes('Duplicate column')) console.warn('is_trending column:', e.message);
  }

  // Tambahkan kolom discount_code & discount_amount ke orders jika belum ada
  try {
    await conn.query('ALTER TABLE orders ADD COLUMN discount_code VARCHAR(50) NULL AFTER payment_method');
    console.log('✅ Kolom discount_code ditambahkan ke tabel orders');
  } catch(e) {
    if (!e.message.includes('Duplicate column')) console.warn('discount_code column:', e.message);
  }
  try {
    await conn.query('ALTER TABLE orders ADD COLUMN discount_amount DECIMAL(12,2) NULL AFTER discount_code');
    console.log('✅ Kolom discount_amount ditambahkan ke tabel orders');
  } catch(e) {
    if (!e.message.includes('Duplicate column')) console.warn('discount_amount column:', e.message);
  }

  // Buat tabel balance_deposits jika belum ada (untuk DB lama sebelum migrasi ini)
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS balance_deposits (
      id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
      deposit_id     VARCHAR(60)   NOT NULL UNIQUE,
      user_id        INT UNSIGNED  NOT NULL,
      amount         DECIMAL(15,2) NOT NULL,
      payment_method VARCHAR(50)   NOT NULL,
      payment_url    TEXT          NULL,
      va_number      VARCHAR(50)   NULL,
      qr_code        TEXT          NULL,
      trx_id         VARCHAR(100)  NULL,
      status         ENUM('pending','paid','expired','failed') NOT NULL DEFAULT 'pending',
      expired_at     DATETIME      NULL,
      paid_at        DATETIME      NULL,
      note           TEXT          NULL,
      created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_deposit_id (deposit_id),
      INDEX idx_user       (user_id),
      INDEX idx_status     (status)
    ) ENGINE=InnoDB`);
    console.log('✅ Tabel balance_deposits berhasil dibuat/diverifikasi');
  } catch(e) {
    console.warn('balance_deposits table:', e.message);
  }

  for (const q of queries) {
    await conn.query(q);
  }
  console.log('✅ Tabel berhasil dibuat/diverifikasi');

  // ── Seed categories default jika belum ada ───────────────────────────────
  const [[catCount]] = await conn.query('SELECT COUNT(*) AS total FROM categories');
  if (catCount.total === 0) {
    await conn.query(`INSERT IGNORE INTO categories (name, slug, has_zone_id, sort_order, is_active) VALUES
      ('Mobile Game', 'mobile-game', 1,  1,  1),
      ('PC Game',     'pc-game',     0,  2,  1),
      ('Voucher',     'voucher',     0,  3,  1),
      ('Streaming',   'streaming',   0,  4,  1),
      ('Lainnya',     'lainnya',     0,  99, 1)`);
    console.log('✅ Seed data kategori berhasil ditambahkan');
  }

  // ── Seed admin hanya jika belum ada ─────────────────────────────────────
  const [[existing]] = await conn.query('SELECT id FROM admins WHERE username = ? LIMIT 1', ['admin']);

  if (!existing) {
    // Generate password acak yang kuat — tidak ada default hardcoded
    const randomPassword = crypto.randomBytes(12).toString('base64').slice(0, 16);
    let hashedPassword;

    if (bcrypt) {
      hashedPassword = await bcrypt.hash(randomPassword, 12);
    } else {
      // Fallback jika bcrypt belum terinstall saat migrate pertama kali
      hashedPassword = crypto.createHash('sha256').update(randomPassword).digest('hex');
      console.warn('⚠️  bcryptjs tidak tersedia, password di-hash dengan SHA256 sementara. Segera ganti password via admin panel!');
    }

    await conn.query(
      `INSERT INTO admins (username, email, password, role) VALUES (?, ?, ?, ?)`,
      ['admin', 'admin@gameflash.id', hashedPassword, 'superadmin']
    );

    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║           AKUN ADMIN BERHASIL DIBUAT                 ║');
    console.log('║                                                      ║');
    console.log(`║  Username : admin                                    `);
    console.log(`║  Password : ${randomPassword.padEnd(40)}║`);
    console.log('║                                                      ║');
    console.log('║  ⚠️  SIMPAN PASSWORD INI SEKARANG!                   ║');
    console.log('║  Segera ganti via menu admin setelah login pertama   ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');
  } else {
    console.log('ℹ️  Akun admin sudah ada, password tidak diubah');
  }

  await conn.end();
  console.log('✅ Migrasi selesai');
}

migrate().catch(err => {
  console.error('❌ Migrasi gagal:', err.message);
  process.exit(1);
});
