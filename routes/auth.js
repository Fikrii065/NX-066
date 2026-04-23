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

    // Check JWT_SECRET
    const secret = process.env.JWT_SECRET || '';
    if (secret.length < 8) {
      return res.status(503).json({ success: false, message: 'Server belum siap, coba lagi dalam beberapa detik' });
    }

    let admin;
    try {
      [[admin]] = await db.query(
        'SELECT * FROM admins WHERE (username=? OR email=?) AND is_active=1 LIMIT 1',
        [username, username]
      );
    } catch (dbErr) {
      console.error('[login] DB error:', dbErr.message);
      return res.status(503).json({ success: false, message: 'Database belum siap, coba lagi sebentar' });
    }

    if (!admin) return res.status(401).json({ success: false, message: 'Username atau password salah' });

    const ok = await bcrypt.compare(password, admin.password);
    if (!ok) return res.status(401).json({ success: false, message: 'Username atau password salah' });

    await db.query('UPDATE admins SET last_login=NOW() WHERE id=?', [admin.id]).catch(() => {});

    const token = jwt.sign(
      { id: admin.id, username: admin.username, role: admin.role },
      secret,
      { expiresIn: '12h' }
    );

    res.json({
      success: true,
      token,
      admin: { id: admin.id, username: admin.username, role: admin.role }
    });
  } catch (e) {
    console.error('[login] Unexpected error:', e.message);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan: ' + e.message });
  }
});

// GET /api/auth/me
router.get('/me', auth, async (req, res) => {
  try {
    const [[a]] = await db.query(
      'SELECT id,username,email,role FROM admins WHERE id=?',
      [req.admin.id]
    );
    if (!a) return res.status(404).json({ success: false, message: 'Admin tidak ditemukan' });
    res.json({ success: true, admin: a });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/auth/login - redirect to login page (for browsers that visit directly)
router.get('/login', (req, res) => {
  res.redirect('/login');
});

// GET /api/auth/status - quick health check
router.get('/status', (req, res) => {
  res.json({ success: true, ready: true, timestamp: new Date().toISOString() });
});

module.exports = router;
