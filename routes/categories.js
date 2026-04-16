const router = require('express').Router();
const db     = require('../lib/db');
const auth   = require('../middleware/auth');

// ─── Helper ───────────────────────────────────────────────────────────────────
function makeSlug(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function serveImage(res, value) {
  if (value.startsWith('data:image')) {
    const match = value.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) return res.status(400).end();
    const buf = Buffer.from(match[2], 'base64');
    res.set('Content-Type', match[1]);
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(buf);
  }
  res.redirect(value);
}

// GET /api/admin/categories
router.get('/', auth, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, name, slug, type,
             image_url, guide_image_url,
             description, information,
             has_zone_id, check_id, additional_data,
             sort_order, is_active,
             created_at, updated_at
      FROM categories
      ORDER BY sort_order ASC, name ASC
    `);
    const categories = rows.map(r => ({
      ...r,
      image_url:       r.image_url       ? `/api/admin/categories/${r.id}/image`       : null,
      guide_image_url: r.guide_image_url ? `/api/admin/categories/${r.id}/guide-image` : null,
    }));
    res.json({ success: true, categories });
  } catch (err) {
    console.error('[GET /categories]', err);
    res.status(500).json({ success: false, message: 'Gagal memuat kategori' });
  }
});

// GET /api/admin/categories/:id/image
router.get('/:id/image', async (req, res) => {
  try {
    const [[row]] = await db.query('SELECT image_url FROM categories WHERE id = ? LIMIT 1', [req.params.id]);
    if (!row || !row.image_url) return res.status(404).end();
    return serveImage(res, row.image_url);
  } catch (err) { res.status(500).end(); }
});

// GET /api/admin/categories/:id/guide-image
router.get('/:id/guide-image', async (req, res) => {
  try {
    const [[row]] = await db.query('SELECT guide_image_url FROM categories WHERE id = ? LIMIT 1', [req.params.id]);
    if (!row || !row.guide_image_url) return res.status(404).end();
    return serveImage(res, row.guide_image_url);
  } catch (err) { res.status(500).end(); }
});

// POST /api/admin/categories
router.post('/', auth, async (req, res) => {
  try {
    const { name, slug, type, image_url, guide_image_url, description, information, has_zone_id, check_id, additional_data, sort_order, is_active } = req.body;

    if (!name || !name.trim())
      return res.status(400).json({ success: false, message: 'Nama kategori wajib diisi' });

    const finalSlug = makeSlug(slug || name);
    const [[dup]] = await db.query('SELECT id FROM categories WHERE slug = ?', [finalSlug]);
    if (dup) return res.status(409).json({ success: false, message: 'Slug sudah digunakan. Gunakan nama yang berbeda.' });

    const [result] = await db.query(
      `INSERT INTO categories (name, slug, type, image_url, guide_image_url, description, information, has_zone_id, check_id, additional_data, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name.trim(), finalSlug, type||null, image_url||null, guide_image_url||null, description||null, information||null,
       has_zone_id ? 1 : 0, check_id ? 1 : 0, additional_data ? 1 : 0,
       sort_order !== undefined ? parseInt(sort_order) : 0, is_active !== false ? 1 : 0]
    );

    const id = result.insertId;
    const [[created]] = await db.query(
      'SELECT id, name, slug, type, has_zone_id, check_id, additional_data, sort_order, is_active, created_at FROM categories WHERE id = ?', [id]
    );
    res.status(201).json({ success: true, category: {
      ...created,
      image_url:       image_url       ? `/api/admin/categories/${id}/image`       : null,
      guide_image_url: guide_image_url ? `/api/admin/categories/${id}/guide-image` : null,
    }});
  } catch (err) {
    console.error('[POST /categories]', err);
    res.status(500).json({ success: false, message: 'Gagal menambah kategori' });
  }
});

// PUT /api/admin/categories/:id
router.put('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, slug, type, image_url, guide_image_url, description, information, has_zone_id, check_id, additional_data, sort_order, is_active } = req.body;

    if (!name || !name.trim())
      return res.status(400).json({ success: false, message: 'Nama kategori wajib diisi' });

    const [[existing]] = await db.query('SELECT id, image_url, guide_image_url FROM categories WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ success: false, message: 'Kategori tidak ditemukan' });

    const finalSlug = makeSlug(slug || name);
    const [[slugConflict]] = await db.query('SELECT id FROM categories WHERE slug = ? AND id != ?', [finalSlug, id]);
    if (slugConflict) return res.status(409).json({ success: false, message: 'Slug sudah digunakan oleh kategori lain.' });

    // Pertahankan gambar lama jika tidak dikirim ulang
    const finalImage      = image_url       !== undefined ? (image_url       || null) : existing.image_url;
    const finalGuideImage = guide_image_url !== undefined ? (guide_image_url || null) : existing.guide_image_url;

    await db.query(
      `UPDATE categories SET name=?, slug=?, type=?, image_url=?, guide_image_url=?,
       description=?, information=?, has_zone_id=?, check_id=?, additional_data=?, sort_order=?, is_active=? WHERE id=?`,
      [name.trim(), finalSlug, type||null, finalImage, finalGuideImage, description||null, information||null,
       has_zone_id ? 1 : 0, check_id ? 1 : 0, additional_data ? 1 : 0,
       sort_order !== undefined ? parseInt(sort_order) : 0, is_active ? 1 : 0, id]
    );

    const [[updated]] = await db.query(
      'SELECT id, name, slug, type, has_zone_id, check_id, additional_data, sort_order, is_active, updated_at FROM categories WHERE id = ?', [id]
    );
    res.json({ success: true, category: {
      ...updated,
      image_url:       finalImage      ? `/api/admin/categories/${id}/image`       : null,
      guide_image_url: finalGuideImage ? `/api/admin/categories/${id}/guide-image` : null,
    }});
  } catch (err) {
    console.error('[PUT /categories/:id]', err);
    res.status(500).json({ success: false, message: 'Gagal memperbarui kategori' });
  }
});

// DELETE /api/admin/categories/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const [[existing]] = await db.query('SELECT id, name FROM categories WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ success: false, message: 'Kategori tidak ditemukan' });

    const [[usedByGame]] = await db.query('SELECT id FROM games WHERE category_id = ? LIMIT 1', [id]);
    if (usedByGame) return res.status(400).json({
      success: false,
      message: `Kategori "${existing.name}" masih digunakan oleh game. Pindahkan game terlebih dahulu sebelum menghapus.`,
    });

    await db.query('DELETE FROM categories WHERE id = ?', [id]);
    res.json({ success: true, message: 'Kategori berhasil dihapus' });
  } catch (err) {
    console.error('[DELETE /categories/:id]', err);
    res.status(500).json({ success: false, message: 'Gagal menghapus kategori' });
  }
});

// PATCH /api/admin/categories/:id/toggle
router.patch('/:id/toggle', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const [[existing]] = await db.query('SELECT id, is_active FROM categories WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ success: false, message: 'Kategori tidak ditemukan' });

    const newStatus = existing.is_active ? 0 : 1;
    await db.query('UPDATE categories SET is_active = ? WHERE id = ?', [newStatus, id]);
    res.json({ success: true, is_active: newStatus, message: newStatus ? 'Kategori diaktifkan' : 'Kategori dinonaktifkan' });
  } catch (err) {
    console.error('[PATCH /categories/:id/toggle]', err);
    res.status(500).json({ success: false, message: 'Gagal mengubah status kategori' });
  }
});

module.exports = router;
