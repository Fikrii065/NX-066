require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const app  = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ── Security headers (helmet) ────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP agar tidak bentrok dengan inline script di HTML
  crossOriginEmbedderPolicy: false,
}));

// ── CORS — hanya izinkan domain sendiri ──────────────────────────────────────
const allowedOrigins = [
  process.env.APP_URL,
  'http://localhost:3000',
  'http://localhost:8080',
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    // Izinkan request tanpa origin (misal: curl, Postman, webhook)
    if (!origin) return callback(null, true);
    // Izinkan domain Railway secara otomatis (frontend & backend 1 service)
    if (origin.endsWith('.railway.app')) return callback(null, true);
    // Izinkan domain yang terdaftar di APP_URL
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('CORS: origin tidak diizinkan'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Rate limiters ────────────────────────────────────────────────────────────
// Global API limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
});

// Login limiter — cegah brute force
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Hanya hitung percobaan yang gagal
});

// Order limiter
const orderLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { success: false, message: 'Terlalu banyak permintaan, coba lagi nanti.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);
app.use('/api/auth/login', loginLimiter);
app.use('/api/users/login', loginLimiter);    // rate limit login user
app.use('/api/users/register', rateLimit({    // rate limit register: cegah spam akun
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Terlalu banyak percobaan. Coba lagi dalam 1 jam.' },
  standardHeaders: true, legacyHeaders: false,
}));
app.use('/api/orders/create', orderLimiter);

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth',           require('./routes/auth'));
app.use('/api/games',          require('./routes/games'));
app.use('/api/packages',       require('./routes/packages'));
app.use('/api/orders',         require('./routes/orders'));
app.use('/api/check-nickname', require('./routes/nickname'));
app.use('/api/webhook',        require('./routes/webhooks'));
app.use('/api/admin',          require('./routes/admin'));
app.use('/api/admin',          require('./routes/admin_users')); // user management
app.use('/api/balance',        require('./routes/balance'));
app.use('/api/users',           require('./routes/users'));
app.use('/api/settings',       require('./routes/settings'));
app.use('/api/banners',        require('./routes/banners'));
app.use('/api/vouchers',       require('./routes/vouchers'));

// ── Page routes ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/order', (req, res) => res.sendFile(path.join(__dirname, 'public', 'order.html')));
app.get('/voucher-order', (req, res) => res.sendFile(path.join(__dirname, 'public', 'voucher-order.html')));
app.get('/payment', (req, res) => res.sendFile(path.join(__dirname, 'public', 'payment.html')));
app.get('/cek-order', (req, res) => res.sendFile(path.join(__dirname, 'public', 'cek-order.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/user-auth', (req, res) => res.sendFile(path.join(__dirname, 'public', 'user-auth.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/reset-password', (req, res) => res.sendFile(path.join(__dirname, 'public', 'user-auth.html')));

// ── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.message && err.message.startsWith('CORS')) {
    return res.status(403).json({ success: false, message: 'Akses ditolak' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'File terlalu besar. Maksimal 10MB.' });
  }
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

const server = app.listen(PORT, () => {
  console.log(`🚀 GameFlash berjalan di http://localhost:${PORT}`);
});
server.timeout = 90000; // 90 detik — cukup untuk ambil pricelist Digiflazz
