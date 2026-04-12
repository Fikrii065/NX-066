const axios  = require('axios');
const crypto = require('crypto');

const BASE_URL = 'https://api.tokopay.id';

function sign(merchantId, secretKey, orderId) {
  return crypto.createHash('md5').update(`${merchantId}:${secretKey}:${orderId}`).digest('hex');
}

/**
 * Buat pembayaran baru
 * @param {object} opts
 * @param {string} opts.orderId
 * @param {number} opts.amount
 * @param {string} opts.method
 * @param {string} opts.description
 * @param {string} [opts.email]
 * @param {string} [opts.phone]
 * @param {string} [opts.merchantId]   - override env
 * @param {string} [opts.secretKey]    - override env
 */
async function createPayment({ orderId, amount, method, description, email, phone, merchantId, secretKey }) {
  const MERCHANT    = merchantId  || process.env.TOKOPAY_MERCHANT_ID;
  const SECRET_KEY  = secretKey   || process.env.TOKOPAY_SECRET_KEY;

  if (!MERCHANT || !SECRET_KEY) {
    throw new Error('Tokopay credentials belum dikonfigurasi');
  }

  const signature = sign(MERCHANT, SECRET_KEY, orderId);

  const payload = {
    merchant_id:  MERCHANT,
    order_id:     orderId,
    amount:       amount,
    sign:         signature,
    payment_type: method,
    notify_url:   `${process.env.BASE_URL}/api/webhook/tokopay`,
    return_url:   `${process.env.BASE_URL}/payment?order_id=${orderId}`,
    expired:      60,
    item_details: [{ item_id: orderId, price: amount, quantity: 1, item_name: description }],
    customer_details: { email: email || '', phone: phone || '' },
  };

  const { data } = await axios.post(`${BASE_URL}/order`, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
  });

  if (!data || data.rc !== '00') {
    throw new Error(data?.rd || 'Gagal membuat pembayaran');
  }

  return {
    payment_url:  data.data?.payment_url  || null,
    va_number:    data.data?.nomor_va     || null,
    qr_code:      data.data?.qr_string    || null,
    expired_at:   data.data?.expired      || null,
    raw:          data.data,
  };
}

/**
 * Verifikasi callback Tokopay
 */
function verifyCallback(payload, secretKey) {
  const { merchant_id, order_id, sign: incoming } = payload;
  const SK = secretKey || process.env.TOKOPAY_SECRET_KEY;
  const expected = sign(merchant_id, SK, order_id);
  return incoming === expected;
}

module.exports = { createPayment, verifyCallback };

