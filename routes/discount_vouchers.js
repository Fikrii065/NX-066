'use strict';
const router = require('express').Router();
const db     = require('../lib/db');
const auth   = require('../middleware/auth');

function calcDiscount(v, amount) {
  let d = v.discount_type === 'percent'
    ? amount * parseFloat(v.discount_value) / 100
    : parseFloat(v.discount_value);
  if (v.max_discount && d > parseFloat(v.max_discount)) d = parseFloat(v.max_discount);
  return Math.round(Math.min(d, amount));
}

// POST /api/discount-vouchers/validate (public)
router.post('/validate', async (req, res) => {
  try {
    const { code, amount=0 } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'Kode wajib diisi' });
    const [[v]] = await db.query('SELECT * FROM discount_vouchers WHERE code=? AND is_active=1 LIMIT 1', [code.trim().toUpperCase()]);
    if (!v) return res.status(404).json({ success: false, message: 'Kode promo tidak valid' });
    const now = new Date();
    if (v.valid_from && new Date(v.valid_from) > now) return res.status(400).json({ success: false, message: 'Promo belum berlaku' });
    if (v.valid_until && new Date(v.valid_until) < now) return res.status(400).json({ success: false, message: 'Promo sudah kadaluarsa' });
    if (v.quota != null && v.used_count >= v.quota) return res.status(400).json({ success: false, message: 'Kuota promo habis' });
    const a = parseFloat(amount) || 0;
    if (v.min_purchase > 0 && a < parseFloat(v.min_purchase))
      return res.status(400).json({ success: false, message: `Minimum pembelian Rp ${Math.round(v.min_purchase).toLocaleString('id-ID')}` });
    const discount_amount = calcDiscount(v, a);
    res.json({ success: true, voucher: { id:v.id, code:v.code, name:v.name, discount_type:v.discount_type, discount_value:v.discount_value, max_discount:v.max_discount }, discount_amount, final_amount: Math.round(a - discount_amount) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// GET /api/discount-vouchers (admin)
router.get('/', auth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM discount_vouchers ORDER BY created_at DESC');
    res.json({ success: true, vouchers: rows });
  } catch (e) { res.status(500).json({ success: false }); }
});

// GET /api/discount-vouchers/stats
router.get('/stats', auth, async (req, res) => {
  try {
    const [[s]] = await db.query(`
      SELECT COUNT(*) AS total, SUM(is_active=1) AS active,
             COALESCE(SUM(used_count),0) AS total_used,
             SUM(valid_until IS NOT NULL AND valid_until < NOW()) AS expired
      FROM discount_vouchers`);
    res.json({ success: true, stats: s });
  } catch (e) { res.status(500).json({ success: false }); }
});

// POST (admin)
router.post('/', auth, async (req, res) => {
  try {
    const { code, name, description, discount_type, discount_value, min_purchase, max_discount, quota, valid_from, valid_until, is_active } = req.body;
    if (!code||!name||!discount_type||discount_value==null) return res.status(400).json({ success: false, message: 'Field wajib kurang' });
    await db.query(
      'INSERT INTO discount_vouchers (code,name,description,discount_type,discount_value,min_purchase,max_discount,quota,valid_from,valid_until,is_active) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [code.trim().toUpperCase(), name, description||null, discount_type, parseFloat(discount_value), parseFloat(min_purchase)||0, max_discount?parseFloat(max_discount):null, quota?parseInt(quota):null, valid_from||null, valid_until||null, is_active?1:0]
    );
    res.json({ success: true });
  } catch (e) {
    if (e.code==='ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Kode sudah dipakai' });
    res.status(500).json({ success: false, message: e.message });
  }
});

// PUT
router.put('/:id', auth, async (req, res) => {
  try {
    const { name, description, discount_type, discount_value, min_purchase, max_discount, quota, valid_from, valid_until, is_active } = req.body;
    await db.query(
      'UPDATE discount_vouchers SET name=?,description=?,discount_type=?,discount_value=?,min_purchase=?,max_discount=?,quota=?,valid_from=?,valid_until=?,is_active=? WHERE id=?',
      [name, description||null, discount_type, parseFloat(discount_value), parseFloat(min_purchase)||0, max_discount?parseFloat(max_discount):null, quota?parseInt(quota):null, valid_from||null, valid_until||null, is_active?1:0, req.params.id]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false }); }
});

// PATCH toggle
router.patch('/:id/toggle', auth, async (req, res) => {
  try {
    await db.query('UPDATE discount_vouchers SET is_active=NOT is_active WHERE id=?', [req.params.id]);
    const [[v]] = await db.query('SELECT is_active FROM discount_vouchers WHERE id=?', [req.params.id]);
    res.json({ success: true, is_active: v?.is_active });
  } catch (e) { res.status(500).json({ success: false }); }
});

// DELETE
router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM discount_vouchers WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false }); }
});

module.exports = router;
