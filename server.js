'use strict';
require('dotenv').config();

const express     = require('express');
const helmet      = require('helmet');
const cors        = require('cors');
const rateLimit   = require('express-rate-limit');
const path        = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use('/api/auth', rateLimit({ windowMs: 15*60*1000, max: 30, standardHeaders: true, legacyHeaders: false }));

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth',              require('./routes/auth'));
app.use('/api/banners',           require('./routes/banners'));
app.use('/api/categories',        require('./routes/categories'));
app.use('/api/games',             require('./routes/games'));
app.use('/api/packages',          require('./routes/packages'));
app.use('/api/package-icons',     require('./routes/package_icons'));
app.use('/api/orders',            require('./routes/orders'));
app.use('/api/settings',          require('./routes/settings'));
app.use('/api/nickname',          require('./routes/nickname'));
app.use('/api/balance',           require('./routes/balance'));
app.use('/api/discount-vouchers', require('./routes/discount_vouchers'));
app.use('/api/admin',             require('./routes/admin'));
app.use('/api/admin',             require('./routes/admin_extra'));
app.use('/api/admin',             require('./routes/admin_users'));

const pages = {
  '/admin':             'admin.html',
  '/login':             'login.html',
  '/dashboard':         'dashboard.html',
  '/cek-order':         'cek-order.html',
  '/order':             'order.html',
  '/payment':           'payment.html',
  '/pengguna':          'pengguna.html',
  '/reset-password':    'reset-password.html',
  '/user-auth':         'user-auth.html',
  '/voucher-order':     'voucher-order.html',
  '/kategori-layanan':  'kategori-layanan.html',
  '/metode-pembayaran': 'metode-pembayaran.html',
};
Object.entries(pages).forEach(([route, file]) => {
  app.get(route, (_req, res) => res.sendFile(path.join(__dirname, 'public', file)));
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, _next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

module.exports = app;
