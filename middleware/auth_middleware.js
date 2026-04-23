'use strict';
const jwt = require('jsonwebtoken');

module.exports = function auth(req, res, next) {
  const secret = process.env.JWT_SECRET || '';
  if (!secret || secret.length < 16) {
    return res.status(503).json({ success: false, message: 'Server belum dikonfigurasi (JWT_SECRET)' });
  }
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ success: false, message: 'Token tidak ditemukan' });
  try {
    req.admin = jwt.verify(token, secret);
    next();
  } catch (e) {
    const msg = e.name === 'TokenExpiredError' ? 'Sesi habis, silakan login ulang' : 'Token tidak valid';
    res.status(401).json({ success: false, message: msg });
  }
};
