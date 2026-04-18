const jwt = require('jsonwebtoken');

// Periksa JWT_SECRET — warn di log tapi JANGAN crash server
// (Railway env var kadang baru terbaca setelah deploy, process.exit menyebabkan crash loop)
const JWT_SECRET = process.env.JWT_SECRET;

const PLACEHOLDER_VALUES = [
  'change_me',
  'GANTI_DENGAN_OUTPUT_PERINTAH_DI_ATAS',
  'your_jwt_secret',
  'secret',
];

const jwtWeak = !JWT_SECRET || PLACEHOLDER_VALUES.includes(JWT_SECRET) || JWT_SECRET.length < 32;

if (jwtWeak) {
  console.error('⚠️  PERINGATAN: JWT_SECRET tidak diset atau terlalu lemah!');
  console.error('   Set JWT_SECRET di Railway Dashboard → Variables');
  console.error('   Generate key: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  // TIDAK process.exit() — biarkan server tetap jalan agar bisa set env var via dashboard
}

module.exports = function authMiddleware(req, res, next) {
  // Kalau JWT_SECRET belum diset, tolak semua request dengan pesan jelas
  if (jwtWeak) {
    return res.status(503).json({
      success: false,
      message: 'Server belum dikonfigurasi: JWT_SECRET wajib diset di Railway Variables. Hubungi admin.'
    });
  }

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
