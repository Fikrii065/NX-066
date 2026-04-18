'use strict';
require('dotenv').config();

const express     = require('express');
const helmet      = require('helmet');
const cors        = require('cors');
const rateLimit   = require('express-rate-limit');
const path        = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security & Middleware ─────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,   // biarkan HTML admin pakai inline script
  crossOriginEmbedderPolicy: false,
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));   // besar utk base64 image
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate-limit hanya untuk route auth (login)
app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
}));

// ── Static Files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',             require('./routes/auth'));
app.use('/api/banners',          require('./routes/banners'));
app.use('/api/categories',       require('./routes/categories'));
app.use('/api/games',            require('./routes/games'));
app.use('/api/packages',         require('./routes/packages'));
app.use('/api/package-icons',    require('./routes/package_icons'));
app.use('/api/orders',           require('./routes/orders'));
app.use('/api/settings',         require('./routes/settings'));
app.use('/api/nickname',         require('./routes/nickname'));
app.use('/api/balance',          require('./routes/balance'));
app.use('/api/discount-vouchers',require('./routes/discount_vouchers'));
app.use('/api/admin',            require('./routes/admin'));
app.use('/api/admin',            require('./routes/admin_extra'));
app.use('/api/admin',            require('./routes/admin_users'));

// ── SPA Fallback ─────────────────────────────────────────────────────────────
// Semua route non-API dikembalikan ke index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Error Handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ GameFlash server running on port ${PORT}`);
  console.log(`   APP_URL : ${process.env.APP_URL || 'http://localhost:' + PORT}`);
});

module.exports = app;
