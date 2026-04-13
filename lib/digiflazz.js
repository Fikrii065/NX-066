const axios  = require('axios');
const crypto = require('crypto');

const BASE_URL = 'https://api.digiflazz.com/v1';

function sign(username, apiKey, suffix) {
  return crypto.createHash('md5').update(username + apiKey + suffix).digest('hex');
}

/**
 * Ambil kredensial Digiflazz dari DB (prioritas) atau ENV (fallback)
 */
async function getCreds() {
  try {
    const db = require('./db');
    const [rows] = await db.query(
      "SELECT key_name, value FROM settings WHERE key_name IN ('digiflazz_username','digiflazz_key_dev','digiflazz_key_prod','digiflazz_mode')"
    );
    const cfg  = Object.fromEntries(rows.map(r => [r.key_name, r.value]));
    const mode = cfg.digiflazz_mode || process.env.DIGIFLAZZ_MODE || 'development';
    const username = cfg.digiflazz_username || process.env.DIGIFLAZZ_USERNAME || '';
    const apiKey   = mode === 'production'
      ? (cfg.digiflazz_key_prod || process.env.DIGIFLAZZ_API_KEY_PROD || '')
      : (cfg.digiflazz_key_dev  || process.env.DIGIFLAZZ_API_KEY_DEV  || '');
    return { username, apiKey, mode };
  } catch (e) {
    const mode = process.env.DIGIFLAZZ_MODE || 'development';
    return {
      username: process.env.DIGIFLAZZ_USERNAME || '',
      apiKey:   mode === 'production' ? (process.env.DIGIFLAZZ_API_KEY_PROD || '') : (process.env.DIGIFLAZZ_API_KEY_DEV || ''),
      mode,
    };
  }
}

async function getBalance() {
  const { username, apiKey } = await getCreds();
  if (!username || !apiKey) throw new Error('Kredensial Digiflazz belum dikonfigurasi');
  const signature = sign(username, apiKey, 'depo');
  const { data } = await axios.post(`${BASE_URL}/cek-saldo`, {
    cmd: 'deposit', username, sign: signature,
  }, { timeout: 10000 });
  return data.data;
}

async function checkNickname(gameCode, userId, zoneId) {
  // Baca dari DB settings dulu, fallback ke ENV
  let apiId, apiKey;
  try {
    const db = require('./db');
    const [rows] = await db.query(
      "SELECT key_name, value FROM settings WHERE key_name IN ('vip_api_id','vip_api_key')"
    );
    const cfg = Object.fromEntries(rows.map(r => [r.key_name, r.value]));
    apiId  = cfg.vip_api_id  || process.env.VIPRESELLER_API_ID;
    apiKey = cfg.vip_api_key || process.env.VIPRESELLER_API_KEY;
  } catch(e) {
    apiId  = process.env.VIPRESELLER_API_ID;
    apiKey = process.env.VIPRESELLER_API_KEY;
  }

  if (apiId && apiKey) {
    try {
      // VIP Reseller: sign = md5(API ID + API KEY) sesuai dokumentasi
      const signHash = crypto.createHash('md5').update(apiId + apiKey).digest('hex');

      // VIP Reseller: POST multipart/form-data
      // Dokumentasi: key, sign, type, code, target, additional_target
      const FormData = require('form-data');
      const form = new FormData();
      form.append('key',    apiKey);
      form.append('sign',   signHash);
      form.append('type',   'get-nickname');
      form.append('code',   gameCode);
      form.append('target', userId);
      // Hanya kirim additional_target jika tidak kosong
      if (zoneId && zoneId.trim() !== '') {
        form.append('additional_target', zoneId.trim());
      }

      // Log payload sebelum dikirim untuk memudahkan debug
      console.log('[VIP Reseller] Sending request:', {
        key:               apiKey,
        sign:              signHash,
        type:              'get-nickname',
        code:              gameCode,
        target:            userId,
        additional_target: zoneId || '(kosong)',
      });

      const { data } = await axios.post('https://vip-reseller.co.id/api/game-feature', form, {
        headers: form.getHeaders(),
        timeout: 8000,
      });
      console.log('[VIP Reseller] game=%s response=%s', gameCode, JSON.stringify(data));

      // VIP Reseller menggunakan field "result"
      if (data.result === true && data.data?.nickname) {
        return { success: true, nickname: data.data.nickname };
      }

      // Kembalikan pesan asli dari VIP Reseller agar mudah debug
      const errMsg = data.data?.message || data.message || 'Akun tidak ditemukan';
      return { success: false, message: errMsg };
    } catch (e) {
      console.error('[VIP Reseller] error:', e.response?.data || e.message);
      return { success: false, message: 'Gagal menghubungi VIP Reseller: ' + e.message };
    }
  }

  const { mode } = await getCreds();
  if (mode !== 'production') return { success: true, nickname: `User-${userId.slice(-4)}` };
  return { success: false, message: 'Kredensial VIP Reseller belum dikonfigurasi' };
}

async function createTransaction(refId, digiflazzSku, customerNo) {
  const { username, apiKey, mode } = await getCreds();
  if (!username || !apiKey) throw new Error('Kredensial Digiflazz belum dikonfigurasi');
  const signature = sign(username, apiKey, refId);
  const { data } = await axios.post(`${BASE_URL}/transaction`, {
    username, buyer_sku_code: digiflazzSku, customer_no: customerNo,
    ref_id: refId, sign: signature, testing: mode !== 'production',
  }, { timeout: 15000 });
  return data.data;
}

async function checkTransaction(refId) {
  const { username, apiKey } = await getCreds();
  if (!username || !apiKey) throw new Error('Kredensial Digiflazz belum dikonfigurasi');
  const signature = sign(username, apiKey, refId);
  const { data } = await axios.post(`${BASE_URL}/transaction`, {
    username, ref_id: refId, sign: signature, cmd: 'inquiry-transaction',
  }, { timeout: 10000 });
  return data.data;
}

async function verifyWebhook(payload, secret) {
  const { username } = await getCreds();
  const expected = crypto.createHash('md5').update(username + secret + payload.ref_id).digest('hex');
  return payload.sign === expected;
}

module.exports = { getBalance, checkNickname, createTransaction, checkTransaction, verifyWebhook };
