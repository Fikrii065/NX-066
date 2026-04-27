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

// PUT /api/settings (admin.html uses PUT)
router.put('/', auth, async (req, res) => {
  try {
    // Pastikan kolom value cukup besar (self-heal jika migrate belum jalan)
    try {
      await db.query('ALTER TABLE settings MODIFY COLUMN value MEDIUMTEXT NULL');
    } catch(_) {}

    const entries = Object.entries(req.body);
    for (const [k, v] of entries) {
      const val = String(v ?? '');
      await db.query(
        'INSERT INTO settings (key_name,value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=VALUES(value)',
        [k, val]
      );
    }
    res.json({ success: true, message: 'Pengaturan disimpan' });
  } catch (e) {
    console.error('[settings PUT]', e.message);
    const msg = e.message.includes('Data too long')
      ? 'Gagal simpan: nilai terlalu panjang. Coba restart server lalu simpan lagi.'
      : e.message;
    res.status(500).json({ success: false, message: msg });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const entries = Object.entries(req.body);
    for (const [k, v] of entries) {
      const val = String(v ?? '');
      await db.query(
        'INSERT INTO settings (key_name,value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=VALUES(value)',
        [k, val]
      );
    }
    res.json({ success: true, message: 'Pengaturan disimpan' });
  } catch (e) {
    console.error('[settings POST]', e.message);
    const msg = e.message.includes('Data too long')
      ? 'Nilai terlalu panjang untuk disimpan. Pastikan database sudah di-migrate (restart server).'
      : e.message;
    res.status(500).json({ success: false, message: msg });
  }
});

module.exports = router;
