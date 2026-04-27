'use strict';
const router = require('express').Router();
const db     = require('../lib/db');
const axios  = require('axios');
const crypto = require('crypto');

// Helper: ambil config dari settings DB
async function getSettings(keys) {
  const placeholders = keys.map(() => '?').join(',');
  const [rows] = await db.query(
    `SELECT key_name, value FROM settings WHERE key_name IN (${placeholders})`,
    keys
  );
  return Object.fromEntries(rows.map(r => [r.key_name, r.value]));
}

// Helper: ambil IP publik server (cache 10 menit)
let _cachedIp = null, _ipTime = 0;
async function getServerIp() {
  if (_cachedIp && Date.now() - _ipTime < 600000) return _cachedIp;
  try {
    const { data } = await axios.get('https://api.ipify.org?format=json', { timeout: 5000 });
    _cachedIp = data.ip;
    _ipTime = Date.now();
    return _cachedIp;
  } catch {
    return null;
  }
}

// GET /api/server-ip — tampilkan IP publik Railway (untuk whitelist VIP Reseller)
router.get('/server-ip', async (req, res) => {
  const ip = await getServerIp();
  res.json({ success: true, ip: ip || 'Tidak dapat diambil' });
});

// GET /api/check-nickname?game=mobile-legends&userId=123&zoneId=2070
router.get('/', async (req, res) => {
  const { game, userId, zoneId } = req.query;
  if (!game || !userId) {
    return res.status(400).json({ success: false, message: 'Parameter game dan userId wajib diisi' });
  }

  const cfg = await getSettings([
    'vip_api_id', 'vip_api_key',
    'digiflazz_username', 'digiflazz_key_dev', 'digiflazz_key_prod', 'digiflazz_mode'
  ]);

  // ── Coba VIP Reseller API dulu ────────────────────────────────────────────
  if (cfg.vip_api_id && cfg.vip_api_key) {
    try {
      const params = new URLSearchParams({
        api_id:  cfg.vip_api_id,
        api_key: cfg.vip_api_key,
        game:    game,
        user_id: userId,
        ...(zoneId ? { zone_id: zoneId } : {})
      });
      const { data } = await axios.get(
        `https://api.vip-reseller.com/api/check-game-username?${params}`,
        { timeout: 10000 }
      );
      if (data && (data.success || data.status === true || data.status === 'success')) {
        const nick = data.username || data.nickname || data.data?.username || data.data?.nickname;
        if (nick) return res.json({ success: true, nickname: nick, source: 'vip' });
      }
      // VIP gagal — lanjut ke fallback
      console.warn('[check-nickname] VIP gagal:', JSON.stringify(data).slice(0, 200));
    } catch (e) {
      console.warn('[check-nickname] VIP error:', e.message);
    }
  }

  // ── Fallback: Digiflazz nickname check ───────────────────────────────────
  const username = cfg.digiflazz_username || process.env.DIGIFLAZZ_USERNAME;
  const mode     = cfg.digiflazz_mode || 'development';
  const apiKey   = mode === 'production'
    ? (cfg.digiflazz_key_prod || process.env.DIGIFLAZZ_API_KEY_PROD)
    : (cfg.digiflazz_key_dev  || process.env.DIGIFLAZZ_API_KEY_DEV);

  if (username && apiKey) {
    try {
      const sign = crypto.createHash('md5').update(username + apiKey + 'check-nickname').digest('hex');
      const body = { commands: 'checkNickname', username, sign, game_code: game, user_id: userId };
      if (zoneId) body.zone_id = zoneId;
      const { data } = await axios.post('https://api.digiflazz.com/v1/check-nickname', body, { timeout: 10000 });
      if (data && data.data) {
        const nick = data.data.username || data.data.nickname || data.data.name;
        if (nick) return res.json({ success: true, nickname: nick, source: 'digiflazz' });
      }
    } catch (e) {
      console.warn('[check-nickname] Digiflazz fallback error:', e.message);
    }
  }

  return res.json({ success: false, message: 'ID tidak ditemukan atau layanan cek nickname belum dikonfigurasi' });
});

module.exports = router;
