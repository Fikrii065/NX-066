'use strict';
const axios  = require('axios');
const crypto = require('crypto');
const db     = require('./db');

async function getCfg() {
  const [rows] = await db.query("SELECT key_name,value FROM settings WHERE key_name IN ('digiflazz_username','digiflazz_api_key','digiflazz_mode')");
  const c = Object.fromEntries(rows.map(r=>[r.key_name,r.value]));
  return {
    username: c.digiflazz_username || process.env.DIGIFLAZZ_USERNAME || '',
    apiKey:   c.digiflazz_api_key  || process.env.DIGIFLAZZ_API_KEY  || '',
    mode:     c.digiflazz_mode     || 'development'
  };
}

// Ambil daftar produk dari Digiflazz
async function getPricelist(type='all') {
  const cfg = await getCfg();
  const sign = crypto.createHash('md5').update(cfg.username + cfg.apiKey + 'pricelist').digest('hex');
  const { data } = await axios.post('https://api.digiflazz.com/v1/price-list', {
    cmd: type, username: cfg.username, sign
  }, { timeout: 30000 });
  return data.data || [];
}

// Proses transaksi top up
async function topup(orderId, sku, customerNo) {
  const cfg = await getCfg();
  const sign = crypto.createHash('md5').update(cfg.username + cfg.apiKey + orderId).digest('hex');
  const { data } = await axios.post('https://api.digiflazz.com/v1/transaction', {
    username: cfg.username,
    buyer_sku_code: sku,
    customer_no: customerNo,
    ref_id: orderId,
    sign,
    testing: cfg.mode === 'development'
  }, { timeout: 30000 });
  return data.data || {};
}

// Cek status transaksi
async function checkStatus(orderId) {
  const cfg = await getCfg();
  const sign = crypto.createHash('md5').update(cfg.username + cfg.apiKey + orderId).digest('hex');
  const { data } = await axios.post('https://api.digiflazz.com/v1/transaction', {
    username: cfg.username, ref_id: orderId, sign, cmd: 'check-status'
  }, { timeout: 15000 });
  return data.data || {};
}

// Cek saldo Digiflazz
async function getSaldo() {
  const cfg = await getCfg();
  const sign = crypto.createHash('md5').update(cfg.username + cfg.apiKey + 'depo').digest('hex');
  const { data } = await axios.post('https://api.digiflazz.com/v1/cek-saldo', {
    cmd: 'deposit', username: cfg.username, sign
  }, { timeout: 10000 });
  return data.data?.deposit || 0;
}

module.exports = { getPricelist, topup, checkStatus, getSaldo };
