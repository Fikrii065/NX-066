'use strict';
require('dotenv').config();
const crypto = require('crypto');

// ── Auto-generate JWT_SECRET jika belum ada ───────────────────────────────────
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.log('[JWT] Auto-generated JWT_SECRET. Set di Railway Variables untuk persistent:');
  console.log('      JWT_SECRET=' + process.env.JWT_SECRET);
}

const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const rateLimit    = require('express-rate-limit');
const path         = require('path');
const bcrypt       = require('bcryptjs');
const mysql        = require('mysql2/promise');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }));

// ── Auto-migrate ─────────────────────────────────────────────────────────────
async function autoMigrate() {
  const cfg = {
    host:     process.env.MYSQLHOST     || process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.MYSQLPORT    || process.env.DB_PORT     || '3306'),
    user:     process.env.MYSQLUSER     || process.env.DB_USER     || 'root',
    password: process.env.MYSQLPASSWORD || process.env.MYSQL_ROOT_PASSWORD || process.env.DB_PASS || '',
    database: process.env.MYSQLDATABASE || process.env.DB_NAME     || 'railway',
    connectTimeout: 20000,
  };

  let conn;
  try {
    conn = await mysql.createConnection(cfg);
    console.log('[Migrate] DB terhubung ✅');

    const sqls = [
      // Admins
      `CREATE TABLE IF NOT EXISTS admins (
        id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        username   VARCHAR(60)  NOT NULL UNIQUE,
        email      VARCHAR(120) NULL,
        password   VARCHAR(255) NOT NULL,
        role       ENUM('superadmin','admin','cs') NOT NULL DEFAULT 'admin',
        is_active  TINYINT(1)   NOT NULL DEFAULT 1,
        last_login DATETIME     NULL,
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB`,

      // Settings
      `CREATE TABLE IF NOT EXISTS settings (
        key_name VARCHAR(100) NOT NULL PRIMARY KEY,
        value    TEXT         NULL,
        updated_at DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB`,

      // Games
      `CREATE TABLE IF NOT EXISTS games (
        id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        code         VARCHAR(60)  NOT NULL UNIQUE,
        name         VARCHAR(100) NOT NULL,
        icon         VARCHAR(10)  NULL DEFAULT '🎮',
        icon_url     TEXT         NULL,
        banner_url   TEXT         NULL,
        category     VARCHAR(30)  NOT NULL DEFAULT 'game',
        params       VARCHAR(60)  NOT NULL DEFAULT 'userId',
        zone_label   VARCHAR(60)  NULL,
        zone_options TEXT         NULL,
        vip_code     VARCHAR(60)  NULL,
        link_url     TEXT         NULL,
        is_active    TINYINT(1)   NOT NULL DEFAULT 1,
        is_trending  TINYINT(1)   NOT NULL DEFAULT 0,
        sort_order   INT          NOT NULL DEFAULT 0,
        created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB`,

      // Packages
      `CREATE TABLE IF NOT EXISTS packages (
        id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        game_id        INT UNSIGNED NOT NULL,
        sku            VARCHAR(80)  NOT NULL,
        name           VARCHAR(150) NOT NULL,
        digiflazz_sku  VARCHAR(80)  NULL,
        base_price     INT UNSIGNED NOT NULL DEFAULT 0,
        is_active      TINYINT(1)   NOT NULL DEFAULT 1,
        is_hot         TINYINT(1)   NOT NULL DEFAULT 0,
        sort_order     INT          NOT NULL DEFAULT 0,
        created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_game_sku (game_id, sku),
        INDEX idx_game (game_id)
      ) ENGINE=InnoDB`,

      // Users
      `CREATE TABLE IF NOT EXISTS users (
        id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name       VARCHAR(100) NULL,
        email      VARCHAR(120) NULL UNIQUE,
        phone      VARCHAR(20)  NULL,
        password   VARCHAR(255) NULL,
        role       ENUM('member','reseller') NOT NULL DEFAULT 'member',
        balance    DECIMAL(15,2) NOT NULL DEFAULT 0,
        is_active  TINYINT(1)   NOT NULL DEFAULT 1,
        last_login DATETIME     NULL,
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB`,

      // Orders
      `CREATE TABLE IF NOT EXISTS orders (
        id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        order_id        VARCHAR(20)  NOT NULL UNIQUE,
        game_id         INT UNSIGNED NOT NULL,
        package_id      INT UNSIGNED NOT NULL,
        customer_no     VARCHAR(60)  NOT NULL,
        customer_name   VARCHAR(100) NULL,
        customer_email  VARCHAR(120) NULL,
        customer_wa     VARCHAR(20)  NULL,
        base_price      INT UNSIGNED NOT NULL DEFAULT 0,
        sell_price      INT UNSIGNED NOT NULL DEFAULT 0,
        service_fee     INT UNSIGNED NOT NULL DEFAULT 0,
        discount_code   VARCHAR(50)  NULL,
        discount_amount INT UNSIGNED NOT NULL DEFAULT 0,
        total_amount    INT UNSIGNED NOT NULL DEFAULT 0,
        payment_method  VARCHAR(30)  NOT NULL,
        payment_status  ENUM('unpaid','paid','expired','failed') NOT NULL DEFAULT 'unpaid',
        payment_url     TEXT         NULL,
        va_number       VARCHAR(50)  NULL,
        topup_status    ENUM('pending','processing','success','failed') NOT NULL DEFAULT 'pending',
        digiflazz_ref   VARCHAR(80)  NULL,
        sn              TEXT         NULL,
        notes           TEXT         NULL,
        expired_at      DATETIME     NULL,
        paid_at         DATETIME     NULL,
        completed_at    DATETIME     NULL,
        created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_order_id (order_id),
        INDEX idx_status (payment_status, topup_status),
        INDEX idx_created (created_at)
      ) ENGINE=InnoDB`,

      // Balance logs
      `CREATE TABLE IF NOT EXISTS balance_logs (
        id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id    INT UNSIGNED NOT NULL,
        type       ENUM('topup','deduct','refund') NOT NULL,
        amount     DECIMAL(15,2) NOT NULL,
        description VARCHAR(200) NULL,
        ref_id     VARCHAR(30)  NULL,
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user (user_id)
      ) ENGINE=InnoDB`,

      // Banners
      `CREATE TABLE IF NOT EXISTS banners (
        id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        title      VARCHAR(100) NULL,
        image_url  TEXT         NOT NULL,
        link_url   TEXT         NULL,
        is_active  TINYINT(1)   NOT NULL DEFAULT 1,
        sort_order INT          NOT NULL DEFAULT 0,
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB`,

      // Discount vouchers
      `CREATE TABLE IF NOT EXISTS discount_vouchers (
        id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        code           VARCHAR(50)  NOT NULL UNIQUE,
        name           VARCHAR(100) NOT NULL,
        description    TEXT         NULL,
        discount_type  ENUM('percent','fixed') NOT NULL DEFAULT 'percent',
        discount_value DECIMAL(12,2) NOT NULL DEFAULT 0,
        min_purchase   DECIMAL(12,2) NOT NULL DEFAULT 0,
        max_discount   DECIMAL(12,2) NULL,
        quota          INT UNSIGNED  NULL,
        used_count     INT UNSIGNED  NOT NULL DEFAULT 0,
        valid_from     DATETIME      NULL,
        valid_until    DATETIME      NULL,
        is_active      TINYINT(1)    NOT NULL DEFAULT 1,
        created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB`,

      // Payment logs
      `CREATE TABLE IF NOT EXISTS payment_logs (
        id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        order_id   VARCHAR(20)  NOT NULL,
        event      VARCHAR(30)  NOT NULL,
        provider   VARCHAR(20)  NOT NULL DEFAULT 'tokopay',
        payload    JSON         NULL,
        response   JSON         NULL,
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_order (order_id)
      ) ENGINE=InnoDB`,
    ];

    for (const sql of sqls) {
      await conn.query(sql);
    }

    // Seed default admin jika belum ada
    const [[existing]] = await conn.query('SELECT id FROM admins WHERE username=? LIMIT 1', ['admin']);
    if (!existing) {
      const hashed = await bcrypt.hash('admin123', 10);
      await conn.query(
        'INSERT INTO admins (username,email,password,role) VALUES (?,?,?,?)',
        ['admin', 'admin@gameflash.id', hashed, 'superadmin']
      );
      console.log('[Migrate] Admin default dibuat → username: admin / password: admin123');
    }

    // Seed default settings
    const defaults = [
      ['site_name', 'GameFlash'],
      ['site_tagline', 'Top Up Cepat & Murah'],
      ['markup_percent', '5'],
      ['markup_minimum', '500'],
      ['feature_maintenance', '0'],
      ['feature_guest_checkout', '1'],
    ];
    for (const [k, v] of defaults) {
      await conn.query('INSERT IGNORE INTO settings (key_name,value) VALUES (?,?)', [k, v]);
    }

    console.log('[Migrate] Selesai ✅');
  } catch (e) {
    console.error('[Migrate] Error:', e.message);
  } finally {
    if (conn) conn.end().catch(() => {});
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',             require('./routes/auth'));
app.use('/api/games',            require('./routes/games'));
app.use('/api/packages',         require('./routes/packages'));
app.use('/api/orders',           require('./routes/orders'));
app.use('/api/settings',         require('./routes/settings'));
app.use('/api/banners',          require('./routes/banners'));
app.use('/api/admin',            require('./routes/admin'));
app.use('/api/users',            require('./routes/users'));
app.use('/api/discount-vouchers',require('./routes/discount_vouchers'));
app.use('/api/webhooks',         require('./routes/webhooks'));

// ── SPA fallback ──────────────────────────────────────────────────────────────
const pages = {
  '/':           'index.html',
  '/order':      'order.html',
  '/payment':    'payment.html',
  '/cek-order':  'cek-order.html',
  '/login':      'login.html',
  '/admin':      'admin.html',
};
Object.entries(pages).forEach(([route, file]) => {
  app.get(route, (_, res) => res.sendFile(path.join(__dirname, 'public', file)));
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
autoMigrate().then(() => {
  app.listen(PORT, () => console.log(`[Server] Running on port ${PORT} ✅`));
});
