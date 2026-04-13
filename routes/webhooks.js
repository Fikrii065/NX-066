const router     = require('express').Router();
const db         = require('../lib/db');
const tokopay    = require('../lib/tokopay');
const digiflazz  = require('../lib/digiflazz');

// POST /api/webhook/tokopay — callback pembayaran dari Tokopay
router.post('/tokopay', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const payload = req.body;
    console.log('[Webhook Tokopay] RAW PAYLOAD:', JSON.stringify(payload));

    // Verifikasi signature — skip jika secret belum diset (development)
    const SK = process.env.TOKOPAY_SECRET_KEY;
    if (SK && !tokopay.verifyCallback(payload)) {
      console.warn('[Webhook Tokopay] Signature tidak valid, payload:', JSON.stringify(payload));
      return res.status(400).json({ success: false, message: 'Signature invalid' });
    }

    // Tokopay mengirim order ID di field 'reff_id' atau 'ref_id' (bukan 'order_id')
    const orderId = payload.reff_id || payload.ref_id || payload.order_id;
    const status  = payload.status; // 'Success' | 'Expired' | 'Failed'

    // Simpan log
    await conn.query(
      'INSERT INTO payment_logs (order_id, event, provider, payload, response) VALUES (?,?,?,?,?)',
      [orderId, 'callback', 'tokopay', JSON.stringify(payload), JSON.stringify(payload)]
    );

    const [[order]] = await conn.query(
      `SELECT o.*, p.digiflazz_sku FROM orders o JOIN packages p ON o.package_id = p.id WHERE o.order_id = ?`,
      [orderId]
    );

    if (!order) {
      console.warn('[Webhook Tokopay] Order tidak ditemukan:', orderId);
      return res.json({ rc: '00', message: 'ok' }); // ack
    }

    if (status === 'Success' && order.payment_status !== 'paid') {
      // Update status bayar
      await conn.query(
        "UPDATE orders SET payment_status='paid', paid_at=NOW() WHERE order_id=?",
        [orderId]
      );

      // Proses top up ke Digiflazz
      try {
        const refId  = `${orderId}-${Date.now()}`;
        const result = await digiflazz.createTransaction(refId, order.digiflazz_sku, order.customer_no);

        await conn.query(
          'INSERT INTO topup_logs (order_id, event, status, payload, response) VALUES (?,?,?,?,?)',
          [orderId, 'request', result.status, JSON.stringify({ refId, sku: order.digiflazz_sku }), JSON.stringify(result)]
        );

        await conn.query(
          'UPDATE orders SET digiflazz_ref=?, topup_status=? WHERE order_id=?',
          [refId, result.status === 'Sukses' ? 'success' : result.status === 'Pending' ? 'processing' : 'failed', orderId]
        );

        if (result.status === 'Sukses') {
          await conn.query(
            "UPDATE orders SET sn=?, completed_at=NOW() WHERE order_id=?",
            [result.sn || null, orderId]
          );
        }
      } catch (dErr) {
        console.error('[Webhook Tokopay] Digiflazz error:', dErr.message);
        await conn.query(
          'INSERT INTO topup_logs (order_id, event, status, response) VALUES (?,?,?,?)',
          [orderId, 'request_error', 'Gagal', JSON.stringify({ error: dErr.message })]
        );
        await conn.query("UPDATE orders SET topup_status='failed' WHERE order_id=?", [orderId]);
      }
    } else if (status === 'Expired') {
      await conn.query("UPDATE orders SET payment_status='expired' WHERE order_id=?", [orderId]);
    } else if (status === 'Failed') {
      await conn.query("UPDATE orders SET payment_status='failed' WHERE order_id=?", [orderId]);
    }

    res.json({ rc: '00', message: 'ok' });
  } catch (err) {
    console.error('[Webhook Tokopay] Error:', err);
    res.status(500).json({ rc: '99', message: 'error' });
  } finally {
    conn.release();
  }
});

// POST /api/webhook/digiflazz — callback status topup dari Digiflazz
router.post('/digiflazz', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const payload = req.body;
    const data    = payload.data || payload;
    console.log('[Webhook Digiflazz]', JSON.stringify(data));

    // Verifikasi signature
    if (!digiflazz.verifyWebhook(data, process.env.DIGIFLAZZ_WEBHOOK_SECRET)) {
      console.warn('[Webhook Digiflazz] Signature tidak valid');
      return res.status(400).json({ status: false, message: 'Invalid signature' });
    }

    const refId  = data.ref_id;
    const status = data.status; // 'Sukses' | 'Gagal' | 'Pending'

    const [[order]] = await conn.query("SELECT * FROM orders WHERE digiflazz_ref = ?", [refId]);
    if (!order) {
      return res.json({ status: true }); // ack
    }

    await conn.query(
      'INSERT INTO topup_logs (order_id, event, status, response) VALUES (?,?,?,?)',
      [order.order_id, 'callback', status, JSON.stringify(data)]
    );

    let topupStatus;
    if (status === 'Sukses')  topupStatus = 'success';
    else if (status === 'Gagal')   topupStatus = 'failed';
    else                           topupStatus = 'processing';

    await conn.query(
      'UPDATE orders SET topup_status=?, sn=? WHERE order_id=?',
      [topupStatus, data.sn || null, order.order_id]
    );

    if (topupStatus === 'success') {
      await conn.query("UPDATE orders SET completed_at=NOW() WHERE order_id=?", [order.order_id]);
    }

    res.json({ status: true });
  } catch (err) {
    console.error('[Webhook Digiflazz] Error:', err);
    res.status(500).json({ status: false });
  } finally {
    conn.release();
  }
});

module.exports = router;
