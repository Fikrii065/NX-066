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
    _cachedIp = data.ip; _ipTime = Date.now(); return _cachedIp;
  } catch {
    try {
      const { data } = await axios.get('https://ipinfo.io/json', { timeout: 5000 });
      _cachedIp = data.ip; _ipTime = Date.now(); return _cachedIp;
    } catch { return null; }
  }
}

// GET /api/server-ip
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

  // ── VIP Reseller API (domain resmi: vip-reseller.co.id) ──────────────────
  if (cfg.vip_api_id && cfg.vip_api_key) {
    try {
      const sign = crypto.createHash('md5').update(cfg.vip_api_id + cfg.vip_api_key).digest('hex');
      const body = {
        key:     cfg.vip_api_key,
        sign,
        type:    'check-nick',
        game_id: game,
        user_id: userId,
        ...(zoneId ? { zone_id: zoneId } : {})
      };
      const { data } = await axios.post(
        'https://vip-reseller.co.id/api/game-feature',
        body,
        { timeout: 12000, headers: { 'Content-Type': 'application/json' } }
      );
      if (data && data.rc === '00') {
        const nick = data.username || data.nickname || data.name
                  || data.data?.username || data.data?.nickname || data.data?.name;
        if (nick) return res.json({ success: true, nickname: nick, source: 'vip' });
      } else if (data) {
        console.warn('[check-nickname] VIP rc:', data.rc, data.message || '');
      }
    } catch (e) {
      console.warn('[check-nickname] VIP error:', e.message);
    }
  }

  // ── Fallback: Digiflazz (POST /v1/transaction, cmd: check-nick) ──────────
  const dgUser = cfg.digiflazz_username || process.env.DIGIFLAZZ_USERNAME;
  const mode   = cfg.digiflazz_mode || 'development';
  const dgKey  = mode === 'production'
    ? (cfg.digiflazz_key_prod || process.env.DIGIFLAZZ_API_KEY_PROD)
    : (cfg.digiflazz_key_dev  || process.env.DIGIFLAZZ_API_KEY_DEV);

  if (dgUser && dgKey) {
    try {
      const refId = 'CNK' + Date.now();
      const sign  = crypto.createHash('md5').update(dgUser + dgKey + refId).digest('hex');
      const { data } = await axios.post(
        'https://api.digiflazz.com/v1/transaction',
        {
          username:       dgUser,
          buyer_sku_code: game,
          customer_no:    zoneId ? `${userId}/${zoneId}` : userId,
          ref_id:         refId,
          sign,
          cmd:            'check-nick'
        },
        { timeout: 12000 }
      );
      if (data && data.data && data.data.rc === '00') {
        const nick = data.data.customer_name || data.data.message;
        if (nick && !nick.toLowerCase().includes('gagal')) {
          return res.json({ success: true, nickname: nick, source: 'digiflazz' });
        }
      }
      if (data && data.data) {
        console.warn('[check-nickname] Digiflazz rc:', data.data.rc, data.data.message || '');
      }
    } catch (e) {
      console.warn('[check-nickname] Digiflazz error:', e.response?.data?.message || e.message);
    }
  }

  return res.json({
    success: false,
    message: 'ID tidak ditemukan. Periksa kembali User ID' + (zoneId ? ' dan Zone ID' : '') + '.'
  });
});

module.exports = router;
