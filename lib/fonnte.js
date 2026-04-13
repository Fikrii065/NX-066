/**
 * lib/fonnte.js — Kirim notifikasi WhatsApp via Fonnte API
 * Docs: https://fonnte.com/docs
 */

const axios = require('axios');
const db    = require('./db');

// ── Ambil config Fonnte dari DB settings ──────────────────────────────────────
async function getFonnteConfig() {
  try {
    const [rows] = await db.query(
      "SELECT key_name, value FROM settings WHERE key_name IN ('fonte_token','fonte_device','feature_whatsapp_notif')"
    );
    const cfg = Object.fromEntries(rows.map(r => [r.key_name, r.value]));
    return {
      token:   cfg.fonte_token   || process.env.FONNTE_TOKEN   || '',
      device:  cfg.fonte_device  || process.env.FONNTE_DEVICE  || '',
      enabled: cfg.feature_whatsapp_notif === '1',
    };
  } catch (e) {
    return { token: '', device: '', enabled: false };
  }
}

// ── Kirim pesan WA ────────────────────────────────────────────────────────────
async function sendWA(phone, message) {
  const cfg = await getFonnteConfig();
  if (!cfg.enabled || !cfg.token) {
    console.log('[Fonnte] Notifikasi WA dinonaktifkan atau token belum diset.');
    return { success: false, reason: 'disabled' };
  }

  // Format nomor: harus diawali 62 (tanpa +)
  let target = String(phone).replace(/\D/g, '');
  if (target.startsWith('0'))       target = '62' + target.slice(1);
  if (!target.startsWith('62'))     target = '62' + target;

  try {
    const payload = { target, message, countryCode: '62' };
    if (cfg.device) payload.device = cfg.device;

    const { data } = await axios.post('https://api.fonnte.com/send', payload, {
      headers: { Authorization: cfg.token },
      timeout: 10000,
    });

    console.log(`[Fonnte] Pesan terkirim ke ${target}:`, data);
    return { success: true, data };
  } catch (err) {
    console.error('[Fonnte] Gagal kirim WA:', err.response?.data || err.message);
    return { success: false, error: err.response?.data || err.message };
  }
}

// ── Format Rupiah ─────────────────────────────────────────────────────────────
function fmt(n) {
  return 'Rp ' + Number(n).toLocaleString('id-ID');
}

// ── Format tanggal ────────────────────────────────────────────────────────────
function fmtDate(d) {
  return new Date(d || Date.now()).toLocaleString('id-ID', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta'
  }) + ' WIB';
}

// ════════════════════════════════════════════════════════════════════════════════
//  TEMPLATE NOTIFIKASI
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Notifikasi: Top Up SUKSES
 * Dikirim setelah Digiflazz konfirmasi transaksi berhasil
 */
async function notifyTopupSuccess(order) {
  if (!order.customer_wa) return;

  const sn = order.sn ? `\n✅ *Serial Number (SN):*\n\`${order.sn}\`` : '';

  const message =
`╔══════════════════════╗
   ✅ *TOP UP BERHASIL!*
╚══════════════════════╝

Halo ${order.customer_name || 'Kak'} 👋

Top up kamu telah *berhasil diproses*. Berikut detailnya:

🎮 *Game / Produk:*
${order.game_name || '-'}

📦 *Paket:*
${order.package_name || '-'}

🎯 *Akun / ID Tujuan:*
${order.customer_no || '-'}

💰 *Total Bayar:*
${fmt(order.total_amount)}

🧾 *ID Transaksi:*
\`${order.order_id}\`

⏱️ *Waktu:*
${fmtDate(order.completed_at || order.paid_at)}${sn}

_Item sudah masuk ke akun kamu. Cek sekarang!_ 🎉

Terima kasih telah berbelanja! 🙏
Butuh bantuan? Hubungi CS kami.`;

  return sendWA(order.customer_wa, message);
}

/**
 * Notifikasi: Top Up GAGAL
 * Dikirim jika Digiflazz gagal memproses transaksi
 */
async function notifyTopupFailed(order) {
  if (!order.customer_wa) return;

  const reason = order.notes
    ? `\n⚠️ *Alasan:*\n${order.notes}`
    : '';

  const message =
`╔══════════════════════╗
   ❌ *TOP UP GAGAL*
╚══════════════════════╝

Halo ${order.customer_name || 'Kak'} 👋

Mohon maaf, top up kamu *gagal diproses*. Berikut detailnya:

🎮 *Game / Produk:*
${order.game_name || '-'}

📦 *Paket:*
${order.package_name || '-'}

🎯 *Akun / ID Tujuan:*
${order.customer_no || '-'}

💰 *Total Bayar:*
${fmt(order.total_amount)}

🧾 *ID Transaksi:*
\`${order.order_id}\`${reason}

🔄 *Apa yang terjadi selanjutnya?*
Dana kamu akan dikembalikan (refund) dalam 1x24 jam kerja. Jika butuh proses lebih cepat, segera hubungi CS kami dengan menyertakan ID Transaksi di atas.

Mohon maaf atas ketidaknyamanannya 🙏`;

  return sendWA(order.customer_wa, message);
}

/**
 * Notifikasi: Pembayaran BERHASIL (setelah bayar, sebelum top up selesai)
 * Dikirim saat payment_status berubah jadi 'paid'
 */
async function notifyPaymentSuccess(order) {
  if (!order.customer_wa) return;

  const message =
`╔══════════════════════╗
   💳 *PEMBAYARAN DITERIMA*
╚══════════════════════╝

Halo ${order.customer_name || 'Kak'} 👋

Pembayaran kamu telah *berhasil dikonfirmasi*!

🎮 *Game / Produk:*
${order.game_name || '-'}

📦 *Paket:*
${order.package_name || '-'}

🎯 *Akun / ID Tujuan:*
${order.customer_no || '-'}

💰 *Total Bayar:*
${fmt(order.total_amount)}

💳 *Metode Bayar:*
${order.payment_method || '-'}

🧾 *ID Transaksi:*
\`${order.order_id}\`

⏳ *Status:*
Sedang diproses... Kamu akan dapat notifikasi lagi begitu top up selesai.

_Proses biasanya selesai dalam hitungan detik_ ⚡`;

  return sendWA(order.customer_wa, message);
}

/**
 * Notifikasi: Pembayaran EXPIRED / KADALUARSA
 * Dikirim saat payment_status berubah jadi 'expired'
 */
async function notifyPaymentExpired(order) {
  if (!order.customer_wa) return;

  const message =
`╔══════════════════════╗
   ⏰ *PEMBAYARAN KADALUARSA*
╚══════════════════════╝

Halo ${order.customer_name || 'Kak'} 👋

Sayang sekali, waktu pembayaran untuk pesanan kamu telah *habis*.

🎮 *Game / Produk:*
${order.game_name || '-'}

📦 *Paket:*
${order.package_name || '-'}

💰 *Total:*
${fmt(order.total_amount)}

🧾 *ID Transaksi:*
\`${order.order_id}\`

🔄 *Mau coba lagi?*
Buat pesanan baru di website kami. Stok masih tersedia!

_Jika kamu sudah membayar tapi menerima pesan ini, segera hubungi CS kami._ 🙏`;

  return sendWA(order.customer_wa, message);
}

// ════════════════════════════════════════════════════════════════════════════════

module.exports = {
  sendWA,
  notifyPaymentSuccess,
  notifyTopupSuccess,
  notifyTopupFailed,
  notifyPaymentExpired,
};
