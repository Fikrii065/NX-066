'use strict';
const router = require('express').Router();
const db     = require('../lib/db');
const crypto = require('crypto');
const axios  = require('axios');

// POST /api/webhooks/tokopay atau /api/webhook/tokopay
router.post('/tokopay', async (req, res) => {
  try {
    console.log('[Webhook] Tokopay payload:', JSON.stringify(req.body));

    // Tokopay bisa kirim: order_id, ref_id, atau id_order
    const order_id = req.body.order_id || req.body.ref_id || req.body.id_order || req.body.reff_id;
    const status   = req.body.status   || req.body.payment_status || req.body.trx_status;
    const signature = req.body.signature || req.body.sign;

    if (!order_id) {
      console.warn('[Webhook] Tidak ada order_id di payload:', JSON.stringify(req.body));
      return res.status(400).json({ success: false, message: 'order_id tidak ditemukan' });
    }

    // Verify signature (opsional, log saja jika mismatch)
    const [cfgRows] = await db.query("SELECT key_name,value FROM settings WHERE key_name IN ('tokopay_merchant_id','tokopay_secret_key')");
    const cfg = Object.fromEntries(cfgRows.map(r => [r.key_name, r.value]));
    const merchantId = cfg.tokopay_merchant_id || process.env.TOKOPAY_MERCHANT_ID || '';
    const secretKey  = cfg.tokopay_secret_key  || process.env.TOKOPAY_SECRET_KEY  || '';
    if (signature && merchantId && secretKey) {
      const expectedSign = crypto.createHash('md5').update(`${merchantId}${secretKey}${order_id}`).digest('hex');
      if (signature !== expectedSign) {
        console.warn('[Webhook] Signature mismatch untuk', order_id);
      }
    }

    const [[order]] = await db.query('SELECT * FROM orders WHERE order_id=? LIMIT 1', [order_id]);
    if (!order) {
      console.warn('[Webhook] Order tidak ditemukan:', order_id);
      return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
    }
    if (order.payment_status === 'paid') {
      return res.json({ success: true, message: 'Already paid' });
    }

    const isPaid = status && ['Success','success','PAID','paid','settlement','00','SETTLEMENT'].includes(String(status));
    const isExpired = status && ['Expired','expired','EXPIRED','CANCEL','cancel','failure','FAILURE'].includes(String(status));

    if (isPaid) {
      await db.query("UPDATE orders SET payment_status='paid', paid_at=NOW() WHERE order_id=?", [order_id]);
      console.log('[Webhook] Order', order_id, 'marked as PAID');
      const [[pkg]] = await db.query('SELECT * FROM packages WHERE id=?', [order.package_id]);
      if (pkg) {
        processDigiflazz(order_id, pkg.digiflazz_sku || pkg.sku, order.customer_no)
          .catch(e => console.error('[Webhook Digiflazz]', e.message));
      }
    } else if (isExpired) {
      await db.query("UPDATE orders SET payment_status='expired' WHERE order_id=?", [order_id]);
      console.log('[Webhook] Order', order_id, 'marked as EXPIRED');
    } else {
      console.log('[Webhook] Status tidak dikenali:', status, 'untuk order', order_id);
    }

    res.json({ success: true });
  } catch (e) {
    console.error('[webhook/tokopay]', e.message);
    res.status(500).json({ success: false });
  }
});

async function processDigiflazz(orderId, sku, customerNo) {
  const [cfgRows] = await db.query("SELECT key_name,value FROM settings WHERE key_name LIKE 'digiflazz%'");
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
}

module.exports = router;
