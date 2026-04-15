const router = require('express').Router();
const db     = require('../lib/db');
const auth   = require('../middleware/auth');

// GET /api/admin/categories — semua kategori (admin)
router.get('/', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, name, slug, description, icon, sort_order, is_active, created_at, updated_at FROM categories ORDER BY sort_order ASC, name ASC'
    );
    res.json({ success: true, categories: rows });
  } catch (err) {
    console.error('[GET /categories]', err);
    res.status(500).json({ success: false, message: 'Gagal memuat kategori' });
  }
});

// POST /api/admin/categories — tambah kategori baru
router.post('/', auth, async (req, res) => {
  try {
    const { name, slug, description, icon, sort_order, is_active } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Nama kategori wajib diisi' });
    }

    // Auto-generate slug dari name jika tidak dikirim
    const finalSlug = (slug || name)
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');

    // Cek duplikat slug
    const [[existing]] = await db.query(
      'SELECT id FROM categories WHERE slug = ?',
      [finalSlug]
    );
    if (existing) {
      return res.status(409).json({ success: false, message: 'Slug sudah digunakan. Gunakan nama yang berbeda.' });
    }

    const [result] = await db.query(
      'INSERT INTO categories (name, slug, description, icon, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?)',
      [
        name.trim(),
        finalSlug,
        description || null,
        icon || '📦',
        sort_order !== undefined ? parseInt(sort_order) : 0,
        is_active !== false ? 1 : 0,
      ]
    );

    const [[created]] = await db.query(
      'SELECT id, name, slug, description, icon, sort_order, is_active, created_at FROM categories WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json({ success: true, category: created });
  } catch (err) {
    console.error('[POST /categories]', err);
    res.status(500).json({ success: false, message: 'Gagal menambah kategori' });
  }
});

// PUT /api/admin/categories/:id — update kategori
router.put('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, slug, description, icon, sort_order, is_active } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Nama kategori wajib diisi' });
    }

    // Cek kategori ada
    const [[existing]] = await db.query('SELECT id FROM categories WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Kategori tidak ditemukan' });
    }

    // Auto-generate slug jika tidak dikirim
    const finalSlug = (slug || name)
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');

    // Cek slug tidak bentrok dengan kategori lain
    const [[slugConflict]] = await db.query(
      'SELECT id FROM categories WHERE slug = ? AND id != ?',
      [finalSlug, id]
    );
    if (slugConflict) {
      return res.status(409).json({ success: false, message: 'Slug sudah digunakan oleh kategori lain.' });
    }

    await db.query(
      'UPDATE categories SET name=?, slug=?, description=?, icon=?, sort_order=?, is_active=? WHERE id=?',
      [
        name.trim(),
        finalSlug,
        description || null,
        icon || '📦',
        sort_order !== undefined ? parseInt(sort_order) : 0,
        is_active ? 1 : 0,
        id,
      ]
    );

    const [[updated]] = await db.query(
      'SELECT id, name, slug, description, icon, sort_order, is_active, updated_at FROM categories WHERE id = ?',
      [id]
    );

    res.json({ success: true, category: updated });
  } catch (err) {
    console.error('[PUT /categories/:id]', err);
    res.status(500).json({ success: false, message: 'Gagal memperbarui kategori' });
  }
});

// DELETE /api/admin/categories/:id — hapus kategori
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    const [[existing]] = await db.query('SELECT id, name FROM categories WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Kategori tidak ditemukan' });
    }

    // Cek apakah kategori masih digunakan oleh game
    const [[usedByGame]] = await db.query(
      'SELECT id FROM games WHERE category_id = ? LIMIT 1',
      [id]
    );
    if (usedByGame) {
      return res.status(400).json({
        success: false,
        message: `Kategori "${existing.name}" masih digunakan oleh game. Pindahkan game terlebih dahulu sebelum menghapus.`,
      });
    }

    await db.query('DELETE FROM categories WHERE id = ?', [id]);
    res.json({ success: true, message: 'Kategori berhasil dihapus' });
  } catch (err) {
    console.error('[DELETE /categories/:id]', err);
    res.status(500).json({ success: false, message: 'Gagal menghapus kategori' });
  }
});

// PATCH /api/admin/categories/:id/toggle — aktifkan/nonaktifkan kategori
router.patch('/:id/toggle', auth, async (req, res) => {
  try {
    const { id } = req.params;

    const [[existing]] = await db.query(
      'SELECT id, is_active FROM categories WHERE id = ?',
      [id]
    );
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Kategori tidak ditemukan' });
    }

    const newStatus = existing.is_active ? 0 : 1;
    await db.query('UPDATE categories SET is_active = ? WHERE id = ?', [newStatus, id]);

    res.json({
      success: true,
      is_active: newStatus,
      message: newStatus ? 'Kategori diaktifkan' : 'Kategori dinonaktifkan',
    });
  } catch (err) {
    console.error('[PATCH /categories/:id/toggle]', err);
    res.status(500).json({ success: false, message: 'Gagal mengubah status kategori' });
  }
});

module.exports = router;
