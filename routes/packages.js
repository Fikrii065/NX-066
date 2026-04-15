const router = require('express').Router();
const db     = require('../lib/db');
const auth   = require('../middleware/auth');

function calcSellPrice(base, markupPct, markupMin) {
  const pct = parseFloat(markupPct) / 100;
  const min = parseInt(markupMin);
  return base + Math.max(Math.round(base * pct), min);
}

// GET /api/packages/:gameCode — paket per game (public)
router.get('/:gameCode', async (req, res) => {
  try {
    const [settingsRows] = await db.query(
      "SELECT key_name, value FROM settings WHERE key_name IN ('markup_percent','markup_minimum')"
    );
    const markup    = Object.fromEntries(settingsRows.map(r => [r.key_name, r.value]));
    const pct       = parseFloat(markup.markup_percent) || 5;
    const min       = parseInt(markup.markup_minimum)   || 500;

    const [packages] = await db.query(
      `SELECT p.id, p.sku, p.name, p.base_price, p.is_hot, p.sort_order, p.icon_url
       FROM packages p
       JOIN games g ON p.game_id = g.id
       WHERE g.code = ? AND p.is_active = 1 AND g.is_active = 1
       ORDER BY p.sort_order ASC`,
      [req.params.gameCode]
    );

    const result = packages.map(p => ({
      id:         p.id,
      sku:        p.sku,
      name:       p.name,
      base_price: p.base_price,
      sell_price: calcSellPrice(p.base_price, pct, min),
      is_hot:     !!p.is_hot,
      icon_url:   p.icon_url || null,
    }));

    res.json({ success: true, packages: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Gagal memuat paket' });
  }
});

// GET /api/packages — semua paket (admin)
router.get('/', auth, async (req, res) => {
  try {
    const gameId = req.query.game_id;
    let sql = `SELECT p.*, g.name AS game_name, g.code AS game_code
               FROM packages p JOIN games g ON p.game_id = g.id`;
    const params = [];
    if (gameId) { sql += ' WHERE p.game_id = ?'; params.push(gameId); }
    sql += ' ORDER BY p.game_id ASC, p.sort_order ASC';

    const [rows] = await db.query(sql, params);
    res.json({ success: true, packages: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memuat paket' });
  }
});

// POST /api/packages — tambah paket (admin)
router.post('/', auth, async (req, res) => {
  try {
    const { game_id, sku, name, digiflazz_sku, base_price, is_hot, sort_order } = req.body;
    if (!game_id || !sku || !name || !base_price) {
      return res.status(400).json({ success: false, message: 'game_id, sku, name, base_price wajib diisi' });
    }

    const [r] = await db.query(
      'INSERT INTO packages (game_id, sku, name, digiflazz_sku, base_price, is_hot, sort_order) VALUES (?,?,?,?,?,?,?)',
      [game_id, sku, name, digiflazz_sku || sku, base_price, is_hot ? 1 : 0, sort_order || 0]
    );
    res.json({ success: true, id: r.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'SKU sudah digunakan' });
    res.status(500).json({ success: false, message: 'Gagal menambah paket' });
  }
});

// PUT /api/packages/:id — update paket (admin)
router.put('/:id', auth, async (req, res) => {
  try {
    const { name, digiflazz_sku, base_price, is_hot, is_active, sort_order } = req.body;
    await db.query(
      'UPDATE packages SET name=?, digiflazz_sku=?, base_price=?, is_hot=?, is_active=?, sort_order=? WHERE id=?',
      [name, digiflazz_sku, base_price, is_hot ? 1 : 0, is_active ? 1 : 0, sort_order, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal update paket' });
  }
});

// DELETE /api/packages/:id (admin)
router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('UPDATE packages SET is_active = 0 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal menghapus paket' });
  }
});

module.exports = router;
