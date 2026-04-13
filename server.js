require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const app  = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 150 });
const orderLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10,
  message: { success: false, message: 'Terlalu banyak permintaan, coba lagi nanti.' }
});
app.use('/api/', limiter);
app.use('/api/orders/create', orderLimiter);

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth',           require('./routes/auth'));
app.use('/api/games',          require('./routes/games'));
app.use('/api/packages',       require('./routes/packages'));
app.use('/api/orders',         require('./routes/orders'));
app.use('/api/check-nickname', require('./routes/nickname'));
app.use('/api/webhook',        require('./routes/webhooks'));
app.use('/api/admin',          require('./routes/admin'));
app.use('/api/settings',       require('./routes/settings'));
app.use('/api/banners',        require('./routes/banners'));

// ── TEMP: Reset admin password ───────────────────────────────────────────────
app.get('/reset-admin-pw', async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    const db = require('./lib/db');
    const hash = await bcrypt.hash('admin123', 10);
    await db.query('UPDATE admins SET password=? WHERE username=?', [hash, 'admin']);
    res.json({ ok: true, message: 'Password berhasil direset ke admin123' });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── Page routes ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/order', (req, res) => res.sendFile(path.join(__dirname, 'public', 'order.html')));
app.get('/payment', (req, res) => res.sendFile(path.join(__dirname, 'public', 'payment.html')));
app.get('/cek-order', (req, res) => res.sendFile(path.join(__dirname, 'public', 'cek-order.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'File terlalu besar. Maksimal 10MB.' });
  }
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`🚀 GameFlash berjalan di http://localhost:${PORT}`);
});
