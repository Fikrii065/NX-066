const jwt = require('jsonwebtoken');

// FIX #2: Pastikan JWT_SECRET kuat — throw error jika masih pakai default
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET === 'change_me' || JWT_SECRET.length < 32) {
  console.error('❌ FATAL: JWT_SECRET tidak diset atau terlalu lemah di .env!');
  console.error('   Jalankan: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  console.error('   Salin hasilnya ke JWT_SECRET= di file .env');
  process.exit(1); // Hentikan server jika JWT tidak aman
}

module.exports = function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Token tidak ditemukan' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.admin = payload;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Token tidak valid atau kadaluarsa' });
  }
};
