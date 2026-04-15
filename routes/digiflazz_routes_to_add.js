// ─────────────────────────────────────────────────────────────────────────────
// TAMBAHKAN ROUTES INI KE routes/admin.js
// (tambah sebelum `module.exports = router;`)
// Membutuhkan: axios sudah di package.json, lib/digiflazz.js sudah ada
// ─────────────────────────────────────────────────────────────────────────────

const axios = require('axios');
const crypto = require('crypto');

// ── GET /api/admin/digiflazz/pricelist ──────────────────────────────────────
// Ambil price list dari Digiflazz dan kembalikan ke frontend
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
      return res.status(400).json({ success: false, message: 'Konfigurasi Digiflazz belum lengkap. Isi username dan API key di halaman Digiflazz Sync.' });
    }

    const sign = crypto.createHash('md5').update(username + apiKey + 'pricelist').digest('hex');
    const { data } = await axios.post('https://api.digiflazz.com/v1/price-list', {
      cmd:      'prepaid',
      username,
      sign,
    }, { timeout: 15000 });

    let products = data.data || [];

    // Filter kategori kalau ada query param
    const cat = req.query.category;
    if (cat) products = products.filter(p =>
      p.category?.toLowerCase().includes(cat.toLowerCase()) ||
      p.brand?.toLowerCase().includes(cat.toLowerCase())
    );

    // Deduplicate by buyer_sku_code
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
// Sync produk Digiflazz ke database packages
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

      // Cek apakah SKU sudah ada
      const [[existing]] = await db.query('SELECT id FROM packages WHERE digiflazz_sku = ?', [sku]);

      if (existing) {
        // Update harga jika action = update / full
        if (action === 'update' || action === 'full') {
          await db.query('UPDATE packages SET base_price = ?, name = ? WHERE digiflazz_sku = ?', [basePrice, name, sku]);
          updated++;
        } else {
          skipped++;
        }
      } else {
        // Import produk baru jika action = import / full
        if (action === 'import' || action === 'full') {
          // Coba cocokkan ke game berdasarkan kategori/brand
          const [[game]] = await db.query(
            'SELECT id FROM games WHERE LOWER(name) LIKE ? OR LOWER(code) LIKE ? LIMIT 1',
            [`%${category.toLowerCase()}%`, `%${category.toLowerCase()}%`]
          );

          const gameId = game?.id || null;
          if (!gameId && action !== 'full') { skipped++; continue; } // Skip kalau game tidak ditemukan

          // Gunakan game_id 1 (default) jika tidak ditemukan
          const finalGameId = gameId || 1;

          // Buat SKU internal unik
          const internalSku = sku.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 60);

          try {
            await db.query(
              'INSERT IGNORE INTO packages (game_id, sku, name, digiflazz_sku, base_price, is_active, sort_order) VALUES (?,?,?,?,?,1,0)',
              [finalGameId, internalSku, name, sku, basePrice]
            );
            imported++;
          } catch (e) {
            // Duplicate SKU — skip
            skipped++;
          }
        } else {
          skipped++;
        }
      }
    }

    res.json({ success: true, imported, updated, skipped });
  } catch (err) {
    console.error('[Digiflazz sync error]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
