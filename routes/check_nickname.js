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

  const cfg = await getSettings([
    'vip_api_id', 'vip_api_key',
    'digiflazz_username', 'digiflazz_key_dev', 'digiflazz_key_prod', 'digiflazz_mode'
  ]);

  // ── VIP Reseller API ──────────────────────────────────────────────────────
  // sign = md5(API_ID + API_KEY) — kirim sebagai form-urlencoded
  const vipApiId  = cfg.vip_api_id  || process.env.VIP_API_ID;
  const vipApiKey = cfg.vip_api_key || process.env.VIP_API_KEY;

  if (vipApiId && vipApiKey) {
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
        const nick = data.username || data.nickname || data.name
                  || data.data?.username || data.data?.nickname || data.data?.name;
        if (nick) return res.json({ success: true, nickname: nick, source: 'vip' });
        console.warn('[check-nickname] VIP result=true tapi nick kosong:', JSON.stringify(data));
      } else if (data) {
        const msg = (data.message || '').toLowerCase();
        console.warn('[check-nickname] VIP gagal:', data.message || JSON.stringify(data));
        // Hanya return ke user jika bukan error konfigurasi — biarkan fallback ke Digiflazz
        if (msg && !msg.includes('tidak terdeteksi') && !msg.includes('server error')
            && !msg.includes('parameter') && !msg.includes('invalid')) {
          return res.json({ success: false, message: data.message });
        }
      }
    } catch (e) {
      console.warn('[check-nickname] VIP error:', e.response?.data || e.message);
    }
  } else {
    console.warn('[check-nickname] VIP API ID atau API Key tidak dikonfigurasi di settings');
  }

  // ── Fallback: Digiflazz ──────────────────────────────────────────────────
  const dgUser = cfg.digiflazz_username || process.env.DIGIFLAZZ_USERNAME;
  const mode   = cfg.digiflazz_mode || 'development';
  const dgKey  = mode === 'production'
    ? (cfg.digiflazz_key_prod || process.env.DIGIFLAZZ_API_KEY_PROD)
    : (cfg.digiflazz_key_dev  || process.env.DIGIFLAZZ_API_KEY_DEV);

  if (dgUser && dgKey) {
    try {
      const refId = 'CNK' + Date.now();
      const sign  = crypto.createHash('md5').update(dgUser + dgKey + refId).digest('hex');
      const customerNo = zoneId ? `${userId}/${zoneId}` : userId;

      console.log('[check-nickname] Digiflazz mode:', mode, '| customer_no:', customerNo);

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

      console.log('[check-nickname] Digiflazz response:', JSON.stringify(data).slice(0, 300));

      if (data && data.data) {
        const d = data.data;
        if (d.rc === '00') {
          const nick = d.customer_name || d.message;
          if (nick && nick.trim() !== '') {
            return res.json({ success: true, nickname: nick, source: 'digiflazz' });
          }
        } else if (d.rc === '45') {
          // rc 45 = IP belum di-whitelist di Digiflazz
          const serverIp = await getServerIp();
          console.error(`[check-nickname] Digiflazz rc=45: Whitelist IP "${serverIp}" di dashboard Digiflazz`);
          // jangan expose ke user, sudah log
        } else {
          console.warn('[check-nickname] Digiflazz rc:', d.rc, d.message || '');
          if (d.message) return res.json({ success: false, message: d.message });
        }
      }
    } catch (e) {
      console.warn('[check-nickname] Digiflazz error:', e.response?.data || e.message);
    }
  }

  return res.json({
    success: false,
    message: 'ID tidak ditemukan. Periksa kembali User ID' + (zoneId ? ' dan Zone ID' : '') + '.'
  });
});

module.exports = router;
