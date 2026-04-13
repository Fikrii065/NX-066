const router     = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db         = require('../lib/db');
const tokopay    = require('../lib/tokopay');
const auth       = require('../middleware/auth');

function generateOrderId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = 'GF';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function calcSellPrice(base, pct, min) {
  return base + Math.max(Math.round(base * pct / 100), min);
}

// POST /api/orders/create
router.post('/create', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { game_id, sku_code, customer_no, payment_method, customer_name, customer_email, customer_wa } = req.body;

    if (!game_id || !sku_code || !customer_no || !payment_method) {
      return res.status(400).json({ success: false, message: 'Data order tidak lengkap' });
    }

    // Cek maintenance
    const [[maint]] = await conn.query("SELECT value FROM settings WHERE key_name = 'feature_maintenance'");
    if (maint?.value === '1') {
      return res.status(503).json({ success: false, message: 'Toko sedang dalam maintenance' });
    }

    // Ambil paket
    const [[pkg]] = await conn.query(
      `SELECT p.*, g.code AS game_code, g.name AS game_name
       FROM packages p JOIN games g ON p.game_id = g.id
       WHERE g.id = ? AND p.sku = ? AND p.is_active = 1 AND g.is_active = 1`,
      [game_id, sku_code]
    );
    if (!pkg) return res.status(404).json({ success: false, message: 'Paket tidak ditemukan atau tidak aktif' });

    // Ambil markup & fee + tokopay credentials
    const [settingsRows] = await conn.query(
      "SELECT key_name, value FROM settings WHERE key_name IN ('markup_percent','markup_minimum','tokopay_merchant_id','tokopay_secret_key') OR key_name LIKE 'fee_%' OR key_name LIKE 'pay_channel_%' OR key_name LIKE 'pay_enabled_%'"
    );
    const settings = Object.fromEntries(settingsRows.map(r => [r.key_name, r.value]));

    // Cek metode pembayaran aktif
    if (settings[`pay_enabled_${payment_method}`] === '0') {
      return res.status(400).json({ success: false, message: 'Metode pembayaran tidak tersedia' });
    }

    const pct      = parseFloat(settings.markup_percent) || 5;
    const min      = parseInt(settings.markup_minimum)   || 500;
    const feeKey   = `fee_${payment_method}`;
    const fee      = parseInt(settings[feeKey]) || 0;
    // Gunakan kode channel dari settings (bisa dikustomisasi di admin)
    const payChannel = settings[`pay_channel_${payment_method}`] || payment_method;

    const sellPrice  = calcSellPrice(pkg.base_price, pct, min);
    const total      = sellPrice + fee;
    const orderId    = generateOrderId();

    // Simpan order
    await conn.query(
      `INSERT INTO orders
        (order_id, game_id, package_id, customer_no, customer_name, customer_email, customer_wa,
         base_price, sell_price, service_fee, total_amount, payment_method, payment_status, topup_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'unpaid','pending')`,
      [orderId, game_id, pkg.id, customer_no, customer_name || null, customer_email || null,
       customer_wa || null, pkg.base_price, sellPrice, fee, total, payment_method]
    );

    // Buat pembayaran Tokopay
    let paymentResult;
    try {
      paymentResult = await tokopay.createPayment({
        orderId,
        amount:      total,
        method:      payChannel,
        description: `Top Up ${pkg.game_name} - ${pkg.name}`,
        email:       customer_email || '',
        merchantId:  settings.tokopay_merchant_id || process.env.TOKOPAY_MERCHANT_ID,
        secretKey:   settings.tokopay_secret_key  || process.env.TOKOPAY_SECRET_KEY,
        phone:       customer_wa    || '',
        returnUrl:   `${process.env.APP_URL || ''}/payment?order_id=${orderId}`,
      });
    } catch (payErr) {
      console.error('Tokopay error:', payErr.message);
      // Simpan payment log error
      await conn.query(
        'INSERT INTO payment_logs (order_id, event, provider, response) VALUES (?,?,?,?)',
        [orderId, 'create_error', 'tokopay', JSON.stringify({ error: payErr.message })]
      );
      return res.status(502).json({ success: false, message: 'Gagal membuat pembayaran: ' + payErr.message });
    }

    // Update order dengan payment info
    const finalPayUrl = paymentResult.payment_url || paymentResult.checkout_url || null;
    await conn.query(
      'UPDATE orders SET payment_url=?, va_number=?, qr_code=?, expired_at=? WHERE order_id=?',
      [finalPayUrl, paymentResult.va_number, paymentResult.qr_code || null, paymentResult.expired_at, orderId]
    );

    // Simpan payment log
    await conn.query(
      'INSERT INTO payment_logs (order_id, event, provider, response) VALUES (?,?,?,?)',
      [orderId, 'create', 'tokopay', JSON.stringify(paymentResult.raw)]
    );

    res.json({
      success:      true,
      order_id:     orderId,
      total_amount: paymentResult.total_bayar || total,
      payment_url:  finalPayUrl,
      va_number:    paymentResult.va_number,
      qr_code:      paymentResult.qr_code,
      checkout_url: paymentResult.checkout_url,
      expired_at:   paymentResult.expired_at,
      trx_id:       paymentResult.trx_id,
      payment_method,
    });
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ success: false, message: 'Gagal membuat pesanan' });
  } finally {
    conn.release();
  }
});

