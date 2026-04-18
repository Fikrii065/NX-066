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
    const { page = 1, limit = 50, search, is_active } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];
    let where = 'WHERE 1=1';

    if (search) {
      where += ' AND (name LIKE ? OR slug LIKE ?)';
      const q = `%${search}%`;
      params.push(q, q);
    }
    if (is_active !== undefined && is_active !== '') {
      where += ' AND is_active = ?';
      params.push(parseInt(is_active));
    }

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM categories ${where}`, params
    );

    const [rows] = await db.query(
      `SELECT id, name, slug,
              image_url, guide_image_url,
              description, information,
              has_zone_id, sort_order, is_active,
              created_at, updated_at
       FROM categories
       ${where}
       ORDER BY sort_order ASC, name ASC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    const categories = rows.map(r => ({
      ...r,
      image_url:       r.image_url       ? `/api/admin/categories/${r.id}/image`       : null,
      guide_image_url: r.guide_image_url ? `/api/admin/categories/${r.id}/guide-image` : null,
    }));
    res.json({ success: true, categories, total, page: parseInt(page), limit: parseInt(limit) });
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
    const { name, slug, image_url, guide_image_url, description, information, has_zone_id, sort_order, is_active } = req.body;

    if (!name || !name.trim())
      return res.status(400).json({ success: false, message: 'Nama kategori wajib diisi' });

    const finalSlug = makeSlug(slug || name);
    const [[dup]] = await db.query('SELECT id FROM categories WHERE slug = ?', [finalSlug]);
    if (dup) return res.status(409).json({ success: false, message: 'Slug sudah digunakan. Gunakan nama yang berbeda.' });

    const check_id_val    = req.body.check_id         ? 1 : 0;
    const additional_val  = req.body.additional_data  ? 1 : 0;
    const nickname_val    = req.body.nickname_code    || null;
    const ph_uid_val      = req.body.placeholder_uid  || null;
    const ph_zid_val      = req.body.placeholder_zid  || null;
    const server_val      = req.body.server_list      || null;

    let result;
    try {
      [result] = await db.query(
        `INSERT INTO categories (name, slug, image_url, guide_image_url, description, information, has_zone_id, check_id, additional_data, nickname_code, placeholder_uid, placeholder_zid, server_list, sort_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [name.trim(), finalSlug, image_url||null, guide_image_url||null, description||null, information||null,
         has_zone_id ? 1 : 0, check_id_val, additional_val, nickname_val, ph_uid_val, ph_zid_val, server_val,
         sort_order !== undefined ? parseInt(sort_order) : 0, is_active !== false ? 1 : 0]
      );
    } catch(colErr) {
      // Fallback tanpa kolom opsional
      [result] = await db.query(
        `INSERT INTO categories (name, slug, image_url, guide_image_url, description, information, has_zone_id, sort_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [name.trim(), finalSlug, image_url||null, guide_image_url||null, description||null, information||null,
         has_zone_id ? 1 : 0, sort_order !== undefined ? parseInt(sort_order) : 0, is_active !== false ? 1 : 0]
      );
    }

    const id = result.insertId;
    const [[created]] = await db.query(
      'SELECT id, name, slug, has_zone_id, sort_order, is_active, created_at FROM categories WHERE id = ?', [id]
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
    const [[existing]] = await db.query(
      'SELECT id, name, slug, image_url, guide_image_url, description, information, has_zone_id, check_id, additional_data, nickname_code, placeholder_uid, placeholder_zid, server_list, sort_order, is_active FROM categories WHERE id = ?',
      [id]
    );
    if (!existing) return res.status(404).json({ success: false, message: 'Kategori tidak ditemukan' });

    const body = req.body;

    // Jika hanya update is_active (toggle status), tidak perlu validasi name
    const isPartialUpdate = Object.keys(body).length === 1 && body.is_active !== undefined;

    const name = body.name !== undefined ? body.name : existing.name;
    if (!name || !name.trim())
      return res.status(400).json({ success: false, message: 'Nama kategori wajib diisi' });

    const finalSlug = makeSlug(body.slug || name);
    if (!isPartialUpdate) {
      const [[slugConflict]] = await db.query('SELECT id FROM categories WHERE slug = ? AND id != ?', [finalSlug, id]);
      if (slugConflict) return res.status(409).json({ success: false, message: 'Slug sudah digunakan oleh kategori lain.' });
    }

    const finalImage      = body.image_url       !== undefined ? (body.image_url       || null) : existing.image_url;
    const finalGuideImage = body.guide_image_url  !== undefined ? (body.guide_image_url  || null) : existing.guide_image_url;
    const is_active       = body.is_active        !== undefined ? (body.is_active        ? 1 : 0) : existing.is_active;
    const has_zone_id     = body.has_zone_id      !== undefined ? (body.has_zone_id      ? 1 : 0) : existing.has_zone_id;
    const check_id        = body.check_id         !== undefined ? (body.check_id         ? 1 : 0) : (existing.check_id || 0);
    const additional_data = body.additional_data  !== undefined ? (body.additional_data  ? 1 : 0) : (existing.additional_data || 0);
    const sort_order      = body.sort_order       !== undefined ? parseInt(body.sort_order)       : (existing.sort_order || 0);
    const description     = body.description      !== undefined ? (body.description      || null) : existing.description;
    const information     = body.information      !== undefined ? (body.information      || null) : existing.information;
    const nickname_code   = body.nickname_code    !== undefined ? (body.nickname_code    || null) : (existing.nickname_code || null);
    const placeholder_uid = body.placeholder_uid  !== undefined ? (body.placeholder_uid  || null) : (existing.placeholder_uid || null);
    const placeholder_zid = body.placeholder_zid  !== undefined ? (body.placeholder_zid  || null) : (existing.placeholder_zid || null);
    const server_list     = body.server_list      !== undefined ? (body.server_list      || null) : (existing.server_list || null);

    // Build dynamic UPDATE to avoid error if columns don't exist yet
    const setCols = [
      'name=?','slug=?','image_url=?','guide_image_url=?',
      'description=?','information=?','has_zone_id=?','is_active=?','sort_order=?'
    ];
    const setVals = [name.trim(), finalSlug, finalImage, finalGuideImage, description, information, has_zone_id, is_active, sort_order];

    // Optional columns — add only if they exist in DB (check_id etc. may be missing in older installs)
    try {
      await db.query(`UPDATE categories SET ${setCols.join(',')},check_id=?,additional_data=?,nickname_code=?,placeholder_uid=?,placeholder_zid=?,server_list=? WHERE id=?`,
        [...setVals, check_id, additional_data, nickname_code, placeholder_uid, placeholder_zid, server_list, id]);
    } catch(colErr) {
      // Fallback: update tanpa kolom opsional
      await db.query(`UPDATE categories SET ${setCols.join(',')} WHERE id=?`, [...setVals, id]);
    }

    const [[updated]] = await db.query(
      'SELECT id, name, slug, has_zone_id, is_active, sort_order, updated_at FROM categories WHERE id = ?', [id]
    );
    res.json({ success: true, category: {
      ...updated,
      image_url:       finalImage      ? `/api/admin/categories/${id}/image`       : null,
      guide_image_url: finalGuideImage ? `/api/admin/categories/${id}/guide-image` : null,
    }});
  } catch (err) {
    console.error('[PUT /categories/:id]', err);
    res.status(500).json({ success: false, message: 'Gagal memperbarui kategori: ' + err.message });
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
