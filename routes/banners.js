const router = require('express').Router();
const db     = require('../lib/db');
const auth   = require('../middleware/auth');

// GET /api/banners — banner aktif (public)
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, title, image_url, link_url FROM banners WHERE is_active=1 ORDER BY sort_order ASC'
    );
    res.json({ success: true, banners: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memuat banner' });
  }
});

// GET /api/banners/all (admin)
router.get('/all', auth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM banners ORDER BY sort_order ASC');
    res.json({ success: true, banners: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memuat banner' });
  }
});

// POST /api/banners (admin)
router.post('/', auth, async (req, res) => {
  try {
    const { title, image_url, link_url, sort_order, is_active } = req.body;
    if (!title || !image_url) return res.status(400).json({ success: false, message: 'title dan image_url wajib diisi' });
    const [r] = await db.query(
      'INSERT INTO banners (title, image_url, link_url, sort_order, is_active) VALUES (?,?,?,?,?)',
      [title, image_url, link_url || null, sort_order || 0, is_active !== false ? 1 : 0]
    );
    res.json({ success: true, id: r.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal menambah banner' });
  }
});

// PUT /api/banners/:id (admin)
router.put('/:id', auth, async (req, res) => {
  try {
    const { title, image_url, link_url, sort_order, is_active } = req.body;
    await db.query(
      'UPDATE banners SET title=?, image_url=?, link_url=?, sort_order=?, is_active=? WHERE id=?',
      [title, image_url, link_url, sort_order, is_active ? 1 : 0, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal update banner' });
  }
});

// DELETE /api/banners/:id (admin)
router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM banners WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal menghapus banner' });
  }
});

module.exports = router;
