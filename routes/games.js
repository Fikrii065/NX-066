'use strict';
const router = require('express').Router();
const db     = require('../lib/db');
const auth   = require('../middleware/auth');

router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM games WHERE is_active=1 ORDER BY sort_order,name'
    );
    res.json({ success: true, games: rows });
  } catch (e) { res.status(500).json({ success: false }); }
});

router.get('/all', auth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM games ORDER BY sort_order,name');
    res.json({ success: true, games: rows });
  } catch (e) { res.status(500).json({ success: false }); }
});

router.get('/:code', async (req, res) => {
  try {
    const [[game]] = await db.query('SELECT * FROM games WHERE code=? AND is_active=1 LIMIT 1', [req.params.code]);
    if (!game) return res.status(404).json({ success: false, message: 'Game tidak ditemukan' });
    res.json({ success: true, game });
  } catch (e) { res.status(500).json({ success: false }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const { code, name, icon, icon_url, banner_url, category, params, zone_label, zone_options, vip_code, link_url, sort_order, is_active } = req.body;
    if (!code || !name) return res.status(400).json({ success: false, message: 'code dan name wajib diisi' });
    await db.query(
      'INSERT INTO games (code,name,icon,icon_url,banner_url,category,params,zone_label,zone_options,vip_code,link_url,sort_order,is_active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [code, name, icon||'🎮', icon_url||null, banner_url||null, category||'game', params||'userId', zone_label||null, zone_options||null, vip_code||code, link_url||null, sort_order||0, is_active??1]
    );
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Kode game sudah ada' });
    res.status(500).json({ success: false, message: e.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const { name, icon, icon_url, banner_url, category, params, zone_label, zone_options, vip_code, link_url, sort_order, is_active, is_trending } = req.body;
    await db.query(
      'UPDATE games SET name=?,icon=?,icon_url=?,banner_url=?,category=?,params=?,zone_label=?,zone_options=?,vip_code=?,link_url=?,sort_order=?,is_active=?,is_trending=? WHERE id=?',
      [name, icon||'🎮', icon_url||null, banner_url||null, category||'game', params||'userId', zone_label||null, zone_options||null, vip_code||null, link_url||null, sort_order||0, is_active??1, is_trending??0, req.params.id]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM games WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false }); }
});

module.exports = router;
