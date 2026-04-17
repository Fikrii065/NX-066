const router    = require('express').Router();
const db        = require('../lib/db');
const auth      = require('../middleware/auth');
const digiflazz = require('../lib/digiflazz');
const axios     = require('axios');
const crypto    = require('crypto');

// GET /api/admin/dashboard
router.get('/dashboard', auth, async (req, res) => {
  try {
    // FIX: Jalankan semua query DB secara paralel agar lebih cepat
    const [
      [todayRows],
      [yesterdayRows],
      [recentOrders],
      balance,
    ] = await Promise.all([
      db.query(`
        SELECT COUNT(*) AS total_orders,
          COALESCE(SUM(payment_status='paid'),0) AS paid_orders,
          COALESCE(SUM(topup_status='success'),0) AS success_orders,
          COALESCE(SUM(topup_status='failed'),0) AS failed_orders,
          COALESCE(SUM(CASE WHEN payment_status='paid' THEN total_amount ELSE 0 END),0) AS revenue
        FROM orders WHERE DATE(created_at)=CURDATE()`),
      db.query(`
        SELECT COALESCE(SUM(CASE WHEN payment_status='paid' THEN total_amount ELSE 0 END),0) AS revenue,
               COUNT(*) AS total_orders
        FROM orders WHERE DATE(created_at)=DATE_SUB(CURDATE(),INTERVAL 1 DAY)`),
      db.query(`
        SELECT o.order_id,o.created_at,o.total_amount,o.payment_status,o.topup_status,
               g.name AS game_name,g.icon AS game_icon,p.name AS package_name
        FROM orders o
        JOIN games g ON o.game_id=g.id
        JOIN packages p ON o.package_id=p.id
        ORDER BY o.created_at DESC LIMIT 10`),
      // FIX: timeout Digiflazz 2 detik agar tidak blokir dashboard
      Promise.race([
        digiflazz.getBalance().then(bal => bal?.deposit ?? null).catch(() => null),
        new Promise(resolve => setTimeout(() => resolve(null), 2000)),
      ]),
    ]);

    res.json({
      success: true,
      today: todayRows[0],
      yesterday: yesterdayRows[0],
      recent_orders: recentOrders,
      digiflazz_balance: balance,
    });
  } catch(err) {
    console.error('[dashboard route]', err.message);
    res.status(500).json({ success:false, message:'Gagal memuat dashboard' });
  }
});

