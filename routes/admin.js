const router    = require('express').Router();
const db        = require('../lib/db');
const auth      = require('../middleware/auth');
const digiflazz = require('../lib/digiflazz');
const axios     = require('axios');
const crypto    = require('crypto');

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

    const [games] = await db.query('SELECT id, code, name FROM games WHERE is_active = 1');

    const GAME_MAP = {
      'mobile-legends':   ['mobile legend', 'mlbb'],
      'free-fire':        ['free fire', 'garena free fire'],
      'free-fire-max':    ['free fire max'],
      'pubgm':            ['pubg mobile', 'pubg m'],
      'valorant':         ['valorant'],
      'genshin-impact':   ['genshin'],
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

// ── GET /api/admin/digiflazz/pricelist ──────────────────────────────────────
router.get('/digiflazz/pricelist', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT key_name, value FROM settings WHERE key_name IN ('digiflazz_username','digiflazz_key_dev','digiflazz_key_prod','digiflazz_mode')"
    );
    const cfg = Object.fromEntries(rows.map(r => [r.key_name, r.value]));

    const username = cfg.digiflazz_username;
    const mode     = cfg.digiflazz_mode || 'development';
    const apiKey   = mode === 'production' ? cfg.digiflazz_key_prod : cfg.digiflazz_key_dev;

    if (!username || !apiKey) {
      return res.status(400).json({ success: false, message: 'Konfigurasi Digiflazz belum lengkap.' });
    }

    const sign = crypto.createHash('md5').update(username + apiKey + 'pricelist').digest('hex');
    const { data } = await axios.post('https://api.digiflazz.com/v1/price-list', {
      cmd: 'prepaid', username, sign,
    }, { timeout: 15000 });

    let products = data.data || [];

    const cat = req.query.category;
    if (cat) products = products.filter(p =>
      p.category?.toLowerCase().includes(cat.toLowerCase()) ||
      p.brand?.toLowerCase().includes(cat.toLowerCase())
    );

    const seen = new Set();
    products = products.filter(p => {
      if (seen.has(p.buyer_sku_code)) return false;
      seen.add(p.buyer_sku_code);
      return true;
    });

    res.json({ success: true, products, total: products.length });
  } catch (err) {
    console.error('[Digiflazz pricelist error]', err.message);
    const msg = err.response?.data?.message || err.message || 'Gagal menghubungi Digiflazz';
    res.status(500).json({ success: false, message: msg });
  }
});

// ── POST /api/admin/digiflazz/sync ──────────────────────────────────────────
router.post('/digiflazz/sync', auth, async (req, res) => {
  try {
    const { products = [], action = 'update' } = req.body;
    if (!products.length) return res.json({ success: true, imported: 0, updated: 0, skipped: 0 });

    let imported = 0, updated = 0, skipped = 0;

    for (const p of products) {
      const sku       = p.buyer_sku_code;
      const name      = p.product_name;
      const basePrice = parseInt(p.price) || 0;
      const category  = p.category || p.brand || 'Lainnya';

      if (!sku || !name || !basePrice) { skipped++; continue; }

      const [[existing]] = await db.query('SELECT id FROM packages WHERE digiflazz_sku = ?', [sku]);

      if (existing) {
        if (action === 'update' || action === 'full') {
          await db.query('UPDATE packages SET base_price = ?, name = ? WHERE digiflazz_sku = ?', [basePrice, name, sku]);
          updated++;
        } else { skipped++; }
      } else {
        if (action === 'import' || action === 'full') {
          const [[game]] = await db.query(
            'SELECT id FROM games WHERE LOWER(name) LIKE ? OR LOWER(code) LIKE ? LIMIT 1',
            [`%${category.toLowerCase()}%`, `%${category.toLowerCase()}%`]
          );
          const finalGameId = game?.id || 1;
          const internalSku = sku.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 60);

          try {
            await db.query(
              'INSERT IGNORE INTO packages (game_id, sku, name, digiflazz_sku, base_price, is_active, sort_order) VALUES (?,?,?,?,?,1,0)',
              [finalGameId, internalSku, name, sku, basePrice]
            );
            imported++;
          } catch (e) { skipped++; }
        } else { skipped++; }
      }
    }

    res.json({ success: true, imported, updated, skipped });
  } catch (err) {
    console.error('[Digiflazz sync error]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
