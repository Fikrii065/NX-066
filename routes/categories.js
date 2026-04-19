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

// ─── Pastikan kolom opsional ada di DB (auto-migrate ringan) ─────────────────
async function ensureCategoryColumns() {
  const optionalCols = [
    { name: 'information',      sql: 'ALTER TABLE categories ADD COLUMN information MEDIUMTEXT NULL AFTER description' },
    { name: 'check_id',         sql: 'ALTER TABLE categories ADD COLUMN check_id TINYINT(1) NOT NULL DEFAULT 0 AFTER has_zone_id' },
    { name: 'additional_data',  sql: 'ALTER TABLE categories ADD COLUMN additional_data TINYINT(1) NOT NULL DEFAULT 0 AFTER check_id' },
    { name: 'nickname_code',    sql: 'ALTER TABLE categories ADD COLUMN nickname_code VARCHAR(60) NULL AFTER additional_data' },
    { name: 'placeholder_uid',  sql: 'ALTER TABLE categories ADD COLUMN placeholder_uid VARCHAR(60) NULL AFTER nickname_code' },
    { name: 'placeholder_zid',  sql: 'ALTER TABLE categories ADD COLUMN placeholder_zid VARCHAR(60) NULL AFTER placeholder_uid' },
    { name: 'server_list',      sql: 'ALTER TABLE categories ADD COLUMN server_list TEXT NULL AFTER placeholder_zid' },
    { name: 'updated_at',       sql: 'ALTER TABLE categories ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at' },
  ];
  for (const col of optionalCols) {
    try { await db.query(col.sql); } catch(e) { /* already exists */ }
  }
}

// Jalankan saat module dimuat - non-blocking, error diabaikan
let _columnsEnsured = false;
function ensureOnce() {
  if (_columnsEnsured) return Promise.resolve();
  _columnsEnsured = true;
  return ensureCategoryColumns().catch(() => {});
}
ensureOnce();

// GET /api/categories
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

    // Coba SELECT lengkap dulu, fallback ke SELECT minimal jika kolom belum ada
    let rows;
    try {
      [rows] = await db.query(
        `SELECT id, name, slug,
                image_url, guide_image_url,
                description, information,
                has_zone_id,
                COALESCE(check_id, 0) AS check_id,
                COALESCE(additional_data, 0) AS additional_data,
                nickname_code, placeholder_uid, placeholder_zid, server_list,
                sort_order, is_active,
                created_at, updated_at
         FROM categories
         ${where}
         ORDER BY sort_order ASC, name ASC
         LIMIT ? OFFSET ?`,
        [...params, parseInt(limit), offset]
      );
    } catch(_) {
      // Fallback: kolom opsional belum ada
      [rows] = await db.query(
        `SELECT id, name, slug,
                image_url, guide_image_url,
                description, has_zone_id,
                sort_order, is_active, created_at
         FROM categories
         ${where}
         ORDER BY sort_order ASC, name ASC
         LIMIT ? OFFSET ?`,
        [...params, parseInt(limit), offset]
      );
    }

    const categories = rows.map(r => ({
      ...r,
      check_id:        r.check_id        || 0,
      additional_data: r.additional_data || 0,
      information:     r.information     || null,
      nickname_code:   r.nickname_code   || null,
      placeholder_uid: r.placeholder_uid || null,
      placeholder_zid: r.placeholder_zid || null,
      server_list:     r.server_list     || null,
      image_url:       r.image_url       ? `/api/categories/${r.id}/image`       : null,
      guide_image_url: r.guide_image_url ? `/api/categories/${r.id}/guide-image` : null,
    }));
    res.json({ success: true, categories, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('[GET /categories]', err);
    res.status(500).json({ success: false, message: 'Gagal memuat kategori: ' + err.message });
  }
});

// GET /api/categories/:id/image
router.get('/:id/image', async (req, res) => {
  try {
    const [[row]] = await db.query('SELECT image_url FROM categories WHERE id = ? LIMIT 1', [req.params.id]);
    if (!row || !row.image_url) return res.status(404).end();
    return serveImage(res, row.image_url);
  } catch (err) { res.status(500).end(); }
});

// GET /api/categories/:id/guide-image
router.get('/:id/guide-image', async (req, res) => {
  try {
    const [[row]] = await db.query('SELECT guide_image_url FROM categories WHERE id = ? LIMIT 1', [req.params.id]);
    if (!row || !row.guide_image_url) return res.status(404).end();
    return serveImage(res, row.guide_image_url);
  } catch (err) { res.status(500).end(); }
});

