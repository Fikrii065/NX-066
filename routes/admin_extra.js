/**
 * admin_extra.js — Missing routes untuk fitur-fitur admin panel
 * Flash Sale, Admins, Sell Accounts, Membership, Settings POST, Fonnte Test, User Level
 */
const router  = require('express').Router();
const db      = require('../lib/db');
const auth    = require('../middleware/auth');
const bcrypt  = require('bcryptjs');
const axios   = require('axios');

// ─── SETTINGS POST (alias untuk PUT /api/settings) ───────────────────────────
// Frontend memanggil POST /api/admin/settings untuk semua save settings
const SETTINGS_ALLOWED = new Set([
  'site_name','site_tagline','logo_url','accent_color','footer_text',
  'markup_percent','markup_minimum',
  'feature_maintenance','feature_guest_checkout','feature_check_nickname','feature_whatsapp_notif',
  'contact_wa','contact_email','instagram','tiktok','facebook','youtube','telegram',
  'social_instagram','social_telegram',
  'tokopay_merchant_id','tokopay_secret_key',
  'digiflazz_username','digiflazz_key_dev','digiflazz_key_prod','digiflazz_mode',
  'vip_api_id','vip_api_key',
  'fonnte_token','fonnte_number','fonte_token','fonte_device',
  'notif_new_order','notif_paid','notif_topup','notif_failed',
  'tmpl_success','tmpl_failed',
  'popup_active','popup_title','popup_message','popup_image',
  'terms_and_conditions','tnc',
  'fee_QRIS','fee_DANA','fee_OVO','fee_GOPAY','fee_SHOPEEPAY',
  'fee_BCA','fee_BNI','fee_BRI','fee_MANDIRI','fee_PERMATA',
  'pay_enabled_QRIS','pay_enabled_DANA','pay_enabled_OVO','pay_enabled_GOPAY','pay_enabled_SHOPEEPAY',
  'pay_enabled_BCA','pay_enabled_BNI','pay_enabled_BRI','pay_enabled_MANDIRI','pay_enabled_PERMATA',
  'pay_channel_QRIS','pay_channel_DANA','pay_channel_OVO','pay_channel_GOPAY','pay_channel_SHOPEEPAY',
  'pay_channel_BCA','pay_channel_BNI','pay_channel_BRI','pay_channel_MANDIRI','pay_channel_PERMATA',
  'pay_logo_QRIS','pay_logo_DANA','pay_logo_OVO','pay_logo_GOPAY','pay_logo_SHOPEEPAY',
  'pay_logo_BCA','pay_logo_BNI','pay_logo_BRI','pay_logo_MANDIRI','pay_logo_PERMATA',
]);

router.post('/settings', auth, async (req, res) => {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ success: false, message: 'Body tidak valid' });
    }
    const filtered = Object.entries(updates).filter(([k]) => SETTINGS_ALLOWED.has(k));
    if (filtered.length === 0) {
      // Kalau key tidak ada di whitelist, tetap simpan semua (admin bisa extend)
      const allEntries = Object.entries(updates);
      for (const [key, value] of allEntries) {
        await db.query(
          'INSERT INTO settings (key_name, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=?',
          [key, String(value ?? ''), String(value ?? '')]
        );
      }
      return res.json({ success: true, message: 'Pengaturan berhasil disimpan' });
    }
    for (const [key, value] of filtered) {
      await db.query(
        'INSERT INTO settings (key_name, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=?',
        [key, String(value ?? ''), String(value ?? '')]
      );
    }
    res.json({ success: true, message: 'Pengaturan berhasil disimpan' });
  } catch (err) {
    console.error('[admin/settings POST]', err.message);
    res.status(500).json({ success: false, message: 'Gagal menyimpan pengaturan' });
  }
});

// ─── FONNTE TEST ──────────────────────────────────────────────────────────────
router.post('/fonnte/test', auth, async (req, res) => {
  try {
    const { token, number } = req.body;
    if (!token || !number) {
      return res.status(400).json({ success: false, message: 'Token dan nomor wajib diisi' });
    }
    const { data } = await axios.post('https://api.fonnte.com/send', {
      target: number,
      message: '✅ Test notifikasi dari GameFlash Admin Panel berhasil!',
    }, {
      headers: { Authorization: token },
      timeout: 10000,
    });
    if (data.status) {
      res.json({ success: true, message: 'Pesan test berhasil dikirim' });
    } else {
      res.json({ success: false, message: data.reason || 'Gagal mengirim pesan' });
    }
  } catch (err) {
    console.error('[fonnte/test]', err.message);
    res.status(500).json({ success: false, message: 'Gagal terhubung ke Fonnte: ' + err.message });
  }
});

