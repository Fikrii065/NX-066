-- ============================================================
--  GameFlash — Database Schema
--  MySQL 8.0+
-- ============================================================

-- ─── ADMIN USERS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
  id         INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  username   VARCHAR(60)     NOT NULL UNIQUE,
  email      VARCHAR(120)    NOT NULL UNIQUE,
  password   VARCHAR(255)    NOT NULL,
  role       ENUM('superadmin','admin','cs') NOT NULL DEFAULT 'admin',
  is_active  TINYINT(1)      NOT NULL DEFAULT 1,
  last_login DATETIME        NULL,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB;

INSERT IGNORE INTO admins (username, email, password, role)
VALUES ('admin', 'admin@gameflash.id',
        '$2a$12$KIX3xWd8R1g.2/0OqvpXzekW5qRGJH7Vx5HHUxpXjLaC2Y1RHxvOy',
        'superadmin');

-- ─── GAMES ───────────────────────────────────────────────────────────────────
-- ─── CATEGORIES ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id               INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  name             VARCHAR(100)     NOT NULL,
  slug             VARCHAR(120)     NOT NULL UNIQUE,
  image_url        MEDIUMTEXT       NULL,
  guide_image_url  MEDIUMTEXT       NULL,
  description      TEXT             NULL,
  information      MEDIUMTEXT       NULL,
  has_zone_id      TINYINT(1)       NOT NULL DEFAULT 0,
  sort_order       TINYINT UNSIGNED NOT NULL DEFAULT 0,
  is_active        TINYINT(1)       NOT NULL DEFAULT 1,
  created_at       DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_slug (slug),
  INDEX idx_active (is_active, sort_order)
) ENGINE=InnoDB;

INSERT IGNORE INTO categories (name, slug, has_zone_id, sort_order, is_active) VALUES
  ('Mobile Game', 'mobile-game', 1,  1,  1),
  ('PC Game',     'pc-game',     0,  2,  1),
  ('Voucher',     'voucher',     0,  3,  1),
  ('Streaming',   'streaming',   0,  4,  1),
  ('Lainnya',     'lainnya',     0,  99, 1);

-- ─── GAMES ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS games (
  id             INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  code           VARCHAR(60)     NOT NULL UNIQUE,
  name           VARCHAR(100)    NOT NULL,
  icon           VARCHAR(10)     NOT NULL DEFAULT '🎮',
  icon_url       MEDIUMTEXT      NULL,
  params         VARCHAR(60)     NOT NULL DEFAULT 'userId',
  zone_label     VARCHAR(40)     NULL,
  vip_code       VARCHAR(60)     NOT NULL,
  sort_order     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  is_active      TINYINT(1)      NOT NULL DEFAULT 1,
  created_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_active (is_active, sort_order)
) ENGINE=InnoDB;

INSERT IGNORE INTO games (code, name, icon, params, zone_label, vip_code, sort_order, is_active) VALUES
  ('mobile-legends',        'Mobile Legends: Bang Bang', '⚔️',  'userId,zoneId', 'Zone ID', 'mobile-legends',        1,  1),
  ('mobile-legends-region', 'Mobile Legends Region',     '🗺️',  'userId,zoneId', 'Zone ID', 'mobile-legends-region', 2,  1),
  ('free-fire',             'Free Fire',                 '🔥',  'userId',        NULL,      'free-fire',             3,  1),
  ('free-fire-max',         'Free Fire MAX',             '💥',  'userId',        NULL,      'free-fire',             4,  1),
  ('pubgm',                 'PUBG Mobile',               '🪖',  'userId',        NULL,      'pubgm',                 5,  1),
  ('valorant',              'Valorant',                  '🎯',  'userId',        NULL,      'valorant',              6,  1),
  ('genshin-impact',        'Genshin Impact',            '🌸',  'userId,zone',   'Zone',    'genshin-impact',        7,  1),
  ('honkai-star-rail',      'Honkai: Star Rail',         '🚂',  'userId,zone',   'Zone',    'honkai-star-rail',      8,  1),
  ('pointblank',            'Point Blank',               '🎮',  'userId',        NULL,      'pointblank',            9,  0);

