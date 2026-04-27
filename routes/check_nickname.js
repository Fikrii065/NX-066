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
  // Response pakai field "result" (bool) bukan "rc"
  // "jenis" yang benar dicoba beberapa kemungkinan nilai
  if (cfg.vip_api_id && cfg.vip_api_key) {
    const tanda = crypto.createHash('md5')
      .update(cfg.vip_api_id + cfg.vip_api_key)
      .digest('hex');

    // Coba beberapa nilai "jenis" yang mungkin benar
    const jenisList = ['get-nickname', 'check-nick', 'nickname', 'cek-nick'];

    for (const jenis of jenisList) {
      try {
        const body = {
          kunci:  cfg.vip_api_key,
          tanda,
          jenis,
          kode:   game,
          target: userId,
          ...(zoneId ? { target_tambahan: zoneId } : {})
        };

        const { data } = await axios.post(
          'https://vip-reseller.co.id/api/game-feature',
          body,
          { timeout: 10000, headers: { 'Content-Type': 'application/json' } }
        );

        console.log(`[check-nickname] VIP jenis="${jenis}" response:`, JSON.stringify(data).slice(0, 300));

        if (data && data.result === true) {
          // Sukses — ambil nickname dari berbagai field yang mungkin
          const nick = data.username || data.nickname || data.name
                    || (Array.isArray(data.data) ? null : (data.data?.username || data.data?.nickname || data.data?.name));
          if (nick) return res.json({ success: true, nickname: nick, source: 'vip' });
          // result true tapi tidak ada field nickname — log detail
          console.warn('[check-nickname] VIP result=true tapi nick kosong:', JSON.stringify(data));
          break;
        }

        // Jika pesan bukan "tidak terdeteksi", artinya jenis sudah benar tapi ID salah
        const msg = (data?.message || '').toLowerCase();
        if (!msg.includes('tidak terdeteksi') && !msg.includes('not found type')) {
          // jenis ini diterima server tapi ID salah
          return res.json({ success: false, message: data.message || 'ID tidak ditemukan' });
        }
        // Kalau "tidak terdeteksi" → coba jenis berikutnya
      } catch (e) {
        console.warn(`[check-nickname] VIP jenis="${jenis}" error:`, e.response?.data || e.message);
        break;
      }
    }
  }

  // ── Fallback: Digiflazz ───────────────────────────────────────────────────
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
        } else {
          console.warn('[check-nickname] Digiflazz rc:', d.rc, d.message || '');
          // Jika ada pesan spesifik dari Digiflazz (bukan error teknis), return ke user
          if (d.message && d.rc !== '14') {
            return res.json({ success: false, message: d.message });
          }
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
