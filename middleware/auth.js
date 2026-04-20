const jwt = require('jsonwebtoken');

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
  console.error('   Set JWT_SECRET di .env atau Railway Dashboard → Variables');
  console.error('   Generate key: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
}

module.exports = function authMiddleware(req, res, next) {
  if (jwtWeak) {
    return res.status(503).json({
      success: false,
      message: 'Server belum dikonfigurasi: JWT_SECRET wajib diset minimal 32 karakter. ' +
               'Jalankan: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))" ' +
               'lalu isi di file .env → JWT_SECRET=<hasil>'
    });
  }

  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Token tidak ditemukan. Silakan login ulang.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.admin = payload;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Sesi habis. Silakan login ulang.' });
    }
    return res.status(401).json({ success: false, message: 'Token tidak valid. Silakan login ulang.' });
  }
};