-- ─── PACKAGES ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS packages (
  id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  game_id         INT UNSIGNED    NOT NULL,
  sku             VARCHAR(60)     NOT NULL UNIQUE,
  name            VARCHAR(100)    NOT NULL,
  digiflazz_sku   VARCHAR(100)    NOT NULL,
  base_price      INT UNSIGNED    NOT NULL,
  is_hot          TINYINT(1)      NOT NULL DEFAULT 0,
  is_active       TINYINT(1)      NOT NULL DEFAULT 1,
  sort_order      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_game (game_id, is_active, sort_order),
  CONSTRAINT fk_pkg_game FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
) ENGINE=InnoDB;

INSERT IGNORE INTO packages (game_id, sku, name, digiflazz_sku, base_price, is_hot, sort_order) VALUES
  (1, 'ML-11',    '11 Diamonds',  'MLBB-11',    3000,  0, 1),
  (1, 'ML-22',    '22 Diamonds',  'MLBB-22',    5800,  0, 2),
  (1, 'ML-56',    '56 Diamonds',  'MLBB-56',    14000, 0, 3),
  (1, 'ML-86',    '86 Diamonds',  'MLBB-86',    21000, 1, 4),
  (1, 'ML-172',   '172 Diamonds', 'MLBB-172',   42000, 0, 5),
  (1, 'ML-344',   '344 Diamonds', 'MLBB-344',   84000, 1, 6),
  (1, 'ML-WKPASS','Weekly Pass',  'MLBB-WKPASS',29000, 1, 7),
  (3, 'FF-70',    '70 Diamond',   'FF-70',      12000, 0, 1),
  (3, 'FF-140',   '140 Diamond',  'FF-140',     23500, 1, 2),
  (3, 'FF-355',   '355 Diamond',  'FF-355',     58000, 0, 3),
  (3, 'FF-720',   '720 Diamond',  'FF-720',     115000,1, 4),
  (5, 'PUBG-60',  '60 UC',        'PUBGM-60',   14000, 0, 1),
  (5, 'PUBG-325', '325 UC',       'PUBGM-325',  70000, 1, 2),
  (5, 'PUBG-660', '660 UC',       'PUBGM-660',  140000,0, 3);

-- ─── BANNERS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS banners (
  id          INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  title       VARCHAR(120)    NOT NULL,
  image_url   TEXT            NOT NULL,
  link_url    VARCHAR(500)    NULL,
  sort_order  TINYINT UNSIGNED NOT NULL DEFAULT 0,
  is_active   TINYINT(1)      NOT NULL DEFAULT 1,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB;

-- ─── SITE SETTINGS ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key_name    VARCHAR(100)    NOT NULL,
  value       TEXT            NULL,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (key_name)
) ENGINE=InnoDB;

INSERT IGNORE INTO settings (key_name, value) VALUES
  ('site_name',        'GameFlash'),
  ('site_tagline',     'Top Up Game Instan'),
  ('logo_url',         ''),
  ('accent_color',     '#6c47ff'),
  ('markup_percent',   '5'),
  ('markup_minimum',   '500'),
  ('fee_bca_va',       '0'),
  ('fee_bni_va',       '0'),
  ('fee_bri_va',       '0'),
  ('fee_mandiri_va',   '4000'),
  ('fee_dana',         '1000'),
  ('fee_ovo',          '1000'),
  ('fee_gopay',        '1500'),
  ('fee_shopeepay',    '1000'),
  ('fee_qris',         '1500'),
  ('feature_check_nickname', '1'),
  ('feature_guest_checkout', '1'),
  ('feature_whatsapp_notif', '0'),
  ('feature_maintenance',    '0'),
  ('contact_wa',       ''),
  ('contact_email',    'cs@gameflash.id'),
  ('social_instagram', ''),
  ('social_telegram',  ''),
  ('footer_text',      '© 2025 GameFlash. Semua hak dilindungi.');

