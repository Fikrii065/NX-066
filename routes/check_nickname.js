'use strict';
const router = require('express').Router();
const db     = require('../lib/db');
const axios  = require('axios');
const crypto = require('crypto');

async function getSettings(keys) {
  const placeholders = keys.map(() => '?').join(',');
  const [rows] = await db.query(
    `SELECT key_name, value FROM settings WHERE key_name IN (${placeholders})`, keys
  );
  return Object.fromEntries(rows.map(r => [r.key_name, r.value]));
}

let _cachedIp = null, _ipTime = 0;
async function getServerIp() {
  if (_cachedIp && Date.now() - _ipTime < 600000) return _cachedIp;
  try {
    const { data } = await axios.get('https://api.ipify.org?format=json', { timeout: 5000 });
    _cachedIp = data.ip; _ipTime = Date.now(); return _cachedIp;
  } catch {
    try {
      const { data } = await axios.get('https://ipinfo.io/json', { timeout: 5000 });
      _cachedIp = data.ip; _ipTime = Date.now(); return _cachedIp;
    } catch { return null; }
  }
}

router.get('/server-ip', async (req, res) => {
  const ip = await getServerIp();
  res.json({ success: true, ip: ip || 'Tidak dapat diambil' });
});

// GET /api/check-nickname?game=ml&userId=123&zoneId=2070
router.get('/', async (req, res) => {
  const { game, userId, zoneId } = req.query;
  if (!game || !userId) {
    return res.status(400).json({ success: false, message: 'Parameter game dan userId wajib diisi' });
  }

  const cfg = await getSettings(['vip_api_id', 'vip_api_key']);

  const vipApiId  = cfg.vip_api_id  || process.env.VIP_API_ID;
  const vipApiKey = cfg.vip_api_key || process.env.VIP_API_KEY;

  if (!vipApiId || !vipApiKey) {
    console.warn('[check-nickname] VIP API ID atau API Key tidak dikonfigurasi');
    return res.status(503).json({ success: false, message: 'Layanan cek nickname belum dikonfigurasi' });
  }

  try {
    const sign = crypto.createHash('md5')
      .update(vipApiId + vipApiKey)
      .digest('hex');

    const params = new URLSearchParams({
      key:    vipApiKey,
      sign,
      type:   'get-nickname',
      code:   game,
      target: userId,
    });
    if (zoneId) params.set('additional_target', zoneId);

    console.log('[check-nickname] VIP sign generated, sending request...');

    const { data } = await axios.post(
      'https://vip-reseller.co.id/api/game-feature',
      params.toString(),
      { timeout: 12000, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    console.log('[check-nickname] VIP response:', JSON.stringify(data).slice(0, 300));

    if (data && data.result === true) {
      // VIP bisa return nickname di: data, username, nickname, name, atau nested
      const nick = data.data || data.username || data.nickname || data.name
                || data.data?.username || data.data?.nickname || data.data?.name;
      if (nick && String(nick).trim() !== '') {
        return res.json({ success: true, nickname: String(nick).trim(), source: 'vip' });
      }
      console.warn('[check-nickname] VIP result=true tapi nick kosong:', JSON.stringify(data));
      return res.json({ success: false, message: 'Nickname tidak ditemukan' });
    }

    // result false — sampaikan pesan dari VIP ke user
    const msg = data?.message || 'ID tidak ditemukan';
    return res.json({ success: false, message: msg });

  } catch (e) {
    console.error('[check-nickname] VIP error:', e.response?.data || e.message);
    return res.status(500).json({ success: false, message: 'Gagal menghubungi layanan cek nickname' });
  }
});

module.exports = router;
