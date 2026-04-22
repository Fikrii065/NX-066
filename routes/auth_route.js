const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../lib/db');
const auth    = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username dan password wajib diisi' });
    }

    const [rows] = await db.query(
      'SELECT * FROM admins WHERE (username = ? OR email = ?) AND is_active = 1 LIMIT 1',
      [username, username]
    );

    if (!rows.length) {
      return res.status(401).json({ success: false, message: 'Username atau password salah' });
    }

    const admin = rows[0];
    const match = await bcrypt.compare(password, admin.password);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Username atau password salah' });
    }

    await db.query('UPDATE admins SET last_login = NOW() WHERE id = ?', [admin.id]);

    // Tidak ada fallback — JWT_SECRET wajib diset di .env (dicek di middleware/auth.js saat startup)
    const jwtSecret = process.env.JWT_SECRET || '';
    if (!jwtSecret || jwtSecret.length < 32) {
      return res.status(503).json({ success: false, message: 'JWT_SECRET belum dikonfigurasi di server' });
    }
    const token = jwt.sign(
      { id: admin.id, username: admin.username, role: admin.role },
      jwtSecret,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({
      success: true,
      token,
      admin: { id: admin.id, username: admin.username, email: admin.email, role: admin.role },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

// GET /api/auth/me
router.get('/me', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, username, email, role, last_login FROM admins WHERE id = ?',
      [req.admin.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Admin tidak ditemukan' });
    res.json({ success: true, admin: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', auth, async (req, res) => {
  try {
    const { old_password, new_password } = req.body;

    // Minimal 8 karakter, harus ada huruf dan angka
    const strongPassword = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    if (!old_password || !new_password || !strongPassword.test(new_password)) {
      return res.status(400).json({
        success: false,
        message: 'Password baru minimal 8 karakter dan harus mengandung huruf dan angka'
      });
    }

    const [rows] = await db.query('SELECT password FROM admins WHERE id = ?', [req.admin.id]);
    const match  = await bcrypt.compare(old_password, rows[0].password);
    if (!match) return res.status(401).json({ success: false, message: 'Password lama salah' });

    const hashed = await bcrypt.hash(new_password, 12);
    await db.query('UPDATE admins SET password = ? WHERE id = ?', [hashed, req.admin.id]);

    res.json({ success: true, message: 'Password berhasil diubah' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

module.exports = router;