-- ─── ORDERS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id               INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  order_id         VARCHAR(30)     NOT NULL UNIQUE,
  game_id          INT UNSIGNED    NOT NULL,
  package_id       INT UNSIGNED    NOT NULL,
  customer_no      VARCHAR(60)     NOT NULL,
  customer_name    VARCHAR(100)    NULL,
  customer_email   VARCHAR(120)    NULL,
  customer_wa      VARCHAR(20)     NULL,
  base_price       INT UNSIGNED    NOT NULL,
  sell_price       INT UNSIGNED    NOT NULL,
  service_fee      INT UNSIGNED    NOT NULL DEFAULT 0,
  total_amount     INT UNSIGNED    NOT NULL,
  payment_method   VARCHAR(30)     NOT NULL,
  payment_url      TEXT            NULL,
  va_number        VARCHAR(30)     NULL,
  expired_at       DATETIME        NULL,
  payment_status   ENUM('unpaid','paid','expired','failed') NOT NULL DEFAULT 'unpaid',
  topup_status     ENUM('pending','processing','success','failed','refunded') NOT NULL DEFAULT 'pending',
  digiflazz_ref    VARCHAR(60)     NULL UNIQUE,
  sn               VARCHAR(200)    NULL,
  notes            TEXT            NULL,
  paid_at          DATETIME        NULL,
  completed_at     DATETIME        NULL,
  created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_order_id      (order_id),
  INDEX idx_payment_status (payment_status),
  INDEX idx_topup_status  (topup_status),
  INDEX idx_created_at    (created_at),
  CONSTRAINT fk_order_game    FOREIGN KEY (game_id)    REFERENCES games(id),
  CONSTRAINT fk_order_package FOREIGN KEY (package_id) REFERENCES packages(id)
) ENGINE=InnoDB;

-- ─── TOPUP LOG ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS topup_logs (
  id          INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  order_id    VARCHAR(30)     NOT NULL,
  event       VARCHAR(40)     NOT NULL,
  status      VARCHAR(20)     NULL,
  payload     JSON            NULL,
  response    JSON            NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_order (order_id)
) ENGINE=InnoDB;

-- ─── PAYMENT LOG ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_logs (
  id          INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  order_id    VARCHAR(30)     NOT NULL,
  event       VARCHAR(40)     NOT NULL,
  provider    VARCHAR(20)     NOT NULL DEFAULT 'tokopay',
  payload     JSON            NULL,
  response    JSON            NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_order (order_id)
) ENGINE=InnoDB;

-- ─── VIEWS ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_order_detail AS
SELECT
  o.order_id, o.created_at,
  g.name AS game_name, g.icon AS game_icon,
  p.name AS package_name, p.sku,
  o.customer_no, o.customer_name,
  o.total_amount, o.payment_method,
  o.payment_status, o.topup_status,
  o.sn, o.paid_at, o.completed_at
FROM orders o
JOIN games    g ON o.game_id    = g.id
JOIN packages p ON o.package_id = p.id;

CREATE OR REPLACE VIEW v_daily_stats AS
SELECT
  DATE(created_at) AS date,
  COUNT(*) AS total_orders,
  SUM(payment_status = 'paid') AS paid_orders,
  SUM(topup_status = 'success') AS success_orders,
  SUM(topup_status = 'failed') AS failed_orders,
  SUM(CASE WHEN payment_status='paid' THEN total_amount ELSE 0 END) AS revenue
FROM orders
GROUP BY DATE(created_at)
ORDER BY date DESC;


-- ── Tabel users (member & reseller) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
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
  INDEX idx_email  (email),
  INDEX idx_phone  (phone),
  INDEX idx_active (is_active)
) ENGINE=InnoDB;

-- ── Tabel balance_topups (pengajuan topup saldo user) ───────────────────────
CREATE TABLE IF NOT EXISTS balance_topups (
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
  INDEX idx_status (status),
  CONSTRAINT fk_topup_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Tabel balance_logs (riwayat mutasi saldo user) ───────────────────────────
CREATE TABLE IF NOT EXISTS balance_logs (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id        INT UNSIGNED  NOT NULL,
  type           ENUM('topup','deduct','refund') NOT NULL,
  amount         DECIMAL(15,2) NOT NULL,
  description    VARCHAR(255)  NULL,
  ref_id         VARCHAR(100)  NULL,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_user (user_id),
  CONSTRAINT fk_log_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- MIGRATION: tambah kolom icon_url jika belum ada
ALTER TABLE games ADD COLUMN IF NOT EXISTS icon_url MEDIUMTEXT NULL AFTER icon;

-- MIGRATION: tambah kolom category_id ke games jika belum ada
ALTER TABLE games ADD COLUMN IF NOT EXISTS category_id INT UNSIGNED NULL AFTER name;
ALTER TABLE games ADD CONSTRAINT IF NOT EXISTS fk_games_category
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL;

-- MIGRATION: tambah kolom type, check_id, additional_data ke categories
ALTER TABLE categories ADD COLUMN IF NOT EXISTS type VARCHAR(30) NULL DEFAULT NULL AFTER slug;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS check_id TINYINT(1) NOT NULL DEFAULT 0 AFTER has_zone_id;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS additional_data TINYINT(1) NOT NULL DEFAULT 0 AFTER check_id;
