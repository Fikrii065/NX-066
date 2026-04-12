const router      = require('express').Router();
const { checkNickname } = require('../lib/digiflazz');
const db          = require('../lib/db');

// GET /api/check-nickname?game=mobile-legends&userId=123&zoneId=456
router.get('/', async (req, res) => {
  try {
    const { game, userId, zoneId } = req.query;
    if (!game || !userId) {
      return res.status(400).json({ success: false, message: 'Parameter game dan userId wajib diisi' });
    }

    // Cek fitur aktif
    const [[setting]] = await db.query(
      "SELECT value FROM settings WHERE key_name = 'feature_check_nickname'"
    );
    if (setting?.value === '0') {
      // Fitur cek nickname dimatikan — langsung lolos
      return res.json({ success: true, nickname: `User ${userId}` });
    }

    // Ambil vip_code dari database
    const [[gameRow]] = await db.query(
      'SELECT vip_code, params FROM games WHERE code = ? AND is_active = 1',
      [game]
    );
    if (!gameRow) {
      return res.status(404).json({ success: false, message: 'Game tidak ditemukan' });
    }

    const result = await checkNickname(gameRow.vip_code || game, userId, zoneId || '');
    res.json(result);
  } catch (err) {
    console.error('check-nickname error:', err.message);
    res.status(502).json({ success: false, message: 'Gagal menghubungi server cek nickname' });
  }
});

module.exports = router;
