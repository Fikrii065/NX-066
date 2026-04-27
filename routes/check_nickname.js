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

  // ── VIP Reseller API ──────────────────────────────────────────────────────
  // Dokumentasi: POST https://vip-reseller.co.id/api/game-feature
  // Parameter: kunci, tanda (md5(API_ID+API_KEY)), jenis, kode, target, target_tambahan
  if (cfg.vip_api_id && cfg.vip_api_key) {
    try {
      const tanda = crypto.createHash('md5')
        .update(cfg.vip_api_id + cfg.vip_api_key)
        .digest('hex');

      const body = {
        kunci:  cfg.vip_api_key,
        tanda,
        jenis:  'dapatkan nama panggilan',
        kode:   game,
        target: userId,
        ...(zoneId ? { target_tambahan: zoneId } : {})
      };

      const { data } = await axios.post(
        'https://vip-reseller.co.id/api/game-feature',
        body,
        { timeout: 12000, headers: { 'Content-Type': 'application/json' } }
      );

      if (data) {
        console.log('[check-nickname] VIP response:', JSON.stringify(data).slice(0, 200));
        // rc '00' = sukses
        if (data.rc === '00') {
          const nick = data.username || data.nickname || data.name
                    || data.data?.username || data.data?.nickname || data.data?.name;
          if (nick) return res.json({ success: true, nickname: nick, source: 'vip' });
        } else {
          console.warn('[check-nickname] VIP rc:', data.rc, data.pesan || data.message || '');
        }
      }
    } catch (e) {
      console.warn('[check-nickname] VIP error:', e.response?.data || e.message);
    }
  }

  // ── Fallback: Digiflazz ───────────────────────────────────────────────────
  // Endpoint: POST /v1/transaction dengan cmd: check-nick
  // customer_no untuk ML: userId_zoneId (pakai underscore/slash tergantung game)
  const dgUser = cfg.digiflazz_username || process.env.DIGIFLAZZ_USERNAME;
  const mode   = cfg.digiflazz_mode || 'development';
  const dgKey  = mode === 'production'
    ? (cfg.digiflazz_key_prod || process.env.DIGIFLAZZ_API_KEY_PROD)
    : (cfg.digiflazz_key_dev  || process.env.DIGIFLAZZ_API_KEY_DEV);

  if (dgUser && dgKey) {
    try {
      const refId = 'CNK' + Date.now();
      const sign  = crypto.createHash('md5').update(dgUser + dgKey + refId).digest('hex');

      // Format customer_no: untuk game yang punya zone, pakai format "userId/zoneId"
      const customerNo = zoneId ? `${userId}/${zoneId}` : userId;

      const { data } = await axios.post(
        'https://api.digiflazz.com/v1/transaction',
        {
          username:       dgUser,
          buyer_sku_code: game,
          customer_no:    customerNo,
          ref_id:         refId,
          sign,
          cmd:            'check-nick'
        },
        { timeout: 12000 }
      );

      console.log('[check-nickname] Digiflazz response:', JSON.stringify(data).slice(0, 200));

      if (data && data.data) {
        const d = data.data;
        if (d.rc === '00') {
          const nick = d.customer_name || d.message;
          if (nick && nick.trim() !== '') {
            return res.json({ success: true, nickname: nick, source: 'digiflazz' });
          }
        } else {
          console.warn('[check-nickname] Digiflazz rc:', d.rc, d.message || '');
        }
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
