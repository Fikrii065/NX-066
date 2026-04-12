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

module.exports = router;
