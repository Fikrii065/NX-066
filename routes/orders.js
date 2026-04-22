'use strict';
const router  = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db      = require('../lib/db');
const auth    = require('../middleware/auth');
const jwt     = require('jsonwebtoken');
const axios   = require('axios');
const crypto  = require('crypto');

function genOrderId() {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return 'GF' + Array.from({length: 8}, () => c[Math.floor(Math.random()*c.length)]).join('');
}

function calcSell(base, pct, min) {
  return base + Math.max(Math.round(base * pct / 100), min);
}

async function getSettings(conn) {
  const [rows] = await conn.query('SELECT key_name,value FROM settings');
  return Object.fromEntries(rows.map(r => [r.key_name, r.value]));
}

// POST /api/orders/create
router.post('/create', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const { game_id, sku_code, customer_no, customer_name, customer_email, customer_wa, payment_method, discount_code } = req.body;
    if (!game_id || !sku_code || !customer_no || !payment_method)
      return res.status(400).json({ success: false, message: 'Data tidak lengkap' });

    const s = await getSettings(conn);
    if (s.feature_maintenance === '1')
      return res.status(503).json({ success: false, message: 'Toko sedang maintenance' });

    const [[pkg]] = await conn.query(
      `SELECT p.*, g.name AS game_name, g.code AS game_code FROM packages p
       LEFT JOIN games g ON p.game_id=g.id
       WHERE g.id=? AND p.sku=? AND p.is_active=1 AND g.is_active=1 LIMIT 1`,
      [game_id, sku_code]
    );
    if (!pkg) return res.status(404).json({ success: false, message: 'Paket tidak tersedia' });

    // Check reseller
    let isReseller = false;
    try {
      const tok = (req.headers.authorization || '').replace('Bearer ', '');
      if (tok) {
        const pl = jwt.verify(tok, process.env.JWT_SECRET);
        if (pl.type === 'user' && pl.role === 'reseller') isReseller = true;
      }
    } catch (_) {}

    const pct  = isReseller ? 0 : (parseFloat(s.markup_percent) || 5);
    const min  = isReseller ? 0 : (parseInt(s.markup_minimum)   || 500);
    const fee  = payment_method === 'balance' ? 0 : (parseInt(s[`fee_${payment_method}`]) || 0);
    const sell = calcSell(pkg.base_price, pct, min);
    let   total = sell + fee;
    const orderId = genOrderId();

    // Apply discount
    let discountAmount = 0, voucherId = null;
    if (discount_code) {
      try {
        const [[dv]] = await conn.query(
          'SELECT * FROM discount_vouchers WHERE code=? AND is_active=1 LIMIT 1',
          [discount_code.trim().toUpperCase()]
        );
        if (dv) {
          const now = new Date();
          const valid = (!dv.valid_from || new Date(dv.valid_from) <= now)
                     && (!dv.valid_until || new Date(dv.valid_until) >= now)
                     && (dv.quota == null || dv.used_count < dv.quota)
                     && (dv.min_purchase <= 0 || sell >= parseFloat(dv.min_purchase));
          if (valid) {
            if (dv.discount_type === 'percent') {
              discountAmount = sell * parseFloat(dv.discount_value) / 100;
              if (dv.max_discount) discountAmount = Math.min(discountAmount, parseFloat(dv.max_discount));
            } else {
              discountAmount = parseFloat(dv.discount_value);
            }
            discountAmount = Math.round(Math.min(discountAmount, sell));
            total = Math.max(0, total - discountAmount);
            voucherId = dv.id;
          }
        }
      } catch (_) {}
    }

    // ── Balance payment ───────────────────────────────────────────────────────
    if (payment_method === 'balance') {
      const tok = (req.headers.authorization || '').replace('Bearer ', '');
      if (!tok) { await conn.rollback(); return res.status(401).json({ success: false, message: 'Login diperlukan' }); }
      let userId;
      try { userId = jwt.verify(tok, process.env.JWT_SECRET).id; } catch (_) {
        await conn.rollback(); return res.status(401).json({ success: false, message: 'Token tidak valid' });
      }
      const [[user]] = await conn.query('SELECT id,balance FROM users WHERE id=? FOR UPDATE', [userId]);
      if (!user || parseFloat(user.balance) < total) {
        await conn.rollback();
        return res.status(400).json({ success: false, message: 'Saldo tidak cukup' });
      }
      await conn.query('UPDATE users SET balance=balance-? WHERE id=?', [total, userId]);
      await conn.query(
        `INSERT INTO orders (order_id,game_id,package_id,customer_no,customer_name,customer_email,customer_wa,
          base_price,sell_price,service_fee,discount_code,discount_amount,total_amount,
          payment_method,payment_status,topup_status,paid_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'balance','paid','pending',NOW())`,
        [orderId, game_id, pkg.id, customer_no, customer_name||null, customer_email||null,
         customer_wa||null, pkg.base_price, sell, fee,
         discount_code||null, discountAmount, total]
      );
      if (voucherId) await conn.query('UPDATE discount_vouchers SET used_count=used_count+1 WHERE id=?', [voucherId]);
      await conn.commit();

      // Auto topup
      processDigiflazz(orderId, pkg.digiflazz_sku || pkg.sku, customer_no).catch(e => console.error('[Digiflazz]', e.message));

      return res.json({ success: true, order_id: orderId, total_amount: total, payment_method: 'balance', payment_status: 'paid' });
    }

    // ── Tokopay payment ───────────────────────────────────────────────────────
    if (s[`pay_enabled_${payment_method}`] === '0')
      return res.status(400).json({ success: false, message: 'Metode pembayaran tidak aktif' });

    await conn.query(
      `INSERT INTO orders (order_id,game_id,package_id,customer_no,customer_name,customer_email,customer_wa,
        base_price,sell_price,service_fee,discount_code,discount_amount,total_amount,
        payment_method,payment_status,topup_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'unpaid','pending')`,
      [orderId, game_id, pkg.id, customer_no, customer_name||null, customer_email||null,
       customer_wa||null, pkg.base_price, sell, fee,
       discount_code||null, discountAmount, total]
    );
    if (voucherId) await conn.query('UPDATE discount_vouchers SET used_count=used_count+1 WHERE id=?', [voucherId]);

    let payUrl = null, vaNum = null;
    try {
      const merchantId = s.tokopay_merchant_id || process.env.TOKOPAY_MERCHANT_ID;
      const secretKey  = s.tokopay_secret_key  || process.env.TOKOPAY_SECRET_KEY;
      const payChannel = s[`pay_channel_${payment_method}`] || payment_method;
      const sign = crypto.createHash('md5').update(`${merchantId}${secretKey}${orderId}`).digest('hex');
      const { data } = await axios.post('https://api.tokopay.id/v1/order', {
        ref_id: orderId, nominal: total, metode: payChannel,
        merchant_id: merchantId, signature: sign,
        keterangan: `Top Up ${pkg.game_name} - ${pkg.name}`,
      }, { timeout: 15000 });
      if (data.status === 'Success' || data.status === 'success') {
        payUrl = data.data?.payment_url || data.data?.qr_link || null;
        vaNum  = data.data?.nomor_va || null;
        const expired = new Date(Date.now() + 60 * 60 * 1000);
        await conn.query('UPDATE orders SET payment_url=?,va_number=?,expired_at=? WHERE order_id=?',
          [payUrl, vaNum, expired, orderId]);
      }
    } catch (e) { console.error('[Tokopay]', e.message); }

    await conn.commit();
    res.json({ success: true, order_id: orderId, total_amount: total, payment_method, payment_status: 'unpaid', payment_url: payUrl, va_number: vaNum });
  } catch (e) {
    await conn.rollback().catch(() => {});
    console.error('[order/create]', e.message);
    res.status(500).json({ success: false, message: e.message });
  } finally {
    conn.release();
  }
});

