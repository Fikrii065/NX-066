const router = require('express').Router();
const db     = require('../lib/db');
const auth   = require('../middleware/auth');

function isBase64(str) {
  return str && str.startsWith('data:image');
}

// Auto-create tabel vouchers jika belum ada
async function ensureVouchersTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS vouchers (
        id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
        code       VARCHAR(60)  NOT NULL UNIQUE,
        name       VARCHAR(100) NOT NULL,
        icon       VARCHAR(10)  NOT NULL DEFAULT '🎟️',
        icon_url   MEDIUMTEXT   NULL,
        link_url   VARCHAR(255) NULL,
        category   VARCHAR(40)  NOT NULL DEFAULT 'platform',
        sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
        is_active  TINYINT(1)   NOT NULL DEFAULT 1,
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB
    `);
  } catch(e) { /* already exists */ }
}
ensureVouchersTable().catch(() => {});

// GET /api/vouchers — list voucher aktif (public)
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, code, name, icon, category, link_url, sort_order, ' +
      'CASE WHEN icon_url IS NOT NULL AND icon_url != "" THEN 1 ELSE 0 END AS has_icon ' +
      'FROM vouchers WHERE is_active = 1 ORDER BY sort_order ASC'
    );
    const vouchers = rows.map(r => ({
      id: r.id, code: r.code, name: r.name, icon: r.icon,
      category: r.category || 'platform',
      link_url: r.link_url || null,
      icon_url: r.has_icon ? `/api/vouchers/${r.code}/icon` : null,
    }));
    res.json({ success: true, vouchers });
  } catch (err) {
    console.error('[GET /vouchers]', err);
    res.status(500).json({ success: false, message: 'Gagal memuat daftar voucher' });
  }
});

// GET /api/vouchers/all — semua voucher (admin)
router.get('/all', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, code, name, icon, category, link_url, sort_order, is_active, created_at, ' +
      'CASE WHEN icon_url IS NOT NULL AND icon_url != "" THEN 1 ELSE 0 END AS has_icon ' +
      'FROM vouchers ORDER BY sort_order ASC'
    );
    const vouchers = rows.map(r => ({
      id: r.id, code: r.code, name: r.name, icon: r.icon,
      category: r.category || 'platform',
      link_url: r.link_url || null,
      sort_order: r.sort_order,
      is_active: r.is_active,
      created_at: r.created_at,
      icon_url: r.has_icon ? `/api/vouchers/${r.code}/icon` : null,
    }));
    res.json({ success: true, vouchers });
  } catch (err) {
    console.error('[GET /vouchers/all]', err);
    res.status(500).json({ success: false, message: 'Gagal memuat daftar voucher' });
  }
});

// GET /api/vouchers/:code/icon — serve icon sebagai image
router.get('/:code/icon', async (req, res) => {
  try {
    const [[row]] = await db.query(
      'SELECT icon_url FROM vouchers WHERE code = ? LIMIT 1',
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

// POST /api/vouchers — tambah voucher (admin)
router.post('/', auth, async (req, res) => {
  try {
    const { code, name, icon, icon_url, link_url, category, sort_order, is_active } = req.body;
    if (!code || !name) return res.status(400).json({ success: false, message: 'code dan name wajib diisi' });
    const [result] = await db.query(
      'INSERT INTO vouchers (code, name, icon, icon_url, link_url, category, sort_order, is_active) VALUES (?,?,?,?,?,?,?,?)',
      [
        code.trim(),
        name.trim(),
        icon || '🎟️',
        icon_url || null,
        link_url || ('/order?game=' + code.trim()),
        category || 'platform',
        parseInt(sort_order) || 0,
        is_active !== undefined ? (is_active ? 1 : 0) : 1
      ]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Kode voucher sudah digunakan' });
    console.error('[POST /vouchers]', err);
    res.status(500).json({ success: false, message: 'Gagal menambah voucher: ' + err.message });
  }
});

// PUT /api/vouchers/:id — update voucher (admin)
router.put('/:id', auth, async (req, res) => {
  try {
    const { name, icon, icon_url, link_url, category, sort_order, is_active } = req.body;
    // Ambil data existing untuk fallback link_url
    const [[existing]] = await db.query('SELECT code, icon_url FROM vouchers WHERE id=? LIMIT 1', [req.params.id]);
    if (!existing) return res.status(404).json({ success: false, message: 'Voucher tidak ditemukan' });

    const finalLink   = link_url || ('/order?game=' + existing.code);
    const finalIcon   = icon_url !== undefined ? (icon_url || null) : existing.icon_url;

    await db.query(
      'UPDATE vouchers SET name=?, icon=?, icon_url=?, link_url=?, category=?, sort_order=?, is_active=? WHERE id=?',
      [
        name,
        icon || '🎟️',
        finalIcon,
        finalLink,
        category || 'platform',
        parseInt(sort_order) || 0,
        is_active ? 1 : 0,
        req.params.id
      ]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[PUT /vouchers/:id]', err);
    res.status(500).json({ success: false, message: 'Gagal update voucher: ' + err.message });
  }
});

// DELETE /api/vouchers/:id (admin)
router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM vouchers WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /vouchers/:id]', err);
    res.status(500).json({ success: false, message: 'Gagal menghapus voucher' });
  }
});

module.exports = router;
