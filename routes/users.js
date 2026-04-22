'use strict';
const router = require('express').Router();
const db     = require('../lib/db');
const auth   = require('../middleware/auth');
const jwt    = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// GET /api/users (admin)
router.get('/', auth, async (req, res) => {
  try {
    const { search='', role='', page=1, limit=15 } = req.query;
    const offset = (parseInt(page)-1)*parseInt(limit);
    let where = 'WHERE 1=1'; const params = [];
    if (search) { where += ' AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)'; params.push(`%${search}%`,`%${search}%`,`%${search}%`); }
    if (role) { where += ' AND role=?'; params.push(role); }
    const [[{total}]] = await db.query(`SELECT COUNT(*) AS total FROM users ${where}`, params);
    const [rows] = await db.query(
      `SELECT id,name,email,phone,role,balance,is_active,last_login,created_at,
        (SELECT COUNT(*) FROM orders WHERE customer_wa=users.phone OR customer_email=users.email) AS total_orders
       FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );
    res.json({ success: true, users: rows, total, page: parseInt(page) });
  } catch (e) { res.status(500).json({ success: false }); }
});

// GET /api/users/:id (admin)
router.get('/:id', auth, async (req, res) => {
  try {
    const [[u]] = await db.query('SELECT id,name,email,phone,role,balance,is_active,created_at FROM users WHERE id=?', [req.params.id]);
    if (!u) return res.status(404).json({ success: false });
    const [orders] = await db.query('SELECT order_id,total_amount,topup_status,created_at FROM orders WHERE customer_email=? OR customer_wa=? ORDER BY created_at DESC LIMIT 10', [u.email||'',u.phone||'']);
    res.json({ success: true, user: u, orders });
  } catch (e) { res.status(500).json({ success: false }); }
});

// PATCH /api/users/:id (admin - update role/status/balance)
router.patch('/:id', auth, async (req, res) => {
  try {
    const { role, is_active, balance_delta, note } = req.body;
    if (role) await db.query('UPDATE users SET role=? WHERE id=?', [role, req.params.id]);
    if (is_active !== undefined) await db.query('UPDATE users SET is_active=? WHERE id=?', [is_active?1:0, req.params.id]);
    if (balance_delta) {
      const delta = parseFloat(balance_delta);
      await db.query('UPDATE users SET balance=balance+? WHERE id=?', [delta, req.params.id]);
      await db.query('INSERT INTO balance_logs (user_id,type,amount,description) VALUES (?,?,?,?)',
        [req.params.id, delta>0?'topup':'deduct', Math.abs(delta), note||'Admin adjustment']);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false }); }
});

// POST /api/users/register (public)
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'Email dan password wajib' });
    const hashed = await bcrypt.hash(password, 10);
    await db.query('INSERT INTO users (name,email,phone,password) VALUES (?,?,?,?)', [name||null, email, phone||null, hashed]);
    res.json({ success: true, message: 'Registrasi berhasil' });
  } catch (e) {
    if (e.code==='ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Email sudah terdaftar' });
    res.status(500).json({ success: false });
  }
});

// POST /api/users/login (public)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const [[u]] = await db.query('SELECT * FROM users WHERE email=? AND is_active=1 LIMIT 1', [email]);
    if (!u) return res.status(401).json({ success: false, message: 'Email atau password salah' });
    const ok = await bcrypt.compare(password, u.password||'');
    if (!ok) return res.status(401).json({ success: false, message: 'Email atau password salah' });
    await db.query('UPDATE users SET last_login=NOW() WHERE id=?', [u.id]);
    const token = jwt.sign({ id:u.id, email:u.email, role:u.role, type:'user' }, process.env.JWT_SECRET, { expiresIn:'7d' });
    res.json({ success: true, token, user: { id:u.id, name:u.name, email:u.email, role:u.role, balance:u.balance } });
  } catch (e) { res.status(500).json({ success: false }); }
});

module.exports = router;
