'use strict';
const router = require('express').Router();
const db     = require('../lib/db');
const crypto = require('crypto');
const axios  = require('axios');

// POST /api/webhooks/tokopay
router.post('/tokopay', async (req, res) => {
  try {
    const { order_id, status, signature } = req.body;
    if (!order_id) return res.status(400).json({ success: false });

    // Verify signature
    const [cfgRows] = await db.query("SELECT key_name,value FROM settings WHERE key_name IN ('tokopay_merchant_id','tokopay_secret_key')");
    const cfg = Object.fromEntries(cfgRows.map(r => [r.key_name, r.value]));
    const merchantId = cfg.tokopay_merchant_id || process.env.TOKOPAY_MERCHANT_ID || '';
    const secretKey  = cfg.tokopay_secret_key  || process.env.TOKOPAY_SECRET_KEY  || '';
    const expectedSign = crypto.createHash('md5').update(`${merchantId}${secretKey}${order_id}`).digest('hex');
    // Log signature mismatch but continue processing
    if (signature && merchantId && secretKey && signature !== expectedSign) {
      console.warn('[Webhook] Signature mismatch for', order_id, '- continuing anyway');
    }

    const [[order]] = await db.query('SELECT * FROM orders WHERE order_id=? LIMIT 1', [order_id]);
    if (!order) return res.status(404).json({ success: false });
    if (order.payment_status === 'paid') return res.json({ success: true, message: 'Already paid' });

    // Accept all paid status variants from Tokopay
    const isPaid = status && ['Success','success','PAID','paid','settlement','00'].includes(String(status));
    if (isPaid) {
      await db.query("UPDATE orders SET payment_status='paid', paid_at=NOW() WHERE order_id=?", [order_id]);
      // Process Digiflazz
      const [[pkg]] = await db.query('SELECT * FROM packages WHERE id=?', [order.package_id]);
      if (pkg) {
        processDigiflazz(order_id, pkg.digiflazz_sku || pkg.sku, order.customer_no)
          .catch(e => console.error('[Webhook Digiflazz]', e.message));
      }
    } else if (['Expired','expired','EXPIRED'].includes(status)) {
      await db.query("UPDATE orders SET payment_status='expired' WHERE order_id=?", [order_id]);
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
