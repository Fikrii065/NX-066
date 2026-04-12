const router = require('express').Router();
const db     = require('../lib/db');
const auth   = require('../middleware/auth');

// GET /api/games — list game aktif (public)
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, code, name, icon, params, zone_label FROM games WHERE is_active = 1 ORDER BY sort_order ASC'
    );
    res.json({ success: true, games: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memuat daftar game' });
  }
});

// GET /api/games/all — semua game termasuk nonaktif (admin)
router.get('/all', auth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM games ORDER BY sort_order ASC');
    res.json({ success: true, games: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memuat daftar game' });
  }
});

// POST /api/games — tambah game (admin)
router.post('/', auth, async (req, res) => {
  try {
    const { code, name, icon, params, zone_label, vip_code, sort_order } = req.body;
    if (!code || !name) return res.status(400).json({ success: false, message: 'code dan name wajib diisi' });

    const [result] = await db.query(
      'INSERT INTO games (code, name, icon, params, zone_label, vip_code, sort_order) VALUES (?,?,?,?,?,?,?)',
      [code, name, icon || '🎮', params || 'userId', zone_label || null, vip_code || code, sort_order || 0]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Kode game sudah digunakan' });
    res.status(500).json({ success: false, message: 'Gagal menambah game' });
  }
});

// PUT /api/games/:id — update game (admin)
router.put('/:id', auth, async (req, res) => {
  try {
    const { name, icon, params, zone_label, vip_code, sort_order, is_active } = req.body;
    await db.query(
      'UPDATE games SET name=?, icon=?, params=?, zone_label=?, vip_code=?, sort_order=?, is_active=? WHERE id=?',
      [name, icon, params, zone_label, vip_code, sort_order, is_active ? 1 : 0, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal update game' });
  }
});

// DELETE /api/games/:id (admin)
router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('UPDATE games SET is_active = 0 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal menghapus game' });
  }
});

module.exports = router;