// GET /api/admin/stats/daily
router.get('/stats/daily', auth, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT DATE(created_at) AS date, COUNT(*) AS total_orders,
             COALESCE(SUM(topup_status='success'),0) AS success_orders,
             COALESCE(SUM(CASE WHEN payment_status='paid' THEN total_amount ELSE 0 END),0) AS revenue
      FROM orders WHERE created_at>=DATE_SUB(NOW(),INTERVAL 30 DAY)
      GROUP BY DATE(created_at) ORDER BY date ASC`);
    res.json({ success:true, stats:rows });
  } catch(err) { res.status(500).json({ success:false, message:'Gagal memuat statistik' }); }
});

// GET /api/admin/check-nickname
router.get('/check-nickname', auth, async (req, res) => {
  const { game_code, user_id, zone_id } = req.query;
  if (!game_code || !user_id) return res.status(400).json({ success:false, message:'game_code dan user_id wajib diisi' });
  try {
    const result = await digiflazz.checkNickname(game_code, user_id, zone_id||'');
    res.json(result);
  } catch(err) { res.status(500).json({ success:false, message:err.message }); }
});

// GET /api/admin/digiflazz/balance
router.get('/digiflazz/balance', auth, async (req, res) => {
  try {
    const bal = await digiflazz.getBalance();
    res.json({ success:true, balance: bal?.deposit ?? 0 });
  } catch(err) { res.status(500).json({ success:false, message:err.message }); }
});

// GET /api/admin/digiflazz/pricelist
router.get('/digiflazz/pricelist', auth, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT key_name,value FROM settings WHERE key_name IN ('digiflazz_username','digiflazz_key_dev','digiflazz_key_prod','digiflazz_mode')");
    const cfg = Object.fromEntries(rows.map(r=>[r.key_name,r.value]));
    const username = cfg.digiflazz_username || process.env.DIGIFLAZZ_USERNAME;
    const mode     = cfg.digiflazz_mode || process.env.DIGIFLAZZ_MODE || 'development';
    const apiKey   = mode==='production'
      ? (cfg.digiflazz_key_prod||process.env.DIGIFLAZZ_API_KEY_PROD)
      : (cfg.digiflazz_key_dev||process.env.DIGIFLAZZ_API_KEY_DEV);
    if (!username||!apiKey) return res.status(400).json({ success:false, message:'Konfigurasi Digiflazz belum lengkap.' });
    const sign = crypto.createHash('md5').update(username+apiKey+'pricelist').digest('hex');
    const { data } = await axios.post('https://api.digiflazz.com/v1/price-list',{ cmd:'prepaid',username,sign },{ timeout:60000 });
    let products = Array.isArray(data.data) ? data.data : [];
    if (!Array.isArray(data.data)) {
      // Digiflazz returned error object (e.g. rate limit rc:83)
      const errMsg = data.data?.message || data.message || 'Response Digiflazz tidak valid';
      const rc = data.data?.rc || data.rc || '';
      let friendlyMsg = errMsg;
      if (rc === '83' || errMsg.toLowerCase().includes('limitasi')) {
        friendlyMsg = '⏳ Rate limit Digiflazz: terlalu sering request. Tunggu beberapa menit lalu coba lagi.';
      }
      return res.status(429).json({ success:false, message: friendlyMsg });
    }
    const cat = req.query.category;
    if (cat) products = products.filter(p=>p.category?.toLowerCase().includes(cat.toLowerCase())||p.brand?.toLowerCase().includes(cat.toLowerCase()));
    const seen=new Set();
    products = products.filter(p=>{ if(seen.has(p.buyer_sku_code))return false; seen.add(p.buyer_sku_code); return true; });
    res.json({ success:true, products, total:products.length });
  } catch(err) {
    console.error('[Digiflazz pricelist]',err.message);
    res.status(500).json({ success:false, message:err.response?.data?.message||err.message });
  }
});

// POST /api/admin/digiflazz/sync
router.post('/digiflazz/sync', auth, async (req, res) => {
  try {
    const { products=[], action='update' } = req.body;
    if (!products.length) return res.json({ success:true, imported:0, updated:0, skipped:0 });
    let imported=0, updated=0, skipped=0;
    for (const p of products) {
      const sku=p.buyer_sku_code, name=p.product_name, basePrice=parseInt(p.price)||0;
      const category=p.category||p.brand||'Lainnya';
      if (!sku||!name||!basePrice){ skipped++; continue; }
      const [[existing]] = await db.query('SELECT id FROM packages WHERE digiflazz_sku=?',[sku]);
      if (existing) {
        if (action==='update'||action==='full'){ await db.query('UPDATE packages SET base_price=?,name=? WHERE digiflazz_sku=?',[basePrice,name,sku]); updated++; }
        else skipped++;
      } else {
        if (action==='import'||action==='full'){
          const [[game]] = await db.query('SELECT id FROM games WHERE LOWER(name) LIKE ? OR LOWER(code) LIKE ? LIMIT 1',[`%${category.toLowerCase()}%`,`%${category.toLowerCase()}%`]);
          const finalGameId=game?.id||1;
          const internalSku=sku.toLowerCase().replace(/[^a-z0-9]/g,'-').slice(0,60);
          try { await db.query('INSERT IGNORE INTO packages (game_id,sku,name,digiflazz_sku,base_price,is_active,sort_order) VALUES(?,?,?,?,?,1,0)',[finalGameId,internalSku,name,sku,basePrice]); imported++; }
          catch(_){ skipped++; }
        } else skipped++;
      }
    }
    res.json({ success:true, imported, updated, skipped });
  } catch(err) { res.status(500).json({ success:false, message:err.message }); }
});

// POST /api/admin/sync-products — Quick sync: ambil pricelist Digiflazz, cocokkan ke game, update harga
router.post('/sync-products', auth, async (req, res) => {
  try {
    // Ambil kredensial dari DB
    const [cfgRows] = await db.query(
      "SELECT key_name, value FROM settings WHERE key_name IN ('digiflazz_username','digiflazz_key_dev','digiflazz_key_prod','digiflazz_mode')"
    );
    const cfg      = Object.fromEntries(cfgRows.map(r => [r.key_name, r.value]));
    const username = cfg.digiflazz_username || process.env.DIGIFLAZZ_USERNAME;
    const mode     = cfg.digiflazz_mode || process.env.DIGIFLAZZ_MODE || 'development';
    const apiKey   = mode === 'production'
      ? (cfg.digiflazz_key_prod || process.env.DIGIFLAZZ_API_KEY_PROD)
      : (cfg.digiflazz_key_dev  || process.env.DIGIFLAZZ_API_KEY_DEV);

    if (!username || !apiKey) {
      return res.status(400).json({ success: false, message: 'Kredensial Digiflazz belum dikonfigurasi' });
    }

    // Ambil pricelist dari Digiflazz
    const sign = require('crypto').createHash('md5').update(username + apiKey + 'pricelist').digest('hex');
    const { data: plData } = await axios.post('https://api.digiflazz.com/v1/price-list',
      { cmd: 'prepaid', username, sign }, { timeout: 60000 }
    );
    const allProducts = plData.data || [];
    if (!allProducts.length) return res.json({ success: true, message: 'Tidak ada produk dari Digiflazz', inserted: 0, updated: 0, skipped: 0 });

    // Ambil semua game aktif dari DB
    const [games] = await db.query('SELECT id, code, name FROM games WHERE is_active = 1');

    let inserted = 0, updated = 0, skipped = 0;

    for (const p of allProducts) {
      const sku       = p.buyer_sku_code;
      const name      = p.product_name;
      const basePrice = parseInt(p.price) || 0;
      const brand     = (p.brand || p.category || '').toLowerCase();

      if (!sku || !name || !basePrice) { skipped++; continue; }

      // Cocokkan ke game berdasarkan brand/category
      const matchedGame = games.find(g =>
        brand.includes(g.name.toLowerCase()) ||
        brand.includes(g.code.toLowerCase()) ||
        g.name.toLowerCase().includes(brand) ||
        g.code.toLowerCase().includes(brand)
      );

      if (!matchedGame) { skipped++; continue; }

      // Cek existing package
      const [[existing]] = await db.query('SELECT id FROM packages WHERE digiflazz_sku = ?', [sku]);

      if (existing) {
        await db.query('UPDATE packages SET base_price = ?, name = ? WHERE digiflazz_sku = ?', [basePrice, name, sku]);
        updated++;
      } else {
        const internalSku = sku.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 60);
        try {
          await db.query(
            'INSERT IGNORE INTO packages (game_id, sku, name, digiflazz_sku, base_price, is_active, sort_order) VALUES (?,?,?,?,?,1,0)',
            [matchedGame.id, internalSku, name, sku, basePrice]
          );
          inserted++;
        } catch(_) { skipped++; }
      }
    }

    // Ambil semua produk dari DB untuk langsung ditampilkan (tidak perlu request kedua ke Digiflazz)
    const seen = new Set();
    const uniqueProducts = (Array.isArray(allProducts) ? allProducts : []).filter(p => {
      if (seen.has(p.buyer_sku_code)) return false;
      seen.add(p.buyer_sku_code);
      return true;
    });

    res.json({
      success: true,
      message: `Sync selesai! ${inserted} produk baru, ${updated} diperbarui, ${skipped} dilewati.`,
      inserted, updated, skipped,
      products: uniqueProducts,
      total: uniqueProducts.length
    });
  } catch (err) {
    console.error('[sync-products]', err.message);
    res.status(500).json({ success: false, message: err.response?.data?.message || err.message });
  }
});

module.exports = router;
