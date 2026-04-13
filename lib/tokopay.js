const axios  = require('axios');
const crypto = require('crypto');

const BASE_URL = 'https://api.tokopay.id';

/**
 * Buat pembayaran baru - menggunakan GET sesuai dokumentasi Tokopay
 */
async function createPayment({ orderId, amount, method, description, email, phone, merchantId, secretKey, returnUrl }) {
  const MERCHANT   = merchantId  || process.env.TOKOPAY_MERCHANT_ID;
  const SECRET_KEY = secretKey   || process.env.TOKOPAY_SECRET_KEY;

  if (!MERCHANT || !SECRET_KEY) {
    throw new Error('Tokopay credentials belum dikonfigurasi');
  }

  // Tokopay: GET /v1/order?merchant=...&secret=...&ref_id=...&nominal=...&metode=...
  const params = new URLSearchParams({
    merchant: MERCHANT,
    secret:   SECRET_KEY,
    ref_id:   orderId,
    nominal:  amount,
    metode:   method,
  });

  // Tambah return_url agar setelah bayar redirect ke invoice kita, bukan homepage Tokopay
  if (returnUrl) {
    params.append('return_url', returnUrl);
  }

  console.log('[Tokopay] Sending request:', { merchant: MERCHANT, ref_id: orderId, nominal: amount, metode: method });

  const { data } = await axios.get(`${BASE_URL}/v1/order?${params.toString()}`, {
    timeout: 15000,
  });

  console.log('[Tokopay] Response:', JSON.stringify(data));

  if (!data || data.status !== 'Success') {
    throw new Error(data?.data?.message || data?.message || 'Gagal membuat pembayaran');
  }

  return {
    payment_url: data.data?.pay_url        || null,
    va_number:   data.data?.nomor_va       || null,
    qr_code:     data.data?.qr_string      || data.data?.qr_link || null,
    checkout_url:data.data?.checkout_url   || null,
    expired_at:  data.data?.expired        || null,
    trx_id:      data.data?.trx_id         || null,
    total_bayar: data.data?.total_bayar    || amount,
    raw:         data.data,
  };
}

/**
 * Verifikasi callback Tokopay
 */
function verifyCallback(payload, secretKey) {
  // Tokopay callback verification
  const SK = secretKey || process.env.TOKOPAY_SECRET_KEY;
  // Tokopay bisa kirim order ID di reff_id, ref_id, atau order_id
  const { merchant_id, sign: incoming } = payload;
  const refId = payload.reff_id || payload.ref_id || payload.order_id;
  const expected = crypto.createHash('md5').update(`${merchant_id}:${SK}:${refId}`).digest('hex');
  return incoming === expected;
}

module.exports = { createPayment, verifyCallback };