// GET /api/orders/:order_id
router.get('/:order_id', async (req, res) => {
  try {
    const [[o]] = await db.query(
      `SELECT o.*, g.name AS game_name, g.icon AS game_icon, p.name AS package_name
       FROM orders o
       LEFT JOIN games g ON o.game_id=g.id
       LEFT JOIN packages p ON o.package_id=p.id
       WHERE o.order_id=? LIMIT 1`,
      [req.params.order_id]
    );
    if (!o) return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
    res.json({ success: true, order: o });
  } catch (e) { res.status(500).json({ success: false }); }
});

// Admin list
router.get('/', auth, async (req, res) => {
  try {
    const { search='', status='', page=1, limit=20 } = req.query;
    const offset = (parseInt(page)-1) * parseInt(limit);
    let where = 'WHERE 1=1';
    const params = [];
    if (search) { where += ' AND (o.order_id LIKE ? OR o.customer_no LIKE ?)'; params.push(`%${search}%`,`%${search}%`); }
    if (status) { where += ' AND o.topup_status=?'; params.push(status); }
    const [[{total}]] = await db.query(`SELECT COUNT(*) AS total FROM orders o ${where}`, params);
    const [rows] = await db.query(
      `SELECT o.*, g.name AS game_name, p.name AS package_name
       FROM orders o LEFT JOIN games g ON o.game_id=g.id LEFT JOIN packages p ON o.package_id=p.id
       ${where} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );
    res.json({ success: true, orders: rows, total, page: parseInt(page), pages: Math.ceil(total/parseInt(limit)) });
  } catch (e) { res.status(500).json({ success: false }); }
});

// Auto-process Digiflazz
async function processDigiflazz(orderId, sku, customerNo) {
  try {
    const [cfgRows] = await db.query(
      "SELECT key_name,value FROM settings WHERE key_name IN ('digiflazz_username','digiflazz_key_dev','digiflazz_key_prod','digiflazz_mode')"
    );
    const cfg = Object.fromEntries(cfgRows.map(r => [r.key_name, r.value]));
    const username = cfg.digiflazz_username || process.env.DIGIFLAZZ_USERNAME;
    const mode     = cfg.digiflazz_mode || 'development';
    const apiKey   = mode === 'production'
      ? (cfg.digiflazz_key_prod || process.env.DIGIFLAZZ_API_KEY_PROD)
      : (cfg.digiflazz_key_dev  || process.env.DIGIFLAZZ_API_KEY_DEV);
    if (!username || !apiKey) return;
    const sign = crypto.createHash('md5').update(username + apiKey + orderId).digest('hex');
    const { data } = await axios.post('https://api.digiflazz.com/v1/transaction', {
      username, buyer_sku_code: sku, customer_no: customerNo, ref_id: orderId, sign,
    }, { timeout: 30000 });
    const d = data.data || {};
    const status = d.status === 'Sukses' ? 'success' : d.status === 'Gagal' ? 'failed' : 'processing';
    await db.query('UPDATE orders SET topup_status=?,sn=?,digiflazz_ref=?,completed_at=? WHERE order_id=?',
      [status, d.sn||null, d.trx_id||null, status==='success'?new Date():null, orderId]);
  } catch (e) { console.error('[Digiflazz process]', e.message); }
}

module.exports = router;
