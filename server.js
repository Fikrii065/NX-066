/**
 * ═══════════════════════════════════════════════════════════════════
 * GAMEFLASH - Backend API Integration
 * Integrasi Digiflazz (supplier) + Tokopay (payment gateway)
 * 
 * Stack: Node.js + Express
 * Install: npm install express axios crypto dotenv
 * ═══════════════════════════════════════════════════════════════════
 */

const express = require('express');
const axios   = require('axios');
const crypto  = require('crypto');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── ENV VARIABLES (.env) ────────────────────────────────────────────────────
// DIGIFLAZZ_USERNAME=your_username
// DIGIFLAZZ_API_KEY_PROD=your_prod_api_key
// DIGIFLAZZ_API_KEY_DEV=your_dev_api_key
// DIGIFLAZZ_MODE=production     # production | development
//
// TOKOPAY_MERCHANT_ID=MCH_GAMEFLASH_001
// TOKOPAY_SECRET_KEY=sk_live_xxxx
// TOKOPAY_MODE=production        # production | sandbox
//
// MARKUP_PERCENT=5
// MARKUP_MINIMUM=500

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const DIGIFLAZZ = {
  username : process.env.DIGIFLAZZ_USERNAME || 'fininogd62AD',
  apiKey   : process.env.DIGIFLAZZ_MODE === 'production'
               ? (process.env.DIGIFLAZZ_API_KEY_PROD || 'b84ece82-3db7-5e04-936d-047360623b91')
               : (process.env.DIGIFLAZZ_API_KEY_DEV  || 'b84ece82-3db7-5e04-936d-047360623b91'),
  baseUrl  : 'https://api.digiflazz.com/v1',
};

