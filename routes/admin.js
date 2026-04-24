'use strict';
const router  = require('express').Router();
const db      = require('../lib/db');
const auth    = require('../middleware/auth');
const axios   = require('axios');
const crypto  = require('crypto');

// GET /api/admin/dashboard
router.get('/dashboard', auth, async (req, res) => {
  try {
    const [[today]] = await db.query(`
      SELECT COUNT(*) AS total_orders,
        COALESCE(SUM(payment_status='paid'),0) AS paid_orders,
        COALESCE(SUM(topup_status='success'),0) AS success_orders,
        COALESCE(SUM(topup_status='failed'),0) AS failed_orders,
        COALESCE(SUM(CASE WHEN payment_status='paid' THEN total_amount ELSE 0 END),0) AS revenue
      FROM orders WHERE DATE(created_at)=CURDATE()`);
    const [[yesterday]] = await db.query(`
      SELECT COALESCE(SUM(CASE WHEN payment_status='paid' THEN total_amount ELSE 0 END),0) AS revenue
      FROM orders WHERE DATE(created_at)=DATE_SUB(CURDATE(),INTERVAL 1 DAY)`);
    const [recent] = await db.query(`
      SELECT o.order_id,o.created_at,o.total_amount,o.payment_status,o.topup_status,
             COALESCE(g.name,'?') AS game_name, COALESCE(g.icon,'🎮') AS game_icon,
             COALESCE(p.name,'?') AS package_name
      FROM orders o
      LEFT JOIN games g ON o.game_id=g.id
      LEFT JOIN packages p ON o.package_id=p.id
      ORDER BY o.created_at DESC LIMIT 10`);
    res.json({ success: true, today, yesterday, recent_orders: recent });
  } catch (e) {
    console.error('[dashboard]', e.message);
    res.status(500).json({ success: false, message: 'Gagal memuat dashboard' });
  }
});

// GET /api/admin/digiflazz/balance
router.get('/digiflazz/balance', auth, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT key_name,value FROM settings WHERE key_name LIKE 'digiflazz%'");
    const cfg = Object.fromEntries(rows.map(r => [r.key_name, r.value]));
    const username = cfg.digiflazz_username || process.env.DIGIFLAZZ_USERNAME;
    const mode     = cfg.digiflazz_mode || 'development';
    const apiKey   = mode === 'production'
      ? (cfg.digiflazz_key_prod || process.env.DIGIFLAZZ_API_KEY_PROD)
      : (cfg.digiflazz_key_dev  || process.env.DIGIFLAZZ_API_KEY_DEV);
    if (!username || !apiKey) return res.json({ success: false, message: 'Digiflazz belum dikonfigurasi' });
    const sign = crypto.createHash('md5').update(username + apiKey + 'depo').digest('hex');
    const { data } = await axios.post('https://api.digiflazz.com/v1/cek-saldo', { cmd: 'deposit', username, sign }, { timeout: 10000 });
    res.json({ success: true, balance: data.data?.deposit ?? 0 });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// GET /api/admin/digiflazz/pricelist
router.get('/digiflazz/pricelist', auth, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT key_name,value FROM settings WHERE key_name LIKE 'digiflazz%'");
    const cfg = Object.fromEntries(rows.map(r => [r.key_name, r.value]));
    const username = cfg.digiflazz_username || process.env.DIGIFLAZZ_USERNAME;
    const mode     = cfg.digiflazz_mode || 'development';
    const apiKey   = mode === 'production'
      ? (cfg.digiflazz_key_prod || process.env.DIGIFLAZZ_API_KEY_PROD)
      : (cfg.digiflazz_key_dev  || process.env.DIGIFLAZZ_API_KEY_DEV);
    if (!username || !apiKey) return res.status(400).json({ success: false, message: 'Digiflazz belum dikonfigurasi' });
    const sign = crypto.createHash('md5').update(username + apiKey + 'pricelist').digest('hex');
    const { data } = await axios.post('https://api.digiflazz.com/v1/price-list', { cmd: 'prepaid', username, sign }, { timeout: 60000 });
    const products = Array.isArray(data.data) ? data.data : [];
    res.json({ success: true, products, total: products.length });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// POST /api/admin/digiflazz/sync - sync pricelist ke packages
router.post('/digiflazz/sync', auth, async (req, res) => {
  try {
    const { products = [], action = 'update' } = req.body;
    let imported=0, updated=0, skipped=0;
    for (const p of products) {
      const { buyer_sku_code: sku, product_name: name, price, category, brand } = p;
      if (!sku || !name || !price) { skipped++; continue; }
      const basePrice = parseInt(price) || 0;
      const [[existing]] = await db.query('SELECT id FROM packages WHERE digiflazz_sku=?', [sku]);
      if (existing) {
        if (action !== 'import') { await db.query('UPDATE packages SET base_price=?,name=? WHERE digiflazz_sku=?', [basePrice, name, sku]); updated++; }
        else skipped++;
      } else {
        if (action !== 'update') {
          const cat = (category || brand || 'Lainnya').toLowerCase();
          const [[game]] = await db.query('SELECT id FROM games WHERE LOWER(name) LIKE ? OR LOWER(code) LIKE ? LIMIT 1', [`%${cat}%`,`%${cat}%`]);
          const gameId = game?.id || 1;
          const internalSku = sku.toLowerCase().replace(/[^a-z0-9]/g,'-').slice(0,60);
          try { await db.query('INSERT IGNORE INTO packages (game_id,sku,name,digiflazz_sku,base_price) VALUES (?,?,?,?,?)', [gameId, internalSku, name, sku, basePrice]); imported++; } catch(_) { skipped++; }
        } else skipped++;
      }
    }
    res.json({ success: true, imported, updated, skipped });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// PATCH /api/admin/orders/:id/retry
router.patch('/orders/:order_id/retry', auth, async (req, res) => {
  try {
    const [[o]] = await db.query('SELECT * FROM orders WHERE order_id=? LIMIT 1', [req.params.order_id]);
    if (!o) return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
    const [[pkg]] = await db.query('SELECT * FROM packages WHERE id=?', [o.package_id]);
    if (!pkg) return res.status(404).json({ success: false, message: 'Paket tidak ditemukan' });
    await db.query("UPDATE orders SET topup_status='pending' WHERE order_id=?", [o.order_id]);
    // trigger digiflazz async
    const { processDigiflazz } = require('./orders');
    res.json({ success: true, message: 'Retry dijadwalkan' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// GET /api/admin/users - proxy to users list
const usersRouter = require('./users');
router.use('/users', usersRouter);

module.exports = router;
