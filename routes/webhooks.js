const router     = require('express').Router();
const db         = require('../lib/db');
const tokopay    = require('../lib/tokopay');
const digiflazz  = require('../lib/digiflazz');
const fonnte     = require('../lib/fonnte');

// ── Helper: ambil data order lengkap (join game & package name) ───────────────
async function getOrderFull(conn, orderId) {
  const [[row]] = await conn.query(
    `SELECT o.*, g.name AS game_name, p.name AS package_name, p.digiflazz_sku
     FROM orders o
     JOIN games g    ON o.game_id    = g.id
     JOIN packages p ON o.package_id = p.id
     WHERE o.order_id = ?`,
    [orderId]
  );
  return row || null;
}

// POST /api/webhook/tokopay — callback pembayaran dari Tokopay
router.post('/tokopay', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const payload = req.body;
    console.log('[Webhook Tokopay] RAW PAYLOAD:', JSON.stringify(payload));

    const refId = payload.reff_id || payload.ref_id || payload.order_id;
    if (!refId) {
      console.warn('[Webhook Tokopay] Payload kosong atau tidak ada ref_id, skip.');
      return res.json({ rc: '00', message: 'ok' });
    }

    // FIX #3: Verifikasi signature Tokopay — tolak request palsu
    const [[skRow]] = await conn.query(
      "SELECT value FROM settings WHERE key_name = 'tokopay_secret_key' LIMIT 1"
    );
    const secretKey = skRow?.value || process.env.TOKOPAY_SECRET_KEY || '';

    if (secretKey && !tokopay.verifyCallback(payload, secretKey)) {
      console.warn('[Webhook Tokopay] Signature tidak valid — request ditolak!', {
        ref_id: refId,
        signature: payload.signature || payload.sign,
      });
      // Tetap return 200 agar Tokopay tidak retry, tapi tidak proses
      return res.json({ rc: '00', message: 'ok' });
    }

    const orderId = refId;
    const status  = payload.status; // 'Success' | 'Expired' | 'Failed'

    // Simpan log
    await conn.query(
      'INSERT INTO payment_logs (order_id, event, provider, payload, response) VALUES (?,?,?,?,?)',
      [orderId, 'callback', 'tokopay', JSON.stringify(payload), JSON.stringify(payload)]
    );

    const order = await getOrderFull(conn, orderId);

    if (!order) {
      console.warn('[Webhook Tokopay] Order tidak ditemukan:', orderId);
      return res.json({ rc: '00', message: 'ok' });
    }

    if (status === 'Success' && order.payment_status !== 'paid') {
      // Update status bayar
      await conn.query(
        "UPDATE orders SET payment_status='paid', paid_at=NOW() WHERE order_id=?",
        [orderId]
      );

      // Notifikasi: Pembayaran diterima
      fonnte.notifyPaymentSuccess(order).catch(e => console.error('[Fonnte] notifyPaymentSuccess:', e.message));

      // Proses top up ke Digiflazz
      try {
        const dgRef  = `${orderId}-${Date.now()}`;
        const result = await digiflazz.createTransaction(dgRef, order.digiflazz_sku, order.customer_no);

        await conn.query(
          'INSERT INTO topup_logs (order_id, event, status, payload, response) VALUES (?,?,?,?,?)',
          [orderId, 'request', result.status, JSON.stringify({ refId: dgRef, sku: order.digiflazz_sku }), JSON.stringify(result)]
        );

        const topupStatusWh = result.status === 'Sukses' ? 'success' : result.status === 'Pending' ? 'processing' : 'failed';
        const topupErrorWh  = topupStatusWh === 'failed' ? (result.message || 'Top up gagal') : null;

        await conn.query(
          'UPDATE orders SET digiflazz_ref=?, topup_status=?, notes=? WHERE order_id=?',
          [dgRef, topupStatusWh, topupErrorWh, orderId]
        );

        if (result.status === 'Sukses') {
          await conn.query(
            "UPDATE orders SET sn=?, completed_at=NOW() WHERE order_id=?",
            [result.sn || null, orderId]
          );
          // Notifikasi: Top up sukses
          fonnte.notifyTopupSuccess({ ...order, sn: result.sn || null, completed_at: new Date() })
            .catch(e => console.error('[Fonnte] notifyTopupSuccess:', e.message));

        } else if (topupStatusWh === 'failed') {
          // Notifikasi: Top up gagal langsung dari Digiflazz
          fonnte.notifyTopupFailed({ ...order, notes: topupErrorWh })
            .catch(e => console.error('[Fonnte] notifyTopupFailed:', e.message));
        }

      } catch (dErr) {
        const dErrDetail = dErr.response?.data || dErr.message;
        const dErrMsg    = dErr.response?.data?.data?.message || dErr.response?.data?.message || dErr.message || 'Gagal menghubungi Digiflazz';
        console.error('[Webhook Tokopay] Digiflazz error:', JSON.stringify(dErrDetail));
        await conn.query(
          'INSERT INTO topup_logs (order_id, event, status, response) VALUES (?,?,?,?)',
          [orderId, 'request_error', 'Gagal', JSON.stringify({ error: dErrDetail })]
        );
        const failMsg = `Top up gagal diproses: ${dErrMsg}. Silakan hubungi admin untuk diproses manual.`;
        await conn.query(
          "UPDATE orders SET topup_status='failed', notes=? WHERE order_id=?",
          [failMsg, orderId]
        );
        // Notifikasi: Top up gagal (exception)
        fonnte.notifyTopupFailed({ ...order, notes: failMsg })
          .catch(e => console.error('[Fonnte] notifyTopupFailed:', e.message));
        console.log('[Webhook Tokopay] Order', orderId, 'marked as failed topup.');
      }

    } else if (status === 'Expired') {
      await conn.query("UPDATE orders SET payment_status='expired' WHERE order_id=?", [orderId]);
      // Notifikasi: Pembayaran expired
      fonnte.notifyPaymentExpired(order)
        .catch(e => console.error('[Fonnte] notifyPaymentExpired:', e.message));

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

    // Verifikasi signature Digiflazz
    if (!await digiflazz.verifyWebhook(data, process.env.DIGIFLAZZ_WEBHOOK_SECRET)) {
      console.warn('[Webhook Digiflazz] Signature tidak valid');
      return res.status(400).json({ status: false, message: 'Invalid signature' });
    }

    const refId  = data.ref_id;
    const status = data.status;

    const [[orderRaw]] = await conn.query("SELECT * FROM orders WHERE digiflazz_ref = ?", [refId]);
    if (!orderRaw) return res.json({ status: true });

    const order = await getOrderFull(conn, orderRaw.order_id);

    await conn.query(
      'INSERT INTO topup_logs (order_id, event, status, response) VALUES (?,?,?,?)',
      [order.order_id, 'callback', status, JSON.stringify(data)]
    );

    let topupStatus;
    if (status === 'Sukses')       topupStatus = 'success';
    else if (status === 'Gagal')   topupStatus = 'failed';
    else                           topupStatus = 'processing';

    const failNotes = topupStatus === 'failed'
      ? (data.message || 'Top up gagal diproses oleh provider. Silakan hubungi admin untuk diproses manual.')
      : null;

    await conn.query(
      'UPDATE orders SET topup_status=?, sn=?, notes=IF(? IS NOT NULL, ?, notes) WHERE order_id=?',
      [topupStatus, data.sn || null, failNotes, failNotes, order.order_id]
    );

    if (topupStatus === 'success') {
      await conn.query("UPDATE orders SET completed_at=NOW() WHERE order_id=?", [order.order_id]);
      fonnte.notifyTopupSuccess({ ...order, sn: data.sn || null, completed_at: new Date() })
        .catch(e => console.error('[Fonnte] notifyTopupSuccess:', e.message));

    } else if (topupStatus === 'failed') {
      fonnte.notifyTopupFailed({ ...order, notes: failNotes })
        .catch(e => console.error('[Fonnte] notifyTopupFailed:', e.message));
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