const TOKOPAY = {
  merchantId : process.env.TOKOPAY_MERCHANT_ID,
  secretKey  : process.env.TOKOPAY_SECRET_KEY,
  baseUrl    : process.env.TOKOPAY_MODE === 'production'
                 ? 'https://payment.tokopay.id'
                 : 'https://sandbox.tokopay.id',
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function digiflazzSign(username, apiKey, refId) {
  // MD5 of: username + api_key + ref_id
  return crypto.createHash('md5').update(username + apiKey + refId).digest('hex');
}

function tokopaySign(merchantId, secretKey, orderId, amount) {
  // HMAC-SHA256 of: merchant_id + order_id + amount
  const str = `${merchantId}${orderId}${amount}`;
  return crypto.createHmac('sha256', secretKey).update(str).digest('hex');
}

function generateOrderId() {
  return 'GF' + Date.now().toString(36).toUpperCase();
}

function applyMarkup(basePrice) {
  const pct = parseFloat(process.env.MARKUP_PERCENT || 5) / 100;
  const min = parseInt(process.env.MARKUP_MINIMUM || 500);
  const markup = Math.max(Math.round(basePrice * pct), min);
  return basePrice + markup;
}

// ─── DIGIFLAZZ API ───────────────────────────────────────────────────────────

/**
 * GET /api/digiflazz/pricelist
 * Ambil daftar harga produk dari Digiflazz
 */
app.get('/api/digiflazz/pricelist', async (req, res) => {
  try {
    const sign = crypto.createHash('md5')
      .update(DIGIFLAZZ.username + DIGIFLAZZ.apiKey + 'pricelist')
      .digest('hex');

    const { data } = await axios.post(`${DIGIFLAZZ.baseUrl}/price-list`, {
      cmd      : 'prepaid',   // prepaid | pasca
      username : DIGIFLAZZ.username,
      sign,
    });

    // Apply markup to each product
    const products = (data.data || []).map(p => ({
      ...p,
      original_price : p.price,
      sell_price     : applyMarkup(p.price),
      markup         : applyMarkup(p.price) - p.price,
    }));

    res.json({ success: true, data: products });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/digiflazz/balance
 * Cek saldo Digiflazz
 */
app.get('/api/digiflazz/balance', async (req, res) => {
  try {
    const sign = crypto.createHash('md5')
      .update(DIGIFLAZZ.username + DIGIFLAZZ.apiKey + 'depo')
      .digest('hex');

    const { data } = await axios.post(`${DIGIFLAZZ.baseUrl}/cek-saldo`, {
      cmd      : 'deposit',
      username : DIGIFLAZZ.username,
      sign,
    });

    res.json({ success: true, balance: data.data.deposit });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/digiflazz/topup
 * Proses top up ke Digiflazz (dipanggil setelah pembayaran sukses)
 * Body: { ref_id, buyer_sku_code, customer_no }
 */
app.post('/api/digiflazz/topup', async (req, res) => {
  const { ref_id, buyer_sku_code, customer_no } = req.body;

  if (!ref_id || !buyer_sku_code || !customer_no) {
    return res.status(400).json({ success: false, message: 'ref_id, buyer_sku_code, customer_no diperlukan' });
  }

  try {
    const sign = digiflazzSign(DIGIFLAZZ.username, DIGIFLAZZ.apiKey, ref_id);

    const { data } = await axios.post(`${DIGIFLAZZ.baseUrl}/transaction`, {
      username       : DIGIFLAZZ.username,
      buyer_sku_code,
      customer_no,
      ref_id,
      sign,
      testing        : process.env.DIGIFLAZZ_MODE !== 'production',
    });

    const trx = data.data;
    console.log('[Digiflazz Topup]', trx);

    // Update DB: set transaction status based on trx.status
    // trx.status: 'Sukses' | 'Pending' | 'Gagal'

    res.json({
      success : trx.status === 'Sukses',
      status  : trx.status,
      sn      : trx.sn || null,      // serial number jika ada
      message : trx.message,
      data    : trx,
    });
  } catch (err) {
    console.error('[Digiflazz Error]', err.response?.data || err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/digiflazz/callback
 * Webhook callback dari Digiflazz (status update transaksi)
 */
app.post('/api/digiflazz/callback', async (req, res) => {
  const payload = req.body;
  console.log('[Digiflazz Webhook]', payload);

  // Verifikasi webhook secret (opsional tapi direkomendasikan)
  const secret = process.env.DIGIFLAZZ_WEBHOOK_SECRET;
  if (secret) {
    const sign = crypto.createHash('md5').update(secret).digest('hex');
    if (req.headers['x-hub-signature'] !== sign) {
      return res.status(401).json({ message: 'Invalid signature' });
    }
  }

  const { ref_id, status, sn, message } = payload.data || {};

  if (status === 'Sukses') {
    // TODO: Update order di database: SET status='success', sn=sn WHERE ref_id=ref_id
    console.log(`[Topup Sukses] ref_id=${ref_id}, sn=${sn}`);
    // Kirim notifikasi ke user (WhatsApp/Email)
  } else if (status === 'Gagal') {
    // TODO: Update order status='failed', proses refund jika perlu
    console.log(`[Topup Gagal] ref_id=${ref_id}, msg=${message}`);
  }

  res.json({ success: true });
});

// ─── TOKOPAY API ─────────────────────────────────────────────────────────────

/**
 * POST /api/tokopay/create-payment
 * Buat invoice pembayaran via Tokopay
 * Body: { order_id, amount, payment_method, customer_name, customer_email, items }
 */
app.post('/api/tokopay/create-payment', async (req, res) => {
  const { order_id, amount, payment_method, customer_name, customer_email, items } = req.body;

  const sign = tokopaySign(TOKOPAY.merchantId, TOKOPAY.secretKey, order_id, amount);

  const payload = {
    merchant_id    : TOKOPAY.merchantId,
    order_id,
    amount,
    payment_type   : payment_method,   // bca_va | bni_va | bri_va | mandiri_va | dana | ovo | gopay | shopeepay | qris
    customer_name  : customer_name || 'Customer',
    customer_email : customer_email || 'customer@gameflash.id',
    callback_url   : `${process.env.BASE_URL}/api/tokopay/callback`,
    return_url     : `${process.env.BASE_URL}/payment/success?order_id=${order_id}`,
    expired_time   : 15,               // menit
    sign,
    items          : items || [{ name: 'Top Up Game', price: amount, qty: 1 }],
  };

  try {
    const { data } = await axios.post(`${TOKOPAY.baseUrl}/api/v1/invoice/create`, payload, {
      headers: {
        'Content-Type' : 'application/json',
        'Authorization': `Bearer ${TOKOPAY.secretKey}`,
      },
    });

    if (!data.success) {
      return res.status(400).json({ success: false, message: data.message });
    }

    // Simpan ke DB: orders(order_id, amount, payment_method, payment_url, va_number, status='pending')
    const result = {
      success      : true,
      order_id,
      payment_url  : data.data.payment_url,
      va_number    : data.data.virtual_account || data.data.qr_code || null,
      expired_at   : data.data.expired_at,
      total        : amount,
    };

    console.log('[Tokopay Invoice Created]', result);
    res.json(result);
  } catch (err) {
    console.error('[Tokopay Error]', err.response?.data || err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/tokopay/callback
 * Webhook dari Tokopay saat pembayaran berhasil
 */
app.post('/api/tokopay/callback', async (req, res) => {
  const { order_id, amount, status, payment_type, sign: incomingSign } = req.body;

  console.log('[Tokopay Webhook]', req.body);

  // Verifikasi tanda tangan
  const expectedSign = tokopaySign(TOKOPAY.merchantId, TOKOPAY.secretKey, order_id, amount);
  if (incomingSign !== expectedSign) {
    console.error('[Tokopay] Invalid signature!');
    return res.status(401).json({ success: false, message: 'Invalid signature' });
  }

  if (status === 'PAID' || status === 'SUCCESS') {
    // TODO: Ambil data order dari DB berdasarkan order_id
    // Contoh: const order = await db.orders.findOne({ order_id });

    // Proses top up ke Digiflazz
    const refId = order_id; // gunakan order_id sebagai ref_id Digiflazz

    try {
      const topupRes = await axios.post(`${process.env.BASE_URL}/api/digiflazz/topup`, {
        ref_id         : refId,
        buyer_sku_code : 'MLBBDIAMOND-344', // TODO: ambil dari order data
        customer_no    : '123456789|1234',  // TODO: ambil dari order data
      });

      console.log('[Topup triggered after payment]', topupRes.data);
    } catch (topupErr) {
      console.error('[Topup Error after payment]', topupErr.message);
      // Simpan ke antrian retry / manual processing
    }

    // Update order status di DB
    // await db.orders.update({ status: 'processing' }, { where: { order_id } });
  }

  res.json({ success: true, message: 'OK' });
});

/**
 * GET /api/tokopay/check-payment/:order_id
 * Cek status pembayaran
 */
app.get('/api/tokopay/check-payment/:order_id', async (req, res) => {
  const { order_id } = req.params;
  const sign = tokopaySign(TOKOPAY.merchantId, TOKOPAY.secretKey, order_id, '');

  try {
    const { data } = await axios.get(`${TOKOPAY.baseUrl}/api/v1/invoice/${order_id}`, {
      headers: {
        'Authorization': `Bearer ${TOKOPAY.secretKey}`,
        'X-Merchant-Id': TOKOPAY.merchantId,
        'X-Sign'       : sign,
      },
    });

    res.json({ success: true, data: data.data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── VIP RESELLER CONFIG ─────────────────────────────────────────────────────
// VIPRESELLER_API_KEY=your_api_key  ← tambahkan di .env
const VIPRESELLER = {
  key     : process.env.VIPRESELLER_API_KEY || 'ISI_API_KEY_VIPRESELLER',
  baseUrl : 'https://vip-reseller.co.id/api',
};

/**
 * Konfigurasi per game untuk cek nickname via VIP Reseller
 *
 * code        : kode game di API VIP Reseller
 * params      : field yang dikirim ke API ('userId' dan/atau 'zoneId')
 * zoneRequired: true  → zoneId wajib diisi user
 *               false → zoneId opsional / tidak dipakai
 * zoneField   : nama field yang dikirim ke API untuk zone ('zoneId' | 'zone')
 *
 * Catatan khusus ML:
 *   - Cek nickname hanya butuh userId (zone tidak perlu dikirim)
 *   - ML-Region butuh zoneId wajib
 */
const GAME_NICKNAME_CONFIG = {
  //  game key                  code                       params                 zoneRequired  zoneField
  'mobile-legends'        : { code: 'mobile-legends',        params: ['userId'],             zoneRequired: false, zoneField: 'zoneId' },
  'mobile-legends-region' : { code: 'mobile-legends-region', params: ['userId', 'zoneId'],   zoneRequired: true,  zoneField: 'zoneId' },
  'free-fire'             : { code: 'free-fire',             params: ['userId'],             zoneRequired: false, zoneField: null     },
  'free-fire-max'         : { code: 'free-fire',             params: ['userId'],             zoneRequired: false, zoneField: null     },
  'pubgm'                 : { code: 'pubgm',                 params: ['userId'],             zoneRequired: false, zoneField: null     },
  'valorant'              : { code: 'valorant',              params: ['userId'],             zoneRequired: false, zoneField: null     },
  'genshin-impact'        : { code: 'genshin-impact',        params: ['userId', 'zone'],     zoneRequired: true,  zoneField: 'zone'   },
  'honkai-star-rail'      : { code: 'honkai-star-rail',      params: ['userId', 'zone'],     zoneRequired: true,  zoneField: 'zone'   },
  'pointblank'            : { code: 'pointblank',            params: ['userId'],             zoneRequired: false, zoneField: null     },
};

/**
 * POST /api/check-nickname
 * GET  /api/check-nickname?game=mobile-legends&userId=12345&zoneId=1234
 *
 * Validasi nickname akun game via VIP Reseller
 * Mendukung request lewat query string (GET) maupun body JSON (POST)
 *
 * Params:
 *   game   : kode game (lihat GAME_NICKNAME_CONFIG di atas)
 *   userId : ID user/akun game
 *   zoneId : Server/zone ID (wajib untuk ML-Region, Genshin, HSR)
 *
 * Response sukses:
 *   { success: true, nickname: "PlayerName", game, userId, zoneId }
 *
 * Response gagal:
 *   { success: false, message: "..." }
 */
async function handleCheckNickname(req, res) {
  // Support GET (query) dan POST (body)
  const { game, userId, zoneId } = { ...req.query, ...req.body };

  // ── 1. Validasi input ──────────────────────────────────────────────────────
  if (!game || !userId) {
    return res.status(400).json({
      success : false,
      message : 'Parameter game dan userId wajib diisi',
    });
  }

  const config = GAME_NICKNAME_CONFIG[game.toLowerCase()];
  if (!config) {
    return res.status(400).json({
      success        : false,
      message        : `Game "${game}" tidak didukung untuk cek nickname`,
      supported_games: Object.keys(GAME_NICKNAME_CONFIG),
    });
  }

  if (config.zoneRequired && !zoneId) {
    return res.status(400).json({
      success : false,
      message : `Parameter zoneId wajib diisi untuk game ${game}`,
    });
  }

  // ── 2. Bangun payload VIP Reseller ─────────────────────────────────────────
  //  Endpoint : POST https://vip-reseller.co.id/api/game-feature
  //  Payload  : { key, type, code, data, zone? }
  const payload = {
    key  : VIPRESELLER.key,
    type : 'get-nickname',
    code : config.code,
    data : String(userId).trim(),
  };

  // Tambahkan zone hanya jika game membutuhkannya DAN zoneId tersedia
  if (config.zoneField && zoneId) {
    payload[config.zoneField] = String(zoneId).trim();
  }

  // ── 3. Kirim request ke VIP Reseller ──────────────────────────────────────
  console.log('[CheckNickname] →', { game, userId, zoneId: zoneId || '-', payload });

  try {
    const { data: apiRes } = await axios.post(
      `${VIPRESELLER.baseUrl}/game-feature`,
      payload,
      {
        headers : { 'Content-Type': 'application/json' },
        timeout : 12000,
      }
    );

    console.log('[CheckNickname] ←', apiRes);

    // ── 4. Parse response ────────────────────────────────────────────────────
    // VIP Reseller mengembalikan: { result: true/false, data: "nickname"|{nickname:...}, message: "..." }
    if (!apiRes.result) {
      return res.status(422).json({
        success : false,
        message : apiRes.message || 'Akun tidak ditemukan atau ID tidak valid',
      });
    }

    // Normalize nickname: bisa string langsung atau object { nickname: "..." }
    const nickname =
      (typeof apiRes.data === 'object' && apiRes.data !== null)
        ? (apiRes.data.nickname || apiRes.data.name || JSON.stringify(apiRes.data))
        : (String(apiRes.data || '').trim() || 'Akun Valid');

    return res.json({
      success  : true,
      nickname,
      game,
      userId   : String(userId).trim(),
      zoneId   : zoneId ? String(zoneId).trim() : null,
      message  : apiRes.message || 'Akun berhasil diverifikasi',
    });

  } catch (err) {
    // Bedakan timeout vs error lainnya
    const isTimeout = err.code === 'ECONNABORTED' || err.message?.includes('timeout');
    console.error('[CheckNickname Error]', err.response?.data || err.message);

    return res.status(isTimeout ? 504 : 500).json({
      success : false,
      message : isTimeout
        ? 'Server verifikasi timeout, coba lagi dalam beberapa saat'
        : `Gagal menghubungi server verifikasi: ${err.message}`,
    });
  }
}

// Daftarkan endpoint GET dan POST
app.get('/api/check-nickname', handleCheckNickname);
app.post('/api/check-nickname', handleCheckNickname);

// ─── ORDER API ────────────────────────────────────────────────────────────────

/**
 * POST /api/orders/create
 * Flow lengkap: validasi → buat invoice Tokopay
 * Body: { user_id, game_id, sku_code, customer_no, zone_id, payment_method }
 */
app.post('/api/orders/create', async (req, res) => {
  // Guest checkout: user_id & customer_email opsional, tidak butuh login/sesi
  const {
    user_id, game_id, sku_code, customer_no, zone_id,
    payment_method, customer_name, customer_email, customer_wa,
  } = req.body;

  if (!sku_code || !customer_no || !payment_method) {
    return res.status(400).json({ success: false, message: 'Data tidak lengkap: sku_code, customer_no, payment_method wajib diisi' });
  }

  try {
    // 1. Ambil harga produk dari pricelist (atau cache DB)
    // Contoh harga dari DB / cache
    const basePrice = 42000; // dari DB
    const sellPrice = applyMarkup(basePrice);

    // 2. Hitung biaya layanan berdasarkan metode bayar
    const serviceFees = { bca_va:0, bni_va:0, bri_va:0, mandiri_va:4000, dana:1000, ovo:1000, gopay:1500, shopeepay:1000, qris:1500 };
    const serviceFee = serviceFees[payment_method] || 0;
    const totalAmount = sellPrice + serviceFee;

    // 3. Generate order ID
    const orderId = generateOrderId();

    // 4. Simpan order ke DB (status: 'pending')
    // await db.orders.create({ order_id: orderId, user_id, game_id, sku_code, customer_no, zone_id, base_price: basePrice, sell_price: sellPrice, service_fee: serviceFee, total: totalAmount, payment_method, status: 'pending' });

    // 5. Buat invoice Tokopay (guest: email & WA opsional)
    const invoiceRes = await axios.post(`${process.env.BASE_URL}/api/tokopay/create-payment`, {
      order_id       : orderId,
      amount         : totalAmount,
      payment_method,
      customer_name  : customer_name || 'Guest',
      customer_email : customer_email || 'guest@gameflash.id',
      items          : [{ name: `Top Up ${game_id}`, price: sellPrice, qty: 1 }],
    });
    // TODO: Kirim notif ke customer_wa (WhatsApp) via Fonnte/WA API jika diisi

    if (!invoiceRes.data.success) {
      throw new Error('Gagal membuat invoice pembayaran');
    }

    res.json({
      success     : true,
      order_id    : orderId,
      total       : totalAmount,
      payment_url : invoiceRes.data.payment_url,
      va_number   : invoiceRes.data.va_number,
      expired_at  : invoiceRes.data.expired_at,
    });
  } catch (err) {
    console.error('[Order Create Error]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/orders/:order_id
 * Cek status order
 */
app.get('/api/orders/:order_id', async (req, res) => {
  const { order_id } = req.params;
  // TODO: ambil dari DB
  // const order = await db.orders.findOne({ order_id });
  const mockOrder = { order_id, status: 'success', game: 'Mobile Legends', item: '344 Diamonds', total: 48000 };
  res.json({ success: true, data: mockOrder });
});

// ─── ADMIN API ────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/dashboard
 * Data ringkasan untuk dashboard admin
 */
app.get('/api/admin/dashboard', async (req, res) => {
  // TODO: query dari DB
  res.json({
    success: true,
    data: {
      revenue_today      : 14800000,
      transactions_today : 347,
      total_users        : 2891,
      failed_today       : 3,
      digiflazz_balance  : 2450000,
    },
  });
});

/**
 * GET /api/admin/transactions
 * Daftar semua transaksi
 */
app.get('/api/admin/transactions', async (req, res) => {
  const { page = 1, limit = 20, status, game } = req.query;
  // TODO: query dari DB dengan filter & pagination
  res.json({ success: true, data: [], total: 0, page, limit });
});

// ─── START SERVER ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║  GameFlash API Server Running        ║
  ║  Port     : ${PORT}                     ║
  ║  Digiflazz: ${process.env.DIGIFLAZZ_MODE || 'development'}           ║
  ║  Tokopay  : ${process.env.TOKOPAY_MODE || 'sandbox'}             ║
  ╚══════════════════════════════════════╝
  `);
});

module.exports = app;