// GET /api/orders/:orderId — cek status order (public)
router.get('/:orderId', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT o.order_id, o.created_at, o.customer_no, o.customer_name, o.total_amount,
              o.payment_method, o.payment_status, o.topup_status, o.va_number, o.payment_url,
              o.qr_code, o.expired_at, o.paid_at, o.completed_at, o.sn,
              g.name AS game_name, g.icon AS game_icon,
              p.name AS package_name, p.sku
       FROM orders o
       JOIN games g ON o.game_id = g.id
       JOIN packages p ON o.package_id = p.id
       WHERE o.order_id = ?`,
      [req.params.orderId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
    res.json({ success: true, order: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memuat order' });
  }
});

// GET /api/orders — list orders (admin)
router.get('/', auth, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, game, search } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    let where = 'WHERE 1=1';
    if (status) { where += ' AND o.topup_status = ?'; params.push(status); }
    if (game)   { where += ' AND g.code = ?';         params.push(game); }
    if (search) {
      where += ' AND (o.order_id LIKE ? OR o.customer_no LIKE ? OR o.customer_name LIKE ?)';
      const q = `%${search}%`;
      params.push(q, q, q);
    }

    const [rows] = await db.query(
      `SELECT o.order_id, o.created_at, o.customer_no, o.customer_name, o.total_amount,
              o.payment_method, o.payment_status, o.topup_status, o.paid_at,
              g.name AS game_name, p.name AS package_name
       FROM orders o JOIN games g ON o.game_id = g.id JOIN packages p ON o.package_id = p.id
       ${where} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM orders o JOIN games g ON o.game_id = g.id ${where}`,
      params
    );

    res.json({ success: true, orders: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Gagal memuat data transaksi' });
  }
});

// POST /api/orders/:orderId/retry — retry topup manual (admin)
router.post('/:orderId/retry', auth, async (req, res) => {
  try {
    const [[order]] = await db.query(
      `SELECT o.*, p.digiflazz_sku FROM orders o JOIN packages p ON o.package_id = p.id WHERE o.order_id = ?`,
      [req.params.orderId]
    );
    if (!order) return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
    if (order.payment_status !== 'paid') return res.status(400).json({ success: false, message: 'Pembayaran belum dikonfirmasi' });

    const digiflazz = require('../lib/digiflazz');
    const refId     = order.digiflazz_ref || order.order_id;
    const result    = await digiflazz.createTransaction(refId, order.digiflazz_sku, order.customer_no);

    await db.query('INSERT INTO topup_logs (order_id, event, status, response) VALUES (?,?,?,?)',
      [order.order_id, 'retry', result.status, JSON.stringify(result)]);

    if (result.status === 'Sukses') {
      await db.query(
        "UPDATE orders SET topup_status='success', sn=?, completed_at=NOW() WHERE order_id=?",
        [result.sn || null, order.order_id]
      );
    }

    res.json({ success: true, status: result.status, sn: result.sn });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Gagal retry topup: ' + err.message });
  }
});

module.exports = router;
