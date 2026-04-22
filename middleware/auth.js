const jwt = require('jsonwebtoken');

// Cek JWT_SECRET secara lazy (saat request masuk, bukan saat module di-load)
// Supaya auto-generate di server.js sempat berjalan lebih dulu
function getSecret() {
  return process.env.JWT_SECRET || '';
}

module.exports = function authMiddleware(req, res, next) {
  const secret = getSecret();
  if (!secret || secret.length < 32) {
    return res.status(503).json({
      success: false,
      message: 'Server belum dikonfigurasi: JWT_SECRET wajib diset.'
    });
  }

  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Token tidak ditemukan. Silakan login ulang.' });
  }

  try {
    const payload = jwt.verify(token, secret);
    req.admin = payload;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Sesi habis. Silakan login ulang.' });
    }
    return res.status(401).json({ success: false, message: 'Token tidak valid. Silakan login ulang.' });
  }
};
