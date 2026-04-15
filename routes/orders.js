const router     = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db         = require('../lib/db');
const tokopay    = require('../lib/tokopay');
const auth       = require('../middleware/auth');
const jwt        = require('jsonwebtoken');

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

    // Cek apakah user reseller (dari JWT token)
    let isReseller = false;
    try {
      const hdr = req.headers.authorization || '';
      const tok = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
      if (tok) {
        const pl = jwt.verify(tok, process.env.JWT_SECRET);
        if (pl.role === 'reseller') isReseller = true;
      }
    } catch(_) {}

    const pct      = isReseller ? 0 : (parseFloat(settings.markup_percent) || 5);
    const min      = isReseller ? 0 : (parseInt(settings.markup_minimum)   || 500);
    const feeKey   = `fee_${payment_method}`;
    const fee      = payment_method === 'balance' ? 0 : (parseInt(settings[feeKey]) || 0);
    const payChannel = settings[`pay_channel_${payment_method}`] || payment_method;

    const sellPrice  = calcSellPrice(pkg.base_price, pct, min);
    const total      = sellPrice + fee;
    const orderId    = generateOrderId();

    // ── Pembayaran dengan Saldo Akun ─────────────────────────────────────────
    if (payment_method === 'balance') {
      // Cek token user
      const header = req.headers.authorization || '';
      const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
      if (!token) return res.status(401).json({ success: false, message: 'Login diperlukan untuk bayar dengan saldo' });
      let userId;
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        if (payload.type !== 'user') throw new Error();
        userId = payload.id;
      } catch {
        return res.status(401).json({ success: false, message: 'Token tidak valid' });
      }

      await conn.beginTransaction();
      const [[userRow]] = await conn.query('SELECT id, balance, email FROM users WHERE id = ? FOR UPDATE', [userId]);
      if (!userRow) { await conn.rollback(); return res.status(404).json({ success: false, message: 'User tidak ditemukan' }); }
      if (parseFloat(userRow.balance) < total) {
        await conn.rollback();
        return res.status(400).json({ success: false, message: `Saldo tidak cukup. Saldo kamu: Rp ${Number(userRow.balance).toLocaleString('id-ID')}, dibutuhkan: Rp ${total.toLocaleString('id-ID')}` });
      }

      // Kurangi saldo
      await conn.query('UPDATE users SET balance = balance - ? WHERE id = ?', [total, userId]);

      // Catat ke balance_logs
      await conn.query(
        `INSERT INTO balance_logs (user_id, type, amount, description, ref_id, created_at)
         VALUES (?, 'deduct', ?, ?, ?, NOW())`,
        [userId, total, `Pembelian ${pkg.game_name} - ${pkg.name}`, orderId]
      );

      // Simpan order langsung paid
      await conn.query(
        `INSERT INTO orders
          (order_id, game_id, package_id, customer_no, customer_name, customer_email, customer_wa,
           base_price, sell_price, service_fee, total_amount, payment_method, payment_status, topup_status, paid_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'paid','pending',NOW())`,
        [orderId, game_id, pkg.id, customer_no, customer_name || null, userRow.email,
         customer_wa || null, pkg.base_price, sellPrice, fee, total, 'balance']
      );

      await conn.commit();

      // Proses topup otomatis ke Digiflazz
      try {
        const digiflazz = require('../lib/digiflazz');
        const txResult = await digiflazz.createTransaction(orderId, pkg.sku, customer_no);
        const newStatus = txResult.status === 'Sukses' ? 'success' : txResult.status === 'Gagal' ? 'failed' : 'process';
        await db.query(
          'UPDATE orders SET topup_status=?, sn=?, completed_at=? WHERE order_id=?',
          [newStatus, txResult.sn || null, newStatus === 'success' ? new Date() : null, orderId]
        );
      } catch (digErr) {
        console.error('[Balance order] Digiflazz error:', digErr.message);
        await db.query('UPDATE orders SET topup_status="process" WHERE order_id=?', [orderId]);
      }

      return res.json({
        success: true,
        order_id: orderId,
        total_amount: total,
        payment_method: 'balance',
        payment_status: 'paid',
        message: 'Pembayaran berhasil menggunakan saldo akun',
      });
    }

    // Cek metode pembayaran aktif (non-balance)
    if (settings[`pay_enabled_${payment_method}`] === '0') {
      return res.status(400).json({ success: false, message: 'Metode pembayaran tidak tersedia' });
    }

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
        callbackUrl: `${process.env.APP_URL || ''}/api/webhook/tokopay`,
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

// GET /api/orders/:orderId/check-payment — cek status order dari DB (webhook yg update)
router.get('/:orderId/check-payment', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const [[order]] = await conn.query(
      `SELECT o.*, p.digiflazz_sku FROM orders o JOIN packages p ON o.package_id = p.id WHERE o.order_id = ?`,
      [req.params.orderId]
    );
    if (!order) return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });

    // Jika sudah paid tapi topup masih pending, trigger digiflazz
    if (order.payment_status === 'paid' && order.topup_status === 'pending') {
      console.log('[CheckPayment] Payment paid tapi topup pending, trigger digiflazz:', order.order_id);
      const digiflazz = require('../lib/digiflazz');
      try {
        const refId  = `${order.order_id}-${Date.now()}`;
        const result = await digiflazz.createTransaction(refId, order.digiflazz_sku, order.customer_no);
        await conn.query('INSERT INTO topup_logs (order_id, event, status, response) VALUES (?,?,?,?)',
          [order.order_id, 'request', result.status, JSON.stringify(result)]);
        const topupStatus = result.status === 'Sukses' ? 'success' : result.status === 'Pending' ? 'processing' : 'failed';
        const topupError  = topupStatus === 'failed' ? (result.message || 'Top up gagal') : null;
        await conn.query('UPDATE orders SET digiflazz_ref=?, topup_status=?, notes=? WHERE order_id=?',
          [refId, topupStatus, topupError, order.order_id]);
        if (result.status === 'Sukses') {
          await conn.query("UPDATE orders SET sn=?, completed_at=NOW() WHERE order_id=?", [result.sn || null, order.order_id]);
        }
      } catch (dErr) {
        console.error('[CheckPayment] Digiflazz error:', dErr.message);
        await conn.query("UPDATE orders SET topup_status='failed' WHERE order_id=?", [order.order_id]);
      }
    }

    // Re-fetch order terbaru
    const [[updated]] = await conn.query(
      `SELECT o.order_id, o.payment_status, o.topup_status FROM orders o WHERE o.order_id = ?`,
      [req.params.orderId]
    );

    res.json({ success: true, payment_status: updated.payment_status, topup_status: updated.topup_status });
  } catch (err) {
    console.error('[CheckPayment] Error:', err.message);
    res.json({ success: false, message: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
