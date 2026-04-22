'use strict';
const router = require('express').Router();
const db     = require('../lib/db');
const auth   = require('../middleware/auth');

router.get('/', async (req, res) => {
  try {
    const { game_id } = req.query;
    const where = game_id ? 'WHERE p.game_id=? AND p.is_active=1' : 'WHERE p.is_active=1';
    const params = game_id ? [game_id] : [];
    const [rows] = await db.query(
      `SELECT p.*, g.name AS game_name FROM packages p
       LEFT JOIN games g ON p.game_id=g.id
       ${where} ORDER BY p.sort_order, p.base_price`,
      params
    );
    res.json({ success: true, packages: rows });
  } catch (e) { res.status(500).json({ success: false }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const { game_id, sku, name, digiflazz_sku, base_price, sort_order, is_active } = req.body;
    if (!game_id || !sku || !name) return res.status(400).json({ success: false, message: 'game_id, sku, name wajib diisi' });
    await db.query(
      'INSERT INTO packages (game_id,sku,name,digiflazz_sku,base_price,sort_order,is_active) VALUES (?,?,?,?,?,?,?)',
      [game_id, sku, name, digiflazz_sku||null, base_price||0, sort_order||0, is_active??1]
    );
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'SKU sudah ada' });
    res.status(500).json({ success: false, message: e.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const { name, digiflazz_sku, base_price, sort_order, is_active, is_hot } = req.body;
    await db.query(
      'UPDATE packages SET name=?,digiflazz_sku=?,base_price=?,sort_order=?,is_active=?,is_hot=? WHERE id=?',
      [name, digiflazz_sku||null, base_price||0, sort_order||0, is_active??1, is_hot??0, req.params.id]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false }); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM packages WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false }); }
});

module.exports = router;
