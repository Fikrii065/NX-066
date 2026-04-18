const router = require('express').Router();
const db     = require('../lib/db');
const auth   = require('../middleware/auth');

function isBase64(str) {
  return str && str.startsWith('data:image');
}

// FIX #5: Whitelist key yang boleh disimpan via API
const ALLOWED_KEYS = new Set([
  'site_name','site_tagline','logo_url','accent_color','footer_text',
  'markup_percent','markup_minimum',
  'feature_maintenance','feature_guest_checkout','feature_check_nickname','feature_whatsapp_notif',
  'contact_wa','contact_email','social_instagram','social_telegram',
  'tokopay_merchant_id','tokopay_secret_key',
  'digiflazz_username','digiflazz_key_dev','digiflazz_key_prod','digiflazz_mode',
  'vip_api_id','vip_api_key',
  'fonte_token','fonte_device',
  'fee_QRIS','fee_DANA','fee_OVO','fee_GOPAY','fee_SHOPEEPAY',
  'fee_BCA','fee_BNI','fee_BRI','fee_MANDIRI','fee_PERMATA',
  'pay_logo_QRIS','pay_logo_DANA','pay_logo_OVO','pay_logo_GOPAY','pay_logo_SHOPEEPAY',
  'pay_logo_BCA','pay_logo_BNI','pay_logo_BRI','pay_logo_MANDIRI','pay_logo_PERMATA',
  'pay_enabled_QRIS','pay_enabled_DANA','pay_enabled_OVO','pay_enabled_GOPAY','pay_enabled_SHOPEEPAY',
  'pay_enabled_BCA','pay_enabled_BNI','pay_enabled_BRI','pay_enabled_MANDIRI','pay_enabled_PERMATA',
  'pay_channel_QRIS','pay_channel_DANA','pay_channel_OVO','pay_channel_GOPAY','pay_channel_SHOPEEPAY',
  'pay_channel_BCA','pay_channel_BNI','pay_channel_BRI','pay_channel_MANDIRI','pay_channel_PERMATA',
]);

// GET /api/settings/image/:key — serve image dari settings
router.get('/image/:key', async (req, res) => {
  try {
    const [[row]] = await db.query(
      'SELECT value FROM settings WHERE key_name = ? LIMIT 1',
      [req.params.key]
    );
    if (!row || !row.value) return res.status(404).end();
    if (isBase64(row.value)) {
      const match = row.value.match(/^data:(image\/\w+);base64,(.+)$/);
      if (!match) return res.status(400).end();
      const buf = Buffer.from(match[2], 'base64');
      res.set('Content-Type', match[1]);
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(buf);
    }
    res.redirect(row.value);
  } catch (err) {
    res.status(500).end();
  }
});

// GET /api/settings — public settings
router.get('/', async (req, res) => {
  try {
    const IMAGE_KEYS = [
      'logo_url',
      'pay_logo_QRIS','pay_logo_DANA','pay_logo_OVO','pay_logo_GOPAY','pay_logo_SHOPEEPAY',
      'pay_logo_BCA','pay_logo_BNI','pay_logo_BRI','pay_logo_MANDIRI','pay_logo_PERMATA'
    ];
    const [rows] = await db.query(
      `SELECT key_name, value FROM settings WHERE key_name IN
       ('site_name','site_tagline','logo_url','accent_color','feature_maintenance',
        'feature_guest_checkout','feature_check_nickname','contact_wa','contact_email',
        'social_instagram','social_telegram','footer_text',
        'fee_QRIS','fee_DANA','fee_OVO','fee_GOPAY','fee_SHOPEEPAY',
        'fee_BCA','fee_BNI','fee_BRI','fee_MANDIRI','fee_PERMATA',
        'pay_logo_QRIS','pay_logo_DANA','pay_logo_OVO','pay_logo_GOPAY','pay_logo_SHOPEEPAY',
        'pay_logo_BCA','pay_logo_BNI','pay_logo_BRI','pay_logo_MANDIRI','pay_logo_PERMATA',
        'pay_enabled_QRIS','pay_enabled_DANA','pay_enabled_OVO','pay_enabled_GOPAY','pay_enabled_SHOPEEPAY',
        'pay_enabled_BCA','pay_enabled_BNI','pay_enabled_BRI','pay_enabled_MANDIRI','pay_enabled_PERMATA',
        'pay_channel_QRIS','pay_channel_DANA','pay_channel_OVO','pay_channel_GOPAY','pay_channel_SHOPEEPAY',
        'pay_channel_BCA','pay_channel_BNI','pay_channel_BRI','pay_channel_MANDIRI','pay_channel_PERMATA')`
    );
    const settings = {};
    rows.forEach(r => {
      if (IMAGE_KEYS.includes(r.key_name) && isBase64(r.value)) {
        settings[r.key_name] = `/api/settings/image/${r.key_name}`;
      } else {
        settings[r.key_name] = r.value;
      }
    });
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memuat pengaturan' });
  }
});

// GET /api/settings/all — semua settings (admin)
router.get('/all', auth, async (req, res) => {
  try {
    const IMAGE_KEYS = [
      'logo_url',
      'pay_logo_QRIS','pay_logo_DANA','pay_logo_OVO','pay_logo_GOPAY','pay_logo_SHOPEEPAY',
      'pay_logo_BCA','pay_logo_BNI','pay_logo_BRI','pay_logo_MANDIRI','pay_logo_PERMATA'
    ];
    const [rows] = await db.query('SELECT key_name, value FROM settings');
    const settings = {};
    rows.forEach(r => {
      if (IMAGE_KEYS.includes(r.key_name) && isBase64(r.value)) {
        settings[r.key_name] = `/api/settings/image/${r.key_name}`;
      } else {
        settings[r.key_name] = r.value;
      }
    });
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memuat pengaturan' });
  }
});

// PUT /api/settings — update settings (admin) dengan whitelist key
router.put('/', auth, async (req, res) => {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ success: false, message: 'Body tidak valid' });
    }

    // FIX #5: Filter hanya key yang ada di whitelist
    const filtered = Object.entries(updates).filter(([key]) => ALLOWED_KEYS.has(key));
    const rejected = Object.keys(updates).filter(key => !ALLOWED_KEYS.has(key));

    if (rejected.length > 0) {
      console.warn('[Settings] Key tidak diizinkan ditolak:', rejected);
    }

    if (filtered.length === 0) {
      return res.status(400).json({ success: false, message: 'Tidak ada key valid yang bisa disimpan' });
    }

    for (const [key, value] of filtered) {
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