// ─── FLASH SALE ───────────────────────────────────────────────────────────────
router.get('/flash-sale', auth, async (req, res) => {
  try {
    // Coba buat tabel kalau belum ada
    await db.query(`
      CREATE TABLE IF NOT EXISTS flash_sales (
        id INT AUTO_INCREMENT PRIMARY KEY,
        package_id INT NOT NULL,
        discount_price INT NOT NULL,
        start_time DATETIME NOT NULL,
        end_time DATETIME NOT NULL,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const [rows] = await db.query(`
      SELECT fs.*, p.name AS package_name, p.base_price, g.name AS game_name
      FROM flash_sales fs
      LEFT JOIN packages p ON fs.package_id = p.id
      LEFT JOIN games g ON p.game_id = g.id
      ORDER BY fs.created_at DESC
    `);
    res.json({ success: true, sales: rows });
  } catch (err) {
    console.error('[flash-sale GET]', err.message);
    res.status(500).json({ success: false, message: 'Gagal memuat flash sale' });
  }
});

router.post('/flash-sale', auth, async (req, res) => {
  try {
    const { package_id, discount_price, start_time, end_time } = req.body;
    if (!package_id || !discount_price || !start_time || !end_time) {
      return res.status(400).json({ success: false, message: 'Semua field wajib diisi' });
    }
    await db.query(
      'INSERT INTO flash_sales (package_id, discount_price, start_time, end_time, is_active) VALUES (?,?,?,?,1)',
      [package_id, discount_price, start_time, end_time]
    );
    res.json({ success: true, message: 'Flash sale berhasil ditambahkan' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/flash-sale/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM flash_sales WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Flash sale dihapus' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── KELOLA ADMIN ─────────────────────────────────────────────────────────────
router.get('/admins', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, username, email, role, is_active, last_login, created_at FROM admins ORDER BY created_at DESC'
    );
    res.json({ success: true, admins: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/admins', auth, async (req, res) => {
  try {
    const { username, email, password, role = 'admin' } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username dan password wajib diisi' });
    }
    const [[existing]] = await db.query('SELECT id FROM admins WHERE username = ? OR email = ?', [username, email || username]);
    if (existing) {
      return res.status(409).json({ success: false, message: 'Username atau email sudah digunakan' });
    }
    const hashed = await bcrypt.hash(password, 10);
    await db.query(
      'INSERT INTO admins (username, email, password, role, is_active) VALUES (?,?,?,?,1)',
      [username, email || null, hashed, role]
    );
    res.json({ success: true, message: 'Admin berhasil ditambahkan' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/admins/:id', auth, async (req, res) => {
  try {
    const { username, email, role, password } = req.body;
    if (password) {
      const hashed = await bcrypt.hash(password, 10);
      await db.query('UPDATE admins SET username=?, email=?, role=?, password=? WHERE id=?',
        [username, email || null, role, hashed, req.params.id]);
    } else {
      await db.query('UPDATE admins SET username=?, email=?, role=? WHERE id=?',
        [username, email || null, role, req.params.id]);
    }
    res.json({ success: true, message: 'Admin berhasil diperbarui' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/admins/:id', auth, async (req, res) => {
  try {
    // Jangan hapus diri sendiri
    if (parseInt(req.params.id) === req.admin.id) {
      return res.status(400).json({ success: false, message: 'Tidak bisa menghapus akun sendiri' });
    }
    await db.query('DELETE FROM admins WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Admin dihapus' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── KELOLA AKUN DIJUAL ───────────────────────────────────────────────────────
router.get('/sell-accounts', auth, async (req, res) => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS sell_accounts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        game_name VARCHAR(100) NOT NULL,
        description TEXT,
        price INT NOT NULL DEFAULT 0,
        contact VARCHAR(100),
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const [rows] = await db.query('SELECT * FROM sell_accounts ORDER BY created_at DESC');
    res.json({ success: true, accounts: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/sell-accounts', auth, async (req, res) => {
  try {
    const { game_name, description, price, contact } = req.body;
    if (!game_name || !price) {
      return res.status(400).json({ success: false, message: 'Nama game dan harga wajib diisi' });
    }
    await db.query(
      'INSERT INTO sell_accounts (game_name, description, price, contact, is_active) VALUES (?,?,?,?,1)',
      [game_name, description || '', price, contact || '']
    );
    res.json({ success: true, message: 'Akun berhasil ditambahkan' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/sell-accounts/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM sell_accounts WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Akun dihapus' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── SISTEM KEANGGOTAAN ───────────────────────────────────────────────────────
router.get('/membership-config', auth, async (req, res) => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS membership_config (
        id INT AUTO_INCREMENT PRIMARY KEY,
        level VARCHAR(50) NOT NULL UNIQUE,
        min_transaction INT NOT NULL DEFAULT 0,
        discount_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    const [rows] = await db.query('SELECT * FROM membership_config ORDER BY min_transaction ASC');
    res.json({ success: true, config: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/membership-config', auth, async (req, res) => {
  try {
    const { level, min_transaction, discount_pct } = req.body;
    if (!level) {
      return res.status(400).json({ success: false, message: 'Level wajib diisi' });
    }
    await db.query(`
      INSERT INTO membership_config (level, min_transaction, discount_pct)
      VALUES (?,?,?)
      ON DUPLICATE KEY UPDATE min_transaction=?, discount_pct=?
    `, [level, min_transaction || 0, discount_pct || 0, min_transaction || 0, discount_pct || 0]);
    res.json({ success: true, message: 'Konfigurasi keanggotaan disimpan' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── LEVEL PELANGGAN (PATCH /api/admin/users/:id/level) ──────────────────────
router.patch('/users/:id/level', auth, async (req, res) => {
  try {
    const { level } = req.body;
    if (!level) {
      return res.status(400).json({ success: false, message: 'Level wajib diisi' });
    }
    // Coba kolom membership_level dulu, fallback ke role
    try {
      await db.query('UPDATE users SET membership_level=? WHERE id=?', [level, req.params.id]);
    } catch {
      await db.query('UPDATE users SET role=? WHERE id=?', [level, req.params.id]);
    }
    res.json({ success: true, message: 'Level pelanggan diperbarui' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
