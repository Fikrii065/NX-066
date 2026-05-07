'use strict';
const axios = require('axios');
const db    = require('./db');

async function getToken() {
  const [[row]] = await db.query("SELECT value FROM settings WHERE key_name='fonnte_token'");
  return row?.value || process.env.FONNTE_TOKEN || '';
}

async function send(phone, message) {
  const token = await getToken();
  if (!token) { console.warn('[Fonnte] Token belum dikonfigurasi'); return; }
  let no = String(phone).replace(/\D/g,'');
  if (no.startsWith('0')) no = '62' + no.slice(1);
  try {
    const { data } = await axios.post('https://api.fonnte.com/send', {
      target: no, message, countryCode: '62'
    }, { headers: { Authorization: token }, timeout: 10000 });
    console.log('[Fonnte] Sent to', no, ':', data);
    return data;
  } catch(e) {
    console.error('[Fonnte] Error:', e.response?.data || e.message);
  }
}

// Hanya kirim ke pembeli
async function notifyBuyer(phone, message) {
  if (!phone) return;
  const [[row]] = await db.query("SELECT value FROM settings WHERE key_name='wa_notif_buyer'");
  if (row?.value !== '1') return;
  return send(phone, message);
}

function orderPaidBuyer(order) {
  return `*Halo! Pembayaran kamu sudah kami terima* ✅\n\n` +
    `Order ID: *${order.order_id}*\n` +
    `Game: ${order.game_name}\n` +
    `Item: ${order.package_name}\n` +
    `ID: ${order.customer_no}${order.zone_id?' / '+order.zone_id:''}\n` +
    `Total: Rp ${Number(order.total).toLocaleString('id-ID')}\n\n` +
    `🔄 Top up sedang diproses, harap tunggu ya!\n` +
    `Cek status: ${process.env.SITE_URL||''}/cek-order?id=${order.order_id}`;
}

function orderSuccessBuyer(order) {
  return `*Top Up Berhasil!* 🎉\n\n` +
    `Order ID: *${order.order_id}*\n` +
    `Game: ${order.game_name}\n` +
    `Item: ${order.package_name}\n` +
    `ID: ${order.customer_no}${order.zone_id?' / '+order.zone_id:''}\n\n` +
    `✅ Diamond/item sudah masuk ke akun kamu!\n` +
    `SN: ${order.sn||'-'}\n\n` +
    `Terima kasih sudah berbelanja! 🙏`;
}

function orderFailedBuyer(order) {
  return `*Top Up Gagal* ❌\n\n` +
    `Order ID: *${order.order_id}*\n` +
    `Game: ${order.game_name} — ${order.package_name}\n\n` +
    `Mohon maaf, top up kamu gagal diproses.\n` +
    `Tim kami akan segera menghubungi kamu untuk proses refund.\n\n` +
    `Hubungi CS: ${process.env.ADMIN_WA||''}`;
}

module.exports = { send, notifyBuyer, orderPaidBuyer, orderSuccessBuyer, orderFailedBuyer };
