const router = require('express').Router();
const db     = require('../lib/db');
const auth   = require('../middleware/auth');

function isBase64(str) {
  return str && str.startsWith('data:image');
}

// GET /api/games — list game aktif (public) — base64 TIDAK dikirim
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, code, name, icon, params, zone_label, ' +
      'CASE WHEN icon_url IS NOT NULL AND icon_url != "" THEN 1 ELSE 0 END AS has_icon, ' +
      'CASE WHEN banner_url IS NOT NULL AND banner_url != "" THEN 1 ELSE 0 END AS has_banner ' +
      'FROM games WHERE is_active = 1 ORDER BY sort_order ASC'
    );
    const games = rows.map(r => ({
      id: r.id, code: r.code, name: r.name, icon: r.icon,
      params: r.params, zone_label: r.zone_label,
      icon_url:   r.has_icon   ? `/api/games/${r.code}/icon`   : null,
      banner_url: r.has_banner ? `/api/games/${r.code}/banner` : null,
    }));
    res.json({ success: true, games });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Gagal memuat daftar game' });
  }
});

// GET /api/games/all — semua game (admin) — HARUS sebelum /:code
router.get('/all', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, code, name, icon, params, zone_label, vip_code, sort_order, is_active, created_at, ' +
      'CASE WHEN icon_url IS NOT NULL AND icon_url != "" THEN 1 ELSE 0 END AS has_icon, ' +
      'CASE WHEN banner_url IS NOT NULL AND banner_url != "" THEN 1 ELSE 0 END AS has_banner ' +
      'FROM games ORDER BY sort_order ASC'
    );
    const games = rows.map(r => ({
      id: r.id, code: r.code, name: r.name, icon: r.icon,
      params: r.params, zone_label: r.zone_label, vip_code: r.vip_code,
      sort_order: r.sort_order, is_active: r.is_active, created_at: r.created_at,
      icon_url:   r.has_icon   ? `/api/games/${r.code}/icon`   : null,
      banner_url: r.has_banner ? `/api/games/${r.code}/banner` : null,
    }));
    res.json({ success: true, games });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memuat daftar game' });
  }
});

// GET /api/games/:code/icon — serve icon sebagai image
router.get('/:code/icon', async (req, res) => {
  try {
    const [[row]] = await db.query(
      'SELECT icon_url FROM games WHERE code = ? LIMIT 1',
      [req.params.code]
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

// GET /api/games/:code/banner — serve banner sebagai image
router.get('/:code/banner', async (req, res) => {
  try {
    const [[row]] = await db.query(
      'SELECT banner_url FROM games WHERE code = ? LIMIT 1',
      [req.params.code]
    );
    if (!row || !row.banner_url) return res.status(404).end();
    if (isBase64(row.banner_url)) {
      const match = row.banner_url.match(/^data:(image\/[\w+]+);base64,(.+)$/s);
      if (!match) return res.status(400).end();
      const buf = Buffer.from(match[2], 'base64');
      res.set('Content-Type', match[1]);
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(buf);
    }
    res.redirect(row.banner_url);
  } catch (err) {
    res.status(500).end();
  }
});

// POST /api/games — tambah game (admin)
router.post('/', auth, async (req, res) => {
  try {
    const { code, name, icon, icon_url, banner_url, params, zone_label, vip_code, sort_order } = req.body;
    if (!code || !name) return res.status(400).json({ success: false, message: 'code dan name wajib diisi' });
    const [result] = await db.query(
      'INSERT INTO games (code, name, icon, icon_url, banner_url, params, zone_label, vip_code, sort_order) VALUES (?,?,?,?,?,?,?,?,?)',
      [code, name, icon || '🎮', icon_url || null, banner_url || null, params || 'userId', zone_label || null, vip_code || code, sort_order || 0]
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
    const { name, icon, icon_url, banner_url, params, zone_label, vip_code, sort_order, is_active } = req.body;
    await db.query(
      'UPDATE games SET name=?, icon=?, icon_url=?, banner_url=?, params=?, zone_label=?, vip_code=?, sort_order=?, is_active=? WHERE id=?',
      [name, icon, icon_url || null, banner_url || null, params, zone_label, vip_code, sort_order, is_active ? 1 : 0, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Gagal update game' });
  }
});

// DELETE /api/games/:id (admin)
router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM games WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal menghapus game' });
  }
});

module.exports = router;
