const router = require('express').Router();
const db     = require('../lib/db');
const auth   = require('../middleware/auth');

// GET /api/settings — public settings (hanya yang boleh publik)
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT key_name, value FROM settings WHERE key_name IN
       ('site_name','site_tagline','logo_url','accent_color','feature_maintenance',
        'feature_guest_checkout','feature_check_nickname','contact_wa','contact_email',
        'social_instagram','social_telegram','footer_text',
        'fee_QRIS','fee_DANA','fee_OVO','fee_GOPAY','fee_SHOPEEPAY',
        'fee_BCA','fee_BNI','fee_BRI','fee_MANDIRI','fee_PERMATA',
        'pay_logo_QRIS','pay_logo_DANA','pay_logo_OVO','pay_logo_GOPAY','pay_logo_SHOPEEPAY',
        'pay_logo_BCA','pay_logo_BNI','pay_logo_BRI','pay_logo_MANDIRI','pay_logo_PERMATA')`
    );
    const settings = Object.fromEntries(rows.map(r => [r.key_name, r.value]));
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memuat pengaturan' });
  }
});

// GET /api/settings/all — semua settings (admin)
router.get('/all', auth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT key_name, value FROM settings');
    const settings = Object.fromEntries(rows.map(r => [r.key_name, r.value]));
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memuat pengaturan' });
  }
});

// PUT /api/settings — update settings (admin)
router.put('/', auth, async (req, res) => {
  try {
    const updates = req.body; // { key_name: value, ... }
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ success: false, message: 'Body tidak valid' });
    }

    for (const [key, value] of Object.entries(updates)) {
      await db.query(
        'INSERT INTO settings (key_name, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=?',
        [key, value, value]
      );
    }

    res.json({ success: true, message: 'Pengaturan berhasil disimpan' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Gagal menyimpan pengaturan' });
  }
});

module.exports = router;
