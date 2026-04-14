// routes/package_icons.js
// Tambahkan route ini ke server.js:
//   const pkgIcons = require('./routes/package_icons');
//   app.use('/api/package-icons', pkgIcons);

const router = require('express').Router();
const db     = require('../lib/db');
const auth   = require('../middleware/auth');

function isBase64(str) {
  return str && str.startsWith('data:image');
}

// GET /api/package-icons/:gameCode — ambil semua package + icon untuk 1 game (admin)
router.get('/:gameCode', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.id, p.sku, p.name, p.base_price, p.is_hot, p.is_active, p.sort_order,
              CASE WHEN p.icon_url IS NOT NULL AND p.icon_url != '' THEN 1 ELSE 0 END AS has_icon
       FROM packages p
       JOIN games g ON p.game_id = g.id
       WHERE g.code = ?
       ORDER BY p.sort_order ASC`,
      [req.params.gameCode]
    );
    const result = rows.map(r => ({
      ...r,
      icon_url: r.has_icon ? `/api/package-icons/${req.params.gameCode}/${r.id}/img` : null
    }));
    res.json({ success: true, packages: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Gagal memuat paket' });
  }
});

// GET /api/package-icons/:gameCode/:id/img — serve icon sebagai image
router.get('/:gameCode/:id/img', async (req, res) => {
  try {
    const [[row]] = await db.query(
      'SELECT icon_url FROM packages WHERE id = ? LIMIT 1',
      [req.params.id]
    );
    if (!row || !row.icon_url) return res.status(404).end();
    if (isBase64(row.icon_url)) {
      const match = row.icon_url.match(/^data:(image\/[\w+]+);base64,(.+)$/s);
      if (!match) return res.status(400).end();
      const buf = Buffer.from(match[2], 'base64');
      res.set('Content-Type', match[1]);
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(buf);
    }
    res.redirect(row.icon_url);
  } catch (err) {
    res.status(500).end();
  }
});

// PUT /api/package-icons/bulk/update — update icon banyak package sekaligus
// PENTING: harus SEBELUM /:id agar Express tidak salah cocokkan 'bulk' sebagai :id
router.put('/bulk/update', auth, async (req, res) => {
  try {
    const { updates } = req.body; // [{id, icon_url}, ...]
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ success: false, message: 'updates harus berupa array' });
    }
    for (const u of updates) {
      await db.query('UPDATE packages SET icon_url = ? WHERE id = ?', [u.icon_url || null, u.id]);
    }
    res.json({ success: true, updated: updates.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Gagal bulk update icon' });
  }
});

// PUT /api/package-icons/:id — update icon satu package
router.put('/:id', auth, async (req, res) => {
  try {
    const { icon_url } = req.body;
    await db.query(
      'UPDATE packages SET icon_url = ? WHERE id = ?',
      [icon_url || null, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Gagal update icon' });
  }
});

// DELETE /api/package-icons/:id — hapus icon (reset ke default emoji)
router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('UPDATE packages SET icon_url = NULL WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal hapus icon' });
  }
});

module.exports = router;
