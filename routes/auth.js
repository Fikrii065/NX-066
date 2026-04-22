'use strict';
const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../lib/db');
const auth    = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ success: false, message: 'Username dan password wajib diisi' });

    const [[admin]] = await db.query(
      'SELECT * FROM admins WHERE (username=? OR email=?) AND is_active=1 LIMIT 1',
      [username, username]
    );
    if (!admin) return res.status(401).json({ success: false, message: 'Username atau password salah' });

    const ok = await bcrypt.compare(password, admin.password);
    if (!ok) return res.status(401).json({ success: false, message: 'Username atau password salah' });

    await db.query('UPDATE admins SET last_login=NOW() WHERE id=?', [admin.id]);

    const secret = process.env.JWT_SECRET;
    const token = jwt.sign(
      { id: admin.id, username: admin.username, role: admin.role },
      secret,
      { expiresIn: '12h' }
    );
    res.json({ success: true, token, admin: { id: admin.id, username: admin.username, role: admin.role } });
  } catch (e) {
    console.error('[login]', e.message);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

// GET /api/auth/me
router.get('/me', auth, async (req, res) => {
  try {
    const [[a]] = await db.query('SELECT id,username,email,role FROM admins WHERE id=?', [req.admin.id]);
    if (!a) return res.status(404).json({ success: false, message: 'Admin tidak ditemukan' });
    res.json({ success: true, admin: a });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
