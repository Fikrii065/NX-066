const router = require('express').Router();
const db     = require('../lib/db');
const auth   = require('../middleware/auth');

function isBase64(str) {
  return str && str.startsWith('data:image');
}

// GET /api/banners — banner aktif (public) — strip base64, pakai endpoint /image
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, title, link_url FROM banners WHERE is_active=1 ORDER BY sort_order ASC'
    );
    const banners = rows.map(r => ({
      ...r,
      image_url: `/api/banners/${r.id}/image`,
    }));
    res.json({ success: true, banners });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memuat banner' });
  }
});

// GET /api/banners/:id/image — serve banner image
router.get('/:id/image', async (req, res) => {
  try {
    const [[row]] = await db.query(
      'SELECT image_url FROM banners WHERE id = ? AND is_active = 1 LIMIT 1',
      [req.params.id]
    );
    if (!row || !row.image_url) return res.status(404).end();
    if (isBase64(row.image_url)) {
      const match = row.image_url.match(/^data:(image\/\w+);base64,(.+)$/);
      if (!match) return res.status(400).end();
      const buf = Buffer.from(match[2], 'base64');
      res.set('Content-Type', match[1]);
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(buf);
    }
    res.redirect(row.image_url);
  } catch (err) {
    res.status(500).end();
  }
});

// GET /api/banners/all (admin)
router.get('/all', auth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id, title, link_url, sort_order, is_active, created_at FROM banners ORDER BY sort_order ASC');
    const banners = rows.map(r => ({
      ...r,
      image_url: `/api/banners/${r.id}/image`,
    }));
    res.json({ success: true, banners });
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
    if (image_url !== undefined) {
      await db.query(
        'UPDATE banners SET title=?, image_url=?, link_url=?, sort_order=?, is_active=? WHERE id=?',
        [title, image_url, link_url, sort_order, is_active ? 1 : 0, req.params.id]
      );
    } else {
      await db.query(
        'UPDATE banners SET title=?, link_url=?, sort_order=?, is_active=? WHERE id=?',
        [title, link_url, sort_order, is_active ? 1 : 0, req.params.id]
      );
    }
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
