const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const db     = require('../lib/db');

// ── Middleware auth user ─────────────────────────────────────────────────────
function userAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, message: 'Token tidak ditemukan' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.type !== 'user') return res.status(401).json({ success: false, message: 'Token tidak valid' });
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Token tidak valid atau kadaluarsa' });
  }
}

// ── POST /api/users/register ─────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ success: false, message: 'Nama, email, dan password wajib diisi' });

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(email))
      return res.status(400).json({ success: false, message: 'Format email tidak valid' });

    const strongPw = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    if (!strongPw.test(password))
      return res.status(400).json({ success: false, message: 'Password minimal 8 karakter dan harus mengandung huruf dan angka' });

    const [[existing]] = await db.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (existing)
      return res.status(409).json({ success: false, message: 'Email sudah terdaftar' });

    const hashed = await bcrypt.hash(password, 12);
    const [result] = await db.query(
      'INSERT INTO users (name, email, phone, password) VALUES (?, ?, ?, ?)',
      [name.trim(), email.toLowerCase().trim(), phone || null, hashed]
    );

    const token = jwt.sign(
      { id: result.insertId, email, name, type: 'user' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.status(201).json({
      success: true,
      message: 'Akun berhasil dibuat',
      token,
      user: { id: result.insertId, name, email, phone: phone || null },
    });
  } catch (err) {
    console.error('[Register]', err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

// ── POST /api/users/login ────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Email dan password wajib diisi' });

    const [[user]] = await db.query(
      'SELECT * FROM users WHERE email = ? AND is_active = 1 LIMIT 1',
      [email.toLowerCase().trim()]
    );

    if (!user) return res.status(401).json({ success: false, message: 'Email atau password salah' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ success: false, message: 'Email atau password salah' });

    await db.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

    const rememberMe = req.body.remember_me === true || req.body.remember_me === 'true';
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role || 'member', type: 'user' },
      process.env.JWT_SECRET,
      { expiresIn: rememberMe ? '7d' : (process.env.JWT_EXPIRES_IN || '8h') }
    );

    res.json({
      success: true,
      token,
      remember_me: rememberMe,
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role || 'member', balance: parseFloat(user.balance || 0) },
    });
  } catch (err) {
    console.error('[User Login]', err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

// ── GET /api/users/me ────────────────────────────────────────────────────────
router.get('/me', userAuth, async (req, res) => {
  try {
    const [[user]] = await db.query(
      'SELECT id, name, email, phone, role, balance, created_at, last_login FROM users WHERE id = ? LIMIT 1',
      [req.user.id]
    );
    if (!user) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

// ── GET /api/users/orders — riwayat order by email ──────────────────────────
router.get('/orders', userAuth, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const [[{ total }]] = await db.query(
      'SELECT COUNT(*) AS total FROM orders WHERE customer_email = ?',
      [req.user.email]
    );

    const [orders] = await db.query(
      `SELECT o.order_id, o.created_at, o.total_amount, o.payment_status, o.topup_status,
              o.payment_method, o.sn, g.name AS game_name, g.icon AS game_icon, p.name AS package_name
       FROM orders o
       JOIN games g ON o.game_id = g.id
       JOIN packages p ON o.package_id = p.id
       WHERE o.customer_email = ?
       ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
      [req.user.email, parseInt(limit), offset]
    );

    res.json({ success: true, orders, total, page: parseInt(page) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memuat riwayat' });
  }
});

// ── POST /api/users/forgot-password ─────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email wajib diisi' });

    const [[user]] = await db.query('SELECT id, name FROM users WHERE email = ? AND is_active = 1 LIMIT 1', [email.toLowerCase().trim()]);

    // Selalu kembalikan pesan sukses agar tidak bocorkan info email terdaftar atau tidak
    if (!user) return res.json({ success: true, message: 'Jika email terdaftar, token reset telah dikirim' });

    const token   = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 jam

    await db.query('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?', [token, expires, user.id]);

    // Kirim via Fonnte WA jika tersedia
    try {
      const fonnte = require('../lib/fonnte');
      const [[phoneRow]] = await db.query('SELECT phone FROM users WHERE id = ?', [user.id]);
      if (phoneRow?.phone) {
        const resetUrl = `${process.env.APP_URL}/reset-password?token=${token}`;
        await fonnte.sendWA(
          phoneRow.phone,
          `Halo ${user.name},\n\nKamu meminta reset password.\n\nKlik link berikut untuk membuat password baru:\n${resetUrl}\n\nLink berlaku 1 jam. Abaikan jika bukan kamu yang meminta.`
        );
      }
    } catch (waErr) {
      console.warn('[ForgotPw] WA gagal:', waErr.message);
    }

    // Kembalikan token di response untuk kemudahan testing / jika WA tidak aktif
    // Di production sebaiknya hanya kirim via WA/email, hapus field token di bawah
    res.json({
      success: true,
      message: 'Token reset berhasil dibuat. Cek WA kamu.',
      // Hapus baris ini di production jika WA sudah aktif:
      _dev_token: process.env.NODE_ENV !== 'production' ? token : undefined,
    });
  } catch (err) {
    console.error('[ForgotPw]', err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

// ── POST /api/users/reset-password ──────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password)
      return res.status(400).json({ success: false, message: 'Token dan password baru wajib diisi' });

    const strongPw = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    if (!strongPw.test(password))
      return res.status(400).json({ success: false, message: 'Password minimal 8 karakter, harus ada huruf dan angka' });

    const [[user]] = await db.query(
      'SELECT id FROM users WHERE reset_token = ? AND reset_expires > NOW() LIMIT 1',
      [token]
    );
    if (!user) return res.status(400).json({ success: false, message: 'Token tidak valid atau sudah kadaluarsa' });

    const hashed = await bcrypt.hash(password, 12);
    await db.query(
      'UPDATE users SET password = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?',
      [hashed, user.id]
    );

    res.json({ success: true, message: 'Password berhasil diubah. Silakan login.' });
  } catch (err) {
    console.error('[ResetPw]', err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

module.exports = router;
module.exports.userAuth = userAuth;
