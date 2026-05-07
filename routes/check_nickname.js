'use strict';
const router = require('express').Router();
const db     = require('../lib/db');
const axios  = require('axios');
const crypto = require('crypto');

async function getSettings(keys) {
  const placeholders = keys.map(() => '?').join(',');
  const [rows] = await db.query(`SELECT key_name, value FROM settings WHERE key_name IN (${placeholders})`, keys);
  return Object.fromEntries(rows.map(r => [r.key_name, r.value]));
}

router.get('/', async (req, res) => {
  const { game, userId, zoneId } = req.query;
  if (!game || !userId) return res.status(400).json({ success: false, message: 'Parameter tidak lengkap' });

  const cfg = await getSettings(['vip_api_id', 'vip_api_key']);
  const vipApiId  = cfg.vip_api_id  || process.env.VIP_API_ID;
  const vipApiKey = cfg.vip_api_key || process.env.VIP_API_KEY;

  if (!vipApiId || !vipApiKey) return res.json({ success: false, message: 'Layanan cek nickname belum dikonfigurasi' });

  try {
    const sign = crypto.createHash('md5').update(vipApiId + vipApiKey).digest('hex');
    const params = new URLSearchParams({ key: vipApiKey, sign, type: 'get-nickname', code: game, target: userId });
    if (zoneId) params.set('additional_target', zoneId);

    const { data } = await axios.post('https://vip-reseller.co.id/api/game-feature', params.toString(), {
      timeout: 12000, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    if (data && data.result === true) {
      const nick = data.data || data.username || data.nickname || data.name;
      if (nick && String(nick).trim()) return res.json({ success: true, nickname: String(nick).trim() });
    }
    return res.json({ success: false, message: data?.message || 'ID tidak ditemukan' });
  } catch (e) {
    console.error('[check-nickname]', e.message);
    return res.status(500).json({ success: false, message: 'Gagal menghubungi layanan cek nickname' });
  }
});

module.exports = router;
