const router = require('express').Router();
const db     = require('../lib/db');
const auth   = require('../middleware/auth');
const digiflazz = require('../lib/digiflazz');

// GET /api/admin/dashboard — statistik dashboard
router.get('/dashboard', auth, async (req, res) => {
  try {
    const [[today]] = await db.query(`
      SELECT
        COUNT(*) AS total_orders,
        SUM(payment_status = 'paid') AS paid_orders,
        SUM(topup_status = 'success') AS success_orders,
        SUM(topup_status = 'failed') AS failed_orders,
        COALESCE(SUM(CASE WHEN payment_status='paid' THEN total_amount ELSE 0 END),0) AS revenue
      FROM orders
      WHERE DATE(created_at) = CURDATE()`);

    const [[yesterday]] = await db.query(`
      SELECT COALESCE(SUM(CASE WHEN payment_status='paid' THEN total_amount ELSE 0 END),0) AS revenue,
             COUNT(*) AS total_orders
      FROM orders
      WHERE DATE(created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)`);

    const [recentOrders] = await db.query(`
      SELECT o.order_id, o.created_at, o.total_amount, o.payment_status, o.topup_status,
             g.name AS game_name, g.icon AS game_icon, p.name AS package_name
      FROM orders o JOIN games g ON o.game_id = g.id JOIN packages p ON o.package_id = p.id
      ORDER BY o.created_at DESC LIMIT 10`);

    // Saldo Digiflazz (opsional, bisa gagal)
    let balance = null;
    try {
      const bal = await digiflazz.getBalance();
      balance = bal?.deposit || null;
    } catch (_) {}

    res.json({
      success: true,
      today,
      yesterday: { revenue: yesterday.revenue, total_orders: yesterday.total_orders },
      recent_orders: recentOrders,
      digiflazz_balance: balance,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Gagal memuat dashboard' });
  }
});

// GET /api/admin/stats/daily — statistik 30 hari
router.get('/stats/daily', auth, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT DATE(created_at) AS date,
             COUNT(*) AS total_orders,
             SUM(topup_status = 'success') AS success_orders,
             COALESCE(SUM(CASE WHEN payment_status='paid' THEN total_amount ELSE 0 END),0) AS revenue
      FROM orders
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY DATE(created_at)
      ORDER BY date ASC`);
    res.json({ success: true, stats: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memuat statistik' });
  }
});

// POST /api/admin/sync-products — auto sync produk dari Digiflazz
router.post('/sync-products', auth, async (req, res) => {
  try {
    const axios  = require('axios');
    const crypto = require('crypto');

    const username = process.env.DIGIFLAZZ_USERNAME;
    const apiKey   = process.env.DIGIFLAZZ_MODE === 'production'
      ? process.env.DIGIFLAZZ_API_KEY_PROD
      : process.env.DIGIFLAZZ_API_KEY_DEV;

    const sign = crypto.createHash('md5')
      .update(username + apiKey + 'pricelist').digest('hex');

    const { data } = await axios.post('https://api.digiflazz.com/v1/price-list', {
      cmd: 'prepaid', username, sign,
    }, { timeout: 30000 });

    const products = data?.data || [];
    if (!products.length) {
      return res.json({ success: false, message: 'Tidak ada produk dari Digiflazz. Cek username/apikey.' });
    }

    // Ambil semua game dari DB
    const [games] = await db.query('SELECT id, code, name FROM games WHERE is_active = 1');

    // Map keyword game ke game_id
    const GAME_MAP = {
      'mobile-legends':  ['mobile legend', 'mlbb'],
      'free-fire':       ['free fire', 'garena free fire'],
      'free-fire-max':   ['free fire max'],
      'pubgm':           ['pubg mobile', 'pubg m'],
      'valorant':        ['valorant'],
      'genshin-impact':  ['genshin'],
      'honkai-star-rail': ['honkai star rail', 'honkai: star'],
    };

    function findGameId(productName) {
      const name = productName.toLowerCase();
      for (const game of games) {
        const keywords = GAME_MAP[game.code] || [game.name.toLowerCase().split(':')[0].trim()];
        if (keywords.some(k => name.includes(k))) return game.id;
      }
      return null;
    }

    let inserted = 0, updated = 0, skipped = 0;

    for (const p of products) {
      if (!p.buyer_sku_code || !p.product_name || !p.price) { skipped++; continue; }

      const gameId = findGameId(p.product_name);
      if (!gameId) { skipped++; continue; }

      const sku       = 'DGF-' + p.buyer_sku_code;
      const basePrice = parseInt(p.price) || 0;
      const isActive  = p.seller_product_status ? 1 : 0;

      try {
        const [existing] = await db.query('SELECT id FROM packages WHERE sku = ?', [sku]);
        if (existing.length) {
          await db.query(
            'UPDATE packages SET name=?, base_price=?, is_active=? WHERE sku=?',
            [p.product_name, basePrice, isActive, sku]
          );
          updated++;
        } else {
          await db.query(
            'INSERT INTO packages (game_id, sku, name, digiflazz_sku, base_price, is_active, sort_order) VALUES (?,?,?,?,?,?,99)',
            [gameId, sku, p.product_name, p.buyer_sku_code, basePrice, isActive]
          );
          inserted++;
        }
      } catch (_) { skipped++; }
    }

    res.json({
      success: true,
      message: `Sync selesai! ${inserted} produk baru, ${updated} diperbarui, ${skipped} dilewati.`,
      total: products.length, inserted, updated, skipped,
    });
  } catch (err) {
    console.error('Sync error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal sync: ' + err.message });
  }
});

module.exports = router;
