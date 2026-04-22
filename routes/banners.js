'use strict';
const router = require('express').Router();
const db     = require('../lib/db');
const auth   = require('../middleware/auth');

router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM banners WHERE is_active=1 ORDER BY sort_order');
    res.json({ success: true, banners: rows });
  } catch (e) { res.status(500).json({ success: false }); }
});

router.get('/all', auth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM banners ORDER BY sort_order');
    res.json({ success: true, banners: rows });
  } catch (e) { res.status(500).json({ success: false }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const { title, image_url, link_url, sort_order, is_active } = req.body;
    if (!image_url) return res.status(400).json({ success: false, message: 'image_url wajib' });
    await db.query('INSERT INTO banners (title,image_url,link_url,sort_order,is_active) VALUES (?,?,?,?,?)',
      [title||null, image_url, link_url||null, sort_order||0, is_active??1]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false }); }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const { title, image_url, link_url, sort_order, is_active } = req.body;
    await db.query('UPDATE banners SET title=?,image_url=?,link_url=?,sort_order=?,is_active=? WHERE id=?',
      [title||null, image_url, link_url||null, sort_order||0, is_active??1, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false }); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM banners WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false }); }
});

module.exports = router;
