-- ─── VOUCHER DISKON ─────────────────────────────────────────────────────────
-- Jalankan query ini di database untuk mengaktifkan fitur Voucher Diskon

CREATE TABLE IF NOT EXISTS discount_vouchers (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tambahkan kolom discount_voucher_id ke tabel orders (opsional, untuk tracking)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS discount_code   VARCHAR(50)   NULL AFTER payment_method,
  ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(12,2) NULL AFTER discount_code;

-- Data contoh (bisa dihapus setelah testing)
INSERT IGNORE INTO discount_vouchers (code, name, description, discount_type, discount_value, min_purchase, max_discount, quota, valid_from, valid_until, is_active)
VALUES
  ('HEMAT10', 'Diskon 10%', 'Diskon 10% untuk semua produk', 'percent', 10, 10000, 20000, 100, NOW(), DATE_ADD(NOW(), INTERVAL 30 DAY), 1),
  ('SELAMAT5K', 'Potongan 5.000', 'Potongan Rp 5.000 min. pembelian Rp 20.000', 'fixed', 5000, 20000, NULL, 50, NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY), 1);
