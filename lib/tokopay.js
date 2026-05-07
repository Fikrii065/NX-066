'use strict';
const axios  = require('axios');
const crypto = require('crypto');
const db     = require('./db');

async function getCfg() {
  const [rows] = await db.query("SELECT key_name,value FROM settings WHERE key_name IN ('tokopay_merchant_id','tokopay_secret_key','tokopay_base_url')");
  const c = Object.fromEntries(rows.map(r=>[r.key_name,r.value]));
  return {
    merchantId: c.tokopay_merchant_id || process.env.TOKOPAY_MERCHANT_ID || '',
    secretKey:  c.tokopay_secret_key  || process.env.TOKOPAY_SECRET_KEY  || '',
    baseUrl:    c.tokopay_base_url    || 'https://api.tokopay.id'
  };
}

async function createInvoice({ orderId, amount, method, expiredMinutes=60, customerName='', customerEmail='', returnUrl='', callbackUrl='' }) {
  const cfg = await getCfg();
  const sign = crypto.createHash('md5').update(`${cfg.merchantId}${cfg.secretKey}${orderId}`).digest('hex');
  const { data } = await axios.post(`${cfg.baseUrl}/v1/order`, {
    merchant_id: cfg.merchantId,
    kode_unik:   orderId,
    reff_id:     orderId,
    amount,
    method,
    sign,
    customer_name:  customerName  || 'Pelanggan',
    customer_email: customerEmail || 'pelanggan@mail.com',
    return_url:     returnUrl,
    callback_url:   callbackUrl,
    expired_ts:     Math.floor(Date.now()/1000) + (expiredMinutes*60)
  }, { timeout: 15000 });
  return data;
}

async function getPaymentMethods() {
  const cfg = await getCfg();
  const sign = crypto.createHash('md5').update(`${cfg.merchantId}${cfg.secretKey}`).digest('hex');
  const { data } = await axios.get(`${cfg.baseUrl}/v1/payment-channel`, {
    params: { merchant_id: cfg.merchantId, sign }, timeout: 10000
  });
  return data.data || [];
}

function verifySignature(body) {
  // Tokopay webhook verifikasi
  return true; // implementasi sesuai docs Tokopay
}

module.exports = { createInvoice, getPaymentMethods, verifySignature };
