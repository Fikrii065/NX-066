const router = require('express').Router();
const db     = require('../lib/db');
const auth   = require('../middleware/auth');

function sanitize(v) {
  return (v === undefined || v === '') ? null : v;
}

// Auto-create tabel + kolom baru jika belum ada
async function ensureTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS discount_vouchers (
        id             INT UNSIGNED    NOT NULL AUTO_INCREMENT,
        code           VARCHAR(50)     NOT NULL UNIQUE,
        name           VARCHAR(100)    NOT NULL,
        description    TEXT            NULL,
        discount_type  ENUM('percent','fixed') NOT NULL DEFAULT 'percent',
        discount_value DECIMAL(12,2)   NOT NULL DEFAULT 0,
        min_purchase   DECIMAL(12,2)   NOT NULL DEFAULT 0,
        max_discount   DECIMAL(12,2)   NULL,
        quota          INT UNSIGNED    NULL,
        used_count     INT UNSIGNED    NOT NULL DEFAULT 0,
        valid_from     DATETIME        NULL,
        valid_until    DATETIME        NULL,
        is_active      TINYINT(1)      NOT NULL DEFAULT 1,
        created_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_code (code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  } catch(e) {}
}
ensureTable().catch(() => {});

// ─── HELPER: hitung diskon ───────────────────────────────────────────────────
function calcDiscount(v, purchaseAmount) {
  let amount = 0;
  if (v.discount_type === 'percent') {
    amount = (purchaseAmount * parseFloat(v.discount_value)) / 100;
    if (v.max_discount && amount > parseFloat(v.max_discount)) amount = parseFloat(v.max_discount);
  } else {
    amount = parseFloat(v.discount_value);
  }
  return Math.round(Math.min(amount, purchaseAmount));
}

// ─── PUBLIC: Validasi kode voucher ──────────────────────────────────────────
// POST /api/discount-vouchers/validate
router.post('/validate', async (req, res) => {
  const { code, amount } = req.body;
  if (!code) return res.status(400).json({ success: false, message: 'Kode voucher wajib diisi' });

  try {
    const [[v]] = await db.query(
      `SELECT * FROM discount_vouchers WHERE code = ? AND is_active = 1 LIMIT 1`,
      [code.trim().toUpperCase()]
    );

    if (!v) return res.status(404).json({ success: false, message: 'Kode promo tidak ditemukan atau tidak aktif' });

    const now = new Date();
    if (v.valid_from && new Date(v.valid_from) > now)
      return res.status(400).json({ success: false, message: 'Promo belum berlaku' });
    if (v.valid_until && new Date(v.valid_until) < now)
      return res.status(400).json({ success: false, message: 'Promo sudah kadaluarsa' });
    if (v.quota !== null && v.used_count >= v.quota)
      return res.status(400).json({ success: false, message: 'Kuota promo sudah habis' });

    const purchaseAmount = parseFloat(amount) || 0;
    if (v.min_purchase > 0 && purchaseAmount < parseFloat(v.min_purchase))
      return res.status(400).json({
        success: false,
        message: `Minimum pembelian Rp ${Math.round(v.min_purchase).toLocaleString('id-ID')} untuk promo ini`
      });

    const discountAmount = calcDiscount(v, purchaseAmount);

    res.json({
      success: true,
      voucher: {
        id: v.id, code: v.code, name: v.name,
        description: v.description,
        discount_type: v.discount_type,
        discount_value: v.discount_value,
        max_discount: v.max_discount
      },
      discount_amount: discountAmount,
      final_amount: Math.round(purchaseAmount - discountAmount)
    });
  } catch (err) {
    console.error('[validate voucher]', err.message);
    res.status(500).json({ success: false, message: 'Gagal memvalidasi promo' });
  }
});

// ─── ADMIN: GET /api/discount-vouchers ──────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT *, (quota IS NULL OR used_count < quota) AS still_available
       FROM discount_vouchers ORDER BY created_at DESC`
    );
    res.json({ success: true, vouchers: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memuat voucher diskon' });
  }
});

// ─── ADMIN: GET /api/discount-vouchers/stats ────────────────────────────────
router.get('/stats', auth, async (req, res) => {
  try {
    const [[stats]] = await db.query(`
      SELECT
        COUNT(*) AS total,
        SUM(is_active = 1) AS active,
        SUM(is_active = 0) AS inactive,
        COALESCE(SUM(used_count), 0) AS total_used,
        SUM(valid_until IS NOT NULL AND valid_until < NOW() AND is_active = 1) AS expired
      FROM discount_vouchers
    `);
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memuat statistik' });
  }
});

// ─── ADMIN: POST /api/discount-vouchers ─────────────────────────────────────
router.post('/', auth, async (req, res) => {
  const { code, name, description, discount_type, discount_value,
          min_purchase, max_discount, quota, valid_from, valid_until, is_active } = req.body;

  if (!code || !name || !discount_type || discount_value == null)
    return res.status(400).json({ success: false, message: 'code, name, discount_type, discount_value wajib diisi' });

  try {
    const [result] = await db.query(
      `INSERT INTO discount_vouchers
        (code, name, description, discount_type, discount_value, min_purchase, max_discount, quota, valid_from, valid_until, is_active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        code.trim().toUpperCase(), name.trim(),
        sanitize(description), discount_type, parseFloat(discount_value),
        parseFloat(min_purchase) || 0,
        sanitize(max_discount) != null ? parseFloat(max_discount) : null,
        sanitize(quota) != null ? parseInt(quota) : null,
        sanitize(valid_from), sanitize(valid_until),
        is_active ? 1 : 0
      ]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ success: false, message: 'Kode voucher sudah digunakan' });
    res.status(500).json({ success: false, message: 'Gagal menambah voucher diskon' });
  }
});

// ─── ADMIN: PUT /api/discount-vouchers/:id ──────────────────────────────────
router.put('/:id', auth, async (req, res) => {
  const { name, description, discount_type, discount_value,
          min_purchase, max_discount, quota, valid_from, valid_until, is_active } = req.body;
  try {
    await db.query(
      `UPDATE discount_vouchers SET name=?, description=?, discount_type=?, discount_value=?,
       min_purchase=?, max_discount=?, quota=?, valid_from=?, valid_until=?, is_active=? WHERE id=?`,
      [
        name.trim(), sanitize(description), discount_type, parseFloat(discount_value),
        parseFloat(min_purchase) || 0,
        sanitize(max_discount) != null ? parseFloat(max_discount) : null,
        sanitize(quota) != null ? parseInt(quota) : null,
        sanitize(valid_from), sanitize(valid_until),
        is_active ? 1 : 0, req.params.id
      ]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal update voucher diskon' });
  }
});

// ─── ADMIN: PATCH /api/discount-vouchers/:id/toggle ─────────────────────────
router.patch('/:id/toggle', auth, async (req, res) => {
  try {
    await db.query(`UPDATE discount_vouchers SET is_active = NOT is_active WHERE id = ?`, [req.params.id]);
    const [[v]] = await db.query(`SELECT is_active FROM discount_vouchers WHERE id = ?`, [req.params.id]);
    res.json({ success: true, is_active: v?.is_active });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal update status' });
  }
});

// ─── ADMIN: DELETE /api/discount-vouchers/:id ───────────────────────────────
router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query(`DELETE FROM discount_vouchers WHERE id = ?`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal menghapus voucher diskon' });
  }
});

module.exports = router;
