'use strict';
require('dotenv').config();

const express     = require('express');
const helmet      = require('helmet');
const cors        = require('cors');
const rateLimit   = require('express-rate-limit');
const path        = require('path');
const mysql       = require('mysql2/promise');
const crypto      = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Auto-migrate: buat semua tabel yang belum ada saat server start ──────────
async function autoMigrate() {
  let conn;
  try {
    conn = await mysql.createConnection({
      host:               process.env.DB_HOST     || 'localhost',
      port:               parseInt(process.env.DB_PORT) || 3306,
      user:               process.env.DB_USER     || 'root',
      password:           process.env.DB_PASS     || '',
      database:           process.env.DB_NAME     || 'gameflash',
      multipleStatements: false,
      connectTimeout:     15000,
    });

    console.log('DB terhubung, menjalankan auto-migrate...');

    const tables = [
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
        id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
        username   VARCHAR(60)  NOT NULL UNIQUE,
        email      VARCHAR(120) NOT NULL UNIQUE,
        password   VARCHAR(255) NOT NULL,
        role       ENUM('superadmin','admin','cs') NOT NULL DEFAULT 'admin',
        is_active  TINYINT(1)   NOT NULL DEFAULT 1,
        last_login DATETIME     NULL,
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB`,

      `CREATE TABLE IF NOT EXISTS games (
        id           INT UNSIGNED     NOT NULL AUTO_INCREMENT,
        code         VARCHAR(60)      NOT NULL UNIQUE,
        name         VARCHAR(100)     NOT NULL,
        icon         VARCHAR(10)      NOT NULL DEFAULT '🎮',
        icon_url     MEDIUMTEXT       NULL,
        banner_url   MEDIUMTEXT       NULL,
        link_url     VARCHAR(255)     NULL,
        params       VARCHAR(60)      NOT NULL DEFAULT 'userId',
        zone_label   VARCHAR(40)      NULL,
        zone_options TEXT             NULL,
        vip_code     VARCHAR(60)      NOT NULL DEFAULT '',
        sort_order   TINYINT UNSIGNED NOT NULL DEFAULT 0,
        is_active    TINYINT(1)       NOT NULL DEFAULT 1,
        is_trending  TINYINT(1)       NOT NULL DEFAULT 0,
        category     VARCHAR(40)      NOT NULL DEFAULT 'game',
        created_at   DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at   DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_active (is_active, sort_order)
      ) ENGINE=InnoDB`,

      `CREATE TABLE IF NOT EXISTS packages (
        id            INT UNSIGNED      NOT NULL AUTO_INCREMENT,
        game_id       INT UNSIGNED      NOT NULL,
        sku           VARCHAR(80)       NOT NULL UNIQUE,
        name          VARCHAR(120)      NOT NULL,
        digiflazz_sku VARCHAR(80)       NULL,
        icon_url      MEDIUMTEXT        NULL,
        base_price    INT UNSIGNED      NOT NULL DEFAULT 0,
        is_hot        TINYINT(1)        NOT NULL DEFAULT 0,
        is_active     TINYINT(1)        NOT NULL DEFAULT 1,
        sort_order    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        created_at    DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_game_active   (game_id, is_active, sort_order),
        INDEX idx_digiflazz_sku (digiflazz_sku)
      ) ENGINE=InnoDB`,

      `CREATE TABLE IF NOT EXISTS banners (
        id         INT UNSIGNED     NOT NULL AUTO_INCREMENT,
        title      VARCHAR(120)     NOT NULL,
        image_url  MEDIUMTEXT       NULL,
        link_url   VARCHAR(255)     NULL,
        sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
        is_active  TINYINT(1)       NOT NULL DEFAULT 1,
        created_at DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB`,

      `CREATE TABLE IF NOT EXISTS settings (
        key_name   VARCHAR(60) NOT NULL,
        value      MEDIUMTEXT  NULL,
        updated_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (key_name)
      ) ENGINE=InnoDB`,

      `CREATE TABLE IF NOT EXISTS vouchers (
        id         INT UNSIGNED     NOT NULL AUTO_INCREMENT,
        code       VARCHAR(60)      NOT NULL UNIQUE,
        name       VARCHAR(100)     NOT NULL,
        icon       VARCHAR(10)      NOT NULL DEFAULT '🎟️',
        icon_url   MEDIUMTEXT       NULL,
        link_url   VARCHAR(255)     NULL,
        category   VARCHAR(40)      NOT NULL DEFAULT 'platform',
        sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
        is_active  TINYINT(1)       NOT NULL DEFAULT 1,
        created_at DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB`,

      `CREATE TABLE IF NOT EXISTS orders (
        id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
        order_id        VARCHAR(20)   NOT NULL UNIQUE,
        game_id         INT UNSIGNED  NOT NULL,
        package_id      INT UNSIGNED  NOT NULL,
        customer_no     VARCHAR(60)   NOT NULL,
        customer_name   VARCHAR(100)  NULL,
        customer_email  VARCHAR(120)  NULL,
        customer_wa     VARCHAR(20)   NULL,
        base_price      INT UNSIGNED  NOT NULL,
        sell_price      INT UNSIGNED  NOT NULL,
        service_fee     INT UNSIGNED  NOT NULL DEFAULT 0,
        discount_code   VARCHAR(50)   NULL,
        discount_amount DECIMAL(12,2) NULL,
        total_amount    INT UNSIGNED  NOT NULL,
        payment_method  VARCHAR(30)   NOT NULL,
        payment_status  ENUM('unpaid','paid','expired','failed') NOT NULL DEFAULT 'unpaid',
        topup_status    ENUM('pending','processing','success','failed') NOT NULL DEFAULT 'pending',
        payment_url     TEXT          NULL,
        va_number       VARCHAR(30)   NULL,
        qr_code         TEXT          NULL,
        expired_at      DATETIME      NULL,
        paid_at         DATETIME      NULL,
        digiflazz_ref   VARCHAR(60)   NULL,
        sn              TEXT          NULL,
        notes           TEXT          NULL,
        completed_at    DATETIME      NULL,
        created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_order_id (order_id),
        INDEX idx_status   (payment_status, topup_status),
        INDEX idx_created  (created_at)
      ) ENGINE=InnoDB`,

      `CREATE TABLE IF NOT EXISTS payment_logs (
        id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
        order_id   VARCHAR(20)  NOT NULL,
        event      VARCHAR(30)  NOT NULL,
        provider   VARCHAR(20)  NOT NULL DEFAULT 'tokopay',
        payload    JSON         NULL,
        response   JSON         NULL,
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_order (order_id)
      ) ENGINE=InnoDB`,

      `CREATE TABLE IF NOT EXISTS topup_logs (
        id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
        order_id   VARCHAR(20)  NOT NULL,
        event      VARCHAR(30)  NOT NULL,
        status     VARCHAR(30)  NULL,
        payload    JSON         NULL,
        response   JSON         NULL,
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_order (order_id)
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
        id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
        user_id     INT UNSIGNED  NOT NULL,
        type        ENUM('topup','deduct','refund') NOT NULL,
        amount      DECIMAL(15,2) NOT NULL,
        description VARCHAR(255)  NULL,
        ref_id      VARCHAR(100)  NULL,
        created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_user (user_id)
      ) ENGINE=InnoDB`,

      `CREATE TABLE IF NOT EXISTS discount_vouchers (
        id             INT UNSIGNED    NOT NULL AUTO_INCREMENT,
        code           VARCHAR(50)     NOT NULL UNIQUE,
        name           VARCHAR(100)    NOT NULL,
        description    TEXT            NULL,
        discount_type  ENUM('percent','fixed') NOT NULL DEFAULT 'percent',
        discount_value DECIMAL(12,2)   NOT NULL DEFAULT 0,
        min_purchase   DECIMAL(12,2)   NOT NULL DEFAULT 0,
        max_discount   DECIMAL(12,2)   NULL,
        quota          INT UNSIGNED    NULL,
        used_count     INT UNSIGNED    NOT NULL DEFAULT 0,
        valid_from     DATETIME        NULL,
        valid_until    DATETIME        NULL,
        is_active      TINYINT(1)      NOT NULL DEFAULT 1,
        created_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    ];

    for (const sql of tables) {
      await conn.query(sql);
    }

    // Seed kategori default jika tabel masih kosong
    const [[{ total }]] = await conn.query('SELECT COUNT(*) AS total FROM categories');
    if (total === 0) {
      await conn.query(`INSERT IGNORE INTO categories (name, slug, has_zone_id, sort_order, is_active) VALUES
        ('Mobile Game', 'mobile-game', 1,  1,  1),
        ('PC Game',     'pc-game',     0,  2,  1),
        ('Voucher',     'voucher',     0,  3,  1),
        ('Streaming',   'streaming',   0,  4,  1),
        ('Lainnya',     'lainnya',     0, 99,  1)`);
      console.log('Seed kategori default berhasil');
    }

    // Seed admin default jika belum ada
    const [[existingAdmin]] = await conn.query(
      'SELECT id FROM admins WHERE username = ? LIMIT 1', ['admin']
    );
    if (!existingAdmin) {
      let bcrypt;
      try { bcrypt = require('bcryptjs'); } catch(e) { bcrypt = null; }
      const randomPw = crypto.randomBytes(12).toString('base64').slice(0, 16);
      const hashed   = bcrypt
        ? await bcrypt.hash(randomPw, 12)
        : crypto.createHash('sha256').update(randomPw).digest('hex');
      await conn.query(
        `INSERT INTO admins (username, email, password, role) VALUES (?, ?, ?, ?)`,
        ['admin', 'admin@gameflash.id', hashed, 'superadmin']
      );
      console.log('========================================');
      console.log('  AKUN ADMIN BERHASIL DIBUAT');
      console.log('  Username : admin');
      console.log('  Password : ' + randomPw);
      console.log('  SEGERA GANTI PASSWORD SETELAH LOGIN!');
      console.log('========================================');
    }

    console.log('Auto-migrate selesai');
  } catch (err) {
    console.error('Auto-migrate error:', err.message);
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

// Trust Railway's reverse proxy
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
}));

app.use(express.static(path.join(__dirname, 'public')));

// ── Diagnostik endpoints ─────────────────────────────────────────────────────
// POST /api/ping — cek apakah server menerima POST request
app.post('/api/ping', (req, res) => {
  res.json({ success: true, message: 'pong', timestamp: new Date().toISOString() });
});

// POST /api/test-auth — cek auth + koneksi DB
app.post('/api/test-auth', require('./middleware/auth'), async (req, res) => {
  try {
    const db = require('./lib/db');
    const [[row]] = await db.query('SELECT 1 AS ok');
    res.json({ success: true, message: 'Auth OK, DB OK', db: row.ok === 1, admin: req.admin });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Auth OK, DB ERROR: ' + err.message });
  }
});

// API Routes
app.use('/api/auth',              require('./routes/auth'));
app.use('/api/banners',           require('./routes/banners'));
app.use('/api/categories',        require('./routes/categories'));
app.use('/api/games',             require('./routes/games'));
app.use('/api/packages',          require('./routes/packages'));
app.use('/api/package-icons',     require('./routes/package_icons'));
app.use('/api/orders',            require('./routes/orders'));
app.use('/api/settings',          require('./routes/settings'));
app.use('/api/nickname',          require('./routes/nickname'));
app.use('/api/balance',           require('./routes/balance'));
app.use('/api/vouchers',          require('./routes/vouchers'));
app.use('/api/discount-vouchers', require('./routes/discount_vouchers'));
app.use('/api/admin',             require('./routes/admin'));
app.use('/api/admin',             require('./routes/admin_extra'));
app.use('/api/admin',             require('./routes/admin_users'));
app.use('/api/users',             require('./routes/users'));
app.use('/api/webhooks',          require('./routes/webhooks'));

// Page Routes
const pages = {
  '/admin':             'admin.html',
  '/login':             'login.html',
  '/dashboard':         'dashboard.html',
  '/cek-order':         'cek-order.html',
  '/order':             'order.html',
  '/payment':           'payment.html',
  '/pengguna':          'pengguna.html',
  '/reset-password':    'reset-password.html',
  '/user-auth':         'user-auth.html',
  '/voucher-order':     'voucher-order.html',
  '/kategori-layanan':  'kategori-layanan.html',
  '/metode-pembayaran': 'metode-pembayaran.html',
  '/test-admin':        'test-admin.html',
};
Object.entries(pages).forEach(([route, file]) => {
  app.get(route, (_req, res) => res.sendFile(path.join(__dirname, 'public', file)));
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, _next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// Jalankan migrate dulu, baru start server
autoMigrate().then(() => {
  app.listen(PORT, () => {
    console.log('Server running on port ' + PORT);
  });
});

module.exports = app;
