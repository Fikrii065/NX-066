const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db     = require('../lib/db');
const auth   = require('../middleware/auth');

// ── GET /api/admin/users — list & search users ───────────────────────────────
router.get('/users', auth, async (req, res) => {
  try {
    const { page = 1, limit = 20, search, role } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];
    let where = 'WHERE 1=1';

    if (search) {
      where += ' AND (u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)';
      const q = `%${search}%`;
      params.push(q, q, q);
    }
    if (role && ['member','reseller'].includes(role)) {
      where += ' AND u.role = ?';
      params.push(role);
    }

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM users u ${where}`, params
    );

    const [users] = await db.query(
      `SELECT u.id, u.name, u.email, u.phone, u.is_active, u.role, u.balance, u.last_login, u.created_at,
              COUNT(o.id) AS total_orders,
              COALESCE(SUM(CASE WHEN o.payment_status='paid' THEN o.total_amount ELSE 0 END),0) AS total_spent
       FROM users u
       LEFT JOIN orders o ON o.customer_email = u.email
       ${where}
       GROUP BY u.id
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    res.json({ success: true, users, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('[Admin Users]', err);
    res.status(500).json({ success: false, message: 'Gagal memuat data user' });
  }
});

// ── GET /api/admin/users/:id — detail user + riwayat order ──────────────────
router.get('/users/:id', auth, async (req, res) => {
  try {
    const [[user]] = await db.query(
      'SELECT id, name, email, phone, is_active, role, balance, last_login, created_at FROM users WHERE id = ?',
      [req.params.id]
    );
    if (!user) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });

    const [orders] = await db.query(
      `SELECT o.order_id, o.created_at, o.total_amount, o.payment_status, o.topup_status,
              g.name AS game_name, p.name AS package_name
       FROM orders o
       JOIN games g ON o.game_id = g.id
       JOIN packages p ON o.package_id = p.id
       WHERE o.customer_email = ?
       ORDER BY o.created_at DESC LIMIT 20`,
      [user.email]
    );

    res.json({ success: true, user, orders });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memuat detail user' });
  }
});

