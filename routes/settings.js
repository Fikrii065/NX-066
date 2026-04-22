'use strict';
const router = require('express').Router();
const db     = require('../lib/db');
const auth   = require('../middleware/auth');

router.get('/all', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT key_name,value FROM settings');
    const settings = Object.fromEntries(rows.map(r => [r.key_name, r.value]));
    res.json({ success: true, settings });
  } catch (e) { res.status(500).json({ success: false }); }
});

router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT key_name,value FROM settings');
    const settings = Object.fromEntries(rows.map(r => [r.key_name, r.value]));
    res.json({ success: true, settings });
  } catch (e) { res.status(500).json({ success: false }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const entries = Object.entries(req.body);
    for (const [k, v] of entries) {
      await db.query(
        'INSERT INTO settings (key_name,value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=?',
        [k, String(v ?? ''), String(v ?? '')]
      );
    }
    res.json({ success: true, message: 'Pengaturan disimpan' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

module.exports = router;