// POST /api/categories
router.post('/', auth, async (req, res) => {
  try {
    const { name, slug, image_url, guide_image_url, description, information, has_zone_id, sort_order, is_active } = req.body;

    if (!name || !name.trim())
      return res.status(400).json({ success: false, message: 'Nama kategori wajib diisi' });

    const finalSlug = makeSlug(slug || name);
    const [[dup]] = await db.query('SELECT id FROM categories WHERE slug = ?', [finalSlug]);
    if (dup) return res.status(409).json({ success: false, message: 'Slug sudah digunakan. Gunakan nama yang berbeda.' });

    const check_id_val    = req.body.check_id        ? 1 : 0;
    const additional_val  = req.body.additional_data ? 1 : 0;
    const nickname_val    = req.body.nickname_code   || null;
    const ph_uid_val      = req.body.placeholder_uid || null;
    const ph_zid_val      = req.body.placeholder_zid || null;
    const server_val      = req.body.server_list     || null;

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
        `INSERT INTO categories (name, slug, image_url, guide_image_url, description, has_zone_id, sort_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [name.trim(), finalSlug, image_url||null, guide_image_url||null, description||null,
         has_zone_id ? 1 : 0, sort_order !== undefined ? parseInt(sort_order) : 0, is_active !== false ? 1 : 0]
      );
    }

    const id = result.insertId;
    const [[created]] = await db.query(
      'SELECT id, name, slug, has_zone_id, sort_order, is_active, created_at FROM categories WHERE id = ?', [id]
    );
    res.status(201).json({ success: true, category: {
      ...created,
      image_url:       image_url       ? `/api/categories/${id}/image`       : null,
      guide_image_url: guide_image_url ? `/api/categories/${id}/guide-image` : null,
    }});
  } catch (err) {
    console.error('[POST /categories]', err);
    res.status(500).json({ success: false, message: 'Gagal menambah kategori: ' + err.message });
  }
});

// PUT /api/categories/:id
router.put('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const [[existing]] = await db.query('SELECT * FROM categories WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ success: false, message: 'Kategori tidak ditemukan' });

    const body = req.body;
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
    const sort_order      = body.sort_order       !== undefined ? parseInt(body.sort_order)        : (existing.sort_order || 0);
    const description     = body.description      !== undefined ? (body.description      || null)  : existing.description;
    const information     = body.information      !== undefined ? (body.information      || null)  : (existing.information || null);
    const nickname_code   = body.nickname_code    !== undefined ? (body.nickname_code    || null)  : (existing.nickname_code || null);
    const placeholder_uid = body.placeholder_uid  !== undefined ? (body.placeholder_uid  || null)  : (existing.placeholder_uid || null);
    const placeholder_zid = body.placeholder_zid  !== undefined ? (body.placeholder_zid  || null)  : (existing.placeholder_zid || null);
    const server_list     = body.server_list      !== undefined ? (body.server_list      || null)  : (existing.server_list || null);

    try {
      await db.query(
        `UPDATE categories SET name=?,slug=?,image_url=?,guide_image_url=?,
         description=?,information=?,has_zone_id=?,check_id=?,additional_data=?,
         nickname_code=?,placeholder_uid=?,placeholder_zid=?,server_list=?,
         is_active=?,sort_order=? WHERE id=?`,
        [name.trim(), finalSlug, finalImage, finalGuideImage, description, information,
         has_zone_id, check_id, additional_data, nickname_code, placeholder_uid, placeholder_zid,
         server_list, is_active, sort_order, id]
      );
    } catch(colErr) {
      // Fallback tanpa kolom opsional
      await db.query(
        `UPDATE categories SET name=?,slug=?,image_url=?,guide_image_url=?,
         description=?,has_zone_id=?,is_active=?,sort_order=? WHERE id=?`,
        [name.trim(), finalSlug, finalImage, finalGuideImage, description, has_zone_id, is_active, sort_order, id]
      );
    }

    const [[updated]] = await db.query(
      'SELECT id, name, slug, has_zone_id, is_active, sort_order, updated_at FROM categories WHERE id = ?', [id]
    );
    res.json({ success: true, category: {
      ...updated,
      image_url:       finalImage      ? `/api/categories/${id}/image`       : null,
      guide_image_url: finalGuideImage ? `/api/categories/${id}/guide-image` : null,
    }});
  } catch (err) {
    console.error('[PUT /categories/:id]', err);
    res.status(500).json({ success: false, message: 'Gagal memperbarui kategori: ' + err.message });
  }
});

// DELETE /api/categories/:id
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

// PATCH /api/categories/:id/toggle
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
