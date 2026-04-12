const axios = require('axios');
const crypto = require('crypto');

const BASE_URL = 'https://api.digiflazz.com/v1';
const USERNAME = process.env.DIGIFLAZZ_USERNAME;
const API_KEY  = process.env.DIGIFLAZZ_MODE === 'production'
  ? process.env.DIGIFLAZZ_API_KEY_PROD
  : process.env.DIGIFLAZZ_API_KEY_DEV;

function sign(username, apiKey, suffix) {
  return crypto.createHash('md5').update(username + apiKey + suffix).digest('hex');
}

/**
 * Cek saldo Digiflazz
 */
async function getBalance() {
  const signature = sign(USERNAME, API_KEY, 'depo');
  const { data } = await axios.post(`${BASE_URL}/cek-saldo`, {
    cmd:      'deposit',
    username: USERNAME,
    sign:     signature,
  });
  return data.data;
}

/**
 * Cek nickname (via VIP Reseller atau Digiflazz)
 * @param {string} gameCode  - kode game (e.g. 'mobile-legends')
 * @param {string} userId
 * @param {string} [zoneId]
 */
async function checkNickname(gameCode, userId, zoneId) {
  const vipKey = process.env.VIPRESELLER_API_KEY;
  if (vipKey) {
    try {
      const { data } = await axios.post('https://api.vipreseller.id/api/check-nickname', {
        api_key: vipKey,
        game:    gameCode,
        user_id: userId,
        zone_id: zoneId || '',
      });
      if (data.status && data.data?.nickname) {
        return { success: true, nickname: data.data.nickname };
      }
    } catch (e) { /* fallback */ }
  }

  // Fallback: return a generic success (demo/dev mode)
  if (process.env.DIGIFLAZZ_MODE !== 'production') {
    return { success: true, nickname: `User-${userId.slice(-4)}` };
  }

  return { success: false, message: 'Akun tidak ditemukan' };
}

/**
 * Buat transaksi top up di Digiflazz
 * @param {string} refId         - order_id kita
 * @param {string} digiflazzSku  - SKU Digiflazz
 * @param {string} customerNo    - userId atau userId|zoneId
 */
async function createTransaction(refId, digiflazzSku, customerNo) {
  const signature = sign(USERNAME, API_KEY, refId);
  const { data } = await axios.post(`${BASE_URL}/transaction`, {
    username:    USERNAME,
    buyer_sku_code: digiflazzSku,
    customer_no: customerNo,
    ref_id:      refId,
    sign:        signature,
    testing:     process.env.DIGIFLAZZ_MODE !== 'production',
  });
  return data.data;
}

/**
 * Cek status transaksi
 */
async function checkTransaction(refId) {
  const signature = sign(USERNAME, API_KEY, refId);
  const { data } = await axios.post(`${BASE_URL}/transaction`, {
    username: USERNAME,
    ref_id:   refId,
    sign:     signature,
    cmd:      'inquiry-transaction',
  });
  return data.data;
}

/**
 * Verifikasi signature webhook dari Digiflazz
 */
function verifyWebhook(payload, secret) {
  const expected = crypto.createHash('md5').update(USERNAME + secret + payload.ref_id).digest('hex');
  return payload.sign === expected;
}

module.exports = { getBalance, checkNickname, createTransaction, checkTransaction, verifyWebhook };