// ── POST /api/admin/users/:id/reset-password — admin reset password user ─────
router.post('/users/:id/reset-password', auth, async (req, res) => {
  try {
    const { method, new_password } = req.body;
    // method: 'manual' (admin set password) | 'token' (generate token kirim ke user)

    const [[user]] = await db.query('SELECT id, name, email, phone FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });

    if (method === 'manual') {
      if (!new_password) return res.status(400).json({ success: false, message: 'Password baru wajib diisi' });
      const strongPw = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
      if (!strongPw.test(new_password))
        return res.status(400).json({ success: false, message: 'Password minimal 8 karakter, harus ada huruf dan angka' });

      const hashed = await bcrypt.hash(new_password, 12);
      await db.query(
        'UPDATE users SET password = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?',
        [hashed, user.id]
      );

      // Kirim notif WA ke user jika ada nomor HP
      if (user.phone) {
        try {
          const fonnte = require('../lib/fonnte');
          await fonnte.sendWA(
            user.phone,
            `Halo ${user.name},\n\nAdmin telah mereset password akun kamu.\n\nPassword baru: ${new_password}\n\nSilakan login dan segera ganti password kamu.`
          );
        } catch (e) {
          console.warn('[AdminResetPw] WA gagal:', e.message);
        }
      }

      res.json({ success: true, message: `Password user ${user.name} berhasil direset` });

    } else if (method === 'token') {
      // Generate token lalu kirim ke user via WA
      const token   = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 jam

      await db.query(
        'UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?',
        [token, expires, user.id]
      );

      const resetUrl = `${process.env.APP_URL}/reset-password?token=${token}`;

      if (user.phone) {
        try {
          const fonnte = require('../lib/fonnte');
          await fonnte.sendWA(
            user.phone,
            `Halo ${user.name},\n\nAdmin mengirimkan link reset password untukmu:\n\n${resetUrl}\n\nLink berlaku 1 jam.`
          );
        } catch (e) {
          console.warn('[AdminResetPw Token] WA gagal:', e.message);
        }
      }

      res.json({
        success: true,
        message: user.phone ? `Link reset dikirim via WA ke ${user.phone}` : 'Token berhasil dibuat (WA tidak tersedia)',
        reset_url: resetUrl, // Admin bisa copy-paste manual jika WA tidak aktif
      });

    } else {
      res.status(400).json({ success: false, message: 'Method tidak valid (manual / token)' });
    }
  } catch (err) {
    console.error('[AdminResetPw]', err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

// ── PATCH /api/admin/users/:id/toggle — aktif/nonaktif user ─────────────────
router.patch('/users/:id/toggle', auth, async (req, res) => {
  try {
    const [[user]] = await db.query('SELECT id, name, is_active FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });

    const newStatus = user.is_active ? 0 : 1;
    await db.query('UPDATE users SET is_active = ? WHERE id = ?', [newStatus, user.id]);

    res.json({
      success: true,
      message: `User ${user.name} ${newStatus ? 'diaktifkan' : 'dinonaktifkan'}`,
      is_active: newStatus,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal mengubah status user' });
  }
});

// ── PATCH /api/admin/users/:id/role — ubah role user ──────────────────────────
router.patch('/users/:id/role', auth, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['member','reseller'].includes(role))
      return res.status(400).json({ success: false, message: 'Role tidak valid. Gunakan: member / reseller' });

    const [[user]] = await db.query('SELECT id, name, email, phone FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });

    await db.query('UPDATE users SET role = ? WHERE id = ?', [role, user.id]);

    // Kirim notif WA jika jadi reseller
    if (role === 'reseller' && user.phone) {
      try {
        const fonnte = require('../lib/fonnte');
        await fonnte.sendWA(
          user.phone,
          `Halo ${user.name},\n\n🎉 Selamat! Akun kamu telah diupgrade ke *Reseller*.\n\nKamu sekarang mendapatkan harga spesial reseller. Login ke dashboard untuk melihat keuntunganmu.\n\nTerima kasih sudah bergabung! 🚀`
        );
      } catch(e) { console.warn('[Role WA]', e.message); }
    }

    res.json({ success: true, message: `Role ${user.name} berhasil diubah ke ${role}`, role });
  } catch (err) {
    console.error('[Admin Role]', err);
    res.status(500).json({ success: false, message: 'Gagal mengubah role' });
  }
});

// ── PATCH /api/admin/users/:id/balance — admin tambah/kurangi saldo user ──────
router.patch('/users/:id/balance', auth, async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { type, amount, note } = req.body; // type: 'add' | 'deduct'
    const amt = parseFloat(amount);
    if (!['add','deduct'].includes(type) || !amt || amt <= 0)
      return res.status(400).json({ success: false, message: 'Parameter tidak valid' });

    await conn.beginTransaction();
    const [[user]] = await conn.query('SELECT id, name, balance FROM users WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!user) { await conn.rollback(); return res.status(404).json({ success: false, message: 'User tidak ditemukan' }); }

    if (type === 'deduct' && parseFloat(user.balance) < amt) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'Saldo user tidak cukup' });
    }

    const newBalance = type === 'add'
      ? parseFloat(user.balance) + amt
      : parseFloat(user.balance) - amt;

    await conn.query('UPDATE users SET balance = ? WHERE id = ?', [newBalance, user.id]);
    await conn.query(
      `INSERT INTO balance_logs (user_id, type, amount, description, ref_id, created_at)
       VALUES (?, ?, ?, ?, 'admin', NOW())`,
      [user.id, type === 'add' ? 'topup' : 'deduct', amt, note || `Admin ${type === 'add' ? 'tambah' : 'kurangi'} saldo`]
    );

    await conn.commit();
    res.json({ success: true, message: `Saldo ${user.name} berhasil di${type === 'add' ? 'tambah' : 'kurangi'} Rp ${amt.toLocaleString('id-ID')}`, balance: newBalance });
  } catch(err) {
    await conn.rollback();
    console.error('[Admin Balance]', err);
    res.status(500).json({ success: false, message: 'Gagal mengubah saldo' });
  } finally {
    conn.release();
  }
});

module.exports = router;
