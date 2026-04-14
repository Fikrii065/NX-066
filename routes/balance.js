const router  = require('express').Router();
const crypto  = require('crypto');
const db      = require('../lib/db');
const tokopay = require('../lib/tokopay');
const { userAuth } = require('./users');

// ── Master daftar metode pembayaran Tokopay ───────────────────────────────────
// key  = kode yang dikirim ke Tokopay API
// settingKey = prefix key di tabel settings (pay_enabled_X, pay_logo_X, pay_channel_X)
const TOKOPAY_METHODS = {
  QRISREALTIME: { label: 'QRIS',               settingKey: 'QRIS',      icon: '⚡', type: 'qris' },
  dana:         { label: 'DANA',               settingKey: 'DANA',      icon: '💙', type: 'ewallet' },
  ovo:          { label: 'OVO',                settingKey: 'OVO',       icon: '💜', type: 'ewallet' },
  gopay:        { label: 'GoPay',              settingKey: 'GOPAY',     icon: '💚', type: 'ewallet' },
  shopeepay:    { label: 'ShopeePay',          settingKey: 'SHOPEEPAY', icon: '🟠', type: 'ewallet' },
  bca_va:       { label: 'Virtual Account BCA',settingKey: 'BCA',       icon: '🏦', type: 'va' },
  bni_va:       { label: 'Virtual Account BNI',settingKey: 'BNI',       icon: '🏦', type: 'va' },
  bri_va:       { label: 'Virtual Account BRI',settingKey: 'BRI',       icon: '🏦', type: 'va' },
  mandiri_va:   { label: 'Virtual Account Mandiri', settingKey: 'MANDIRI', icon: '🏦', type: 'va' },
  permata_va:   { label: 'Virtual Account Permata', settingKey: 'PERMATA', icon: '🏦', type: 'va' },
};

// ── Helper: buat deposit ID unik ─────────────────────────────────────────────
function makeDepositId() {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `DEP-${ts}-${rand}`;
}

// ── GET /api/balance/me — cek saldo user ─────────────────────────────────────
router.get('/me', userAuth, async (req, res) => {
  try {
    const [[user]] = await db.query(
      'SELECT balance FROM users WHERE id = ? LIMIT 1',
      [req.user.id]
    );
    if (!user) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
    res.json({ success: true, balance: parseFloat(user.balance || 0) });
  } catch (err) {
    console.error('[Balance/me]', err);
    res.status(500).json({ success: false, message: 'Gagal memuat saldo' });
  }
});

// ── GET /api/balance/methods — daftar metode pembayaran (dinamis dari settings)
router.get('/methods', userAuth, async (req, res) => {
  try {
    const keysNeeded = [];
    Object.values(TOKOPAY_METHODS).forEach(m => {
      keysNeeded.push(`pay_enabled_${m.settingKey}`);
      keysNeeded.push(`pay_logo_${m.settingKey}`);
      keysNeeded.push(`pay_channel_${m.settingKey}`);
    });
    const placeholders = keysNeeded.map(() => '?').join(',');
    const [rows] = await db.query(
      `SELECT key_name, value FROM settings WHERE key_name IN (${placeholders})`,
      keysNeeded
    );
    const cfg = {};
    rows.forEach(r => { cfg[r.key_name] = r.value; });

    const methods = Object.entries(TOKOPAY_METHODS)
      .filter(([, info]) => cfg[`pay_enabled_${info.settingKey}`] !== '0')
      .map(([value, info]) => {
        const logoVal = cfg[`pay_logo_${info.settingKey}`] || '';
        return {
          value,
          label: info.label,
          icon: info.icon,
          type: info.type,
          logo: logoVal ? `/api/settings/image/pay_logo_${info.settingKey}` : '',
          channel: cfg[`pay_channel_${info.settingKey}`] || value,
        };
      });
    res.json({ success: true, methods });
  } catch (err) {
    console.error('[Balance/methods]', err);
    const methods = Object.entries(TOKOPAY_METHODS).map(([value, info]) => ({
      value, label: info.label, icon: info.icon, type: info.type, logo: '', channel: value,
    }));
    res.json({ success: true, methods });
  }
});

// ── POST /api/balance/topup — buat transaksi topup saldo otomatis via Tokopay
router.post('/topup', userAuth, async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { amount, payment_method } = req.body;
    const amt = parseInt(amount);

    if (!amt || amt < 10000) {
      return res.status(400).json({ success: false, message: 'Minimal topup Rp 10.000' });
    }
    if (!payment_method || !TOKOPAY_METHODS[payment_method]) {
      return res.status(400).json({ success: false, message: 'Metode pembayaran tidak valid' });
    }

    // Ambil settings Tokopay dari DB (fallback ke .env)
    const [[mkRow]] = await conn.query("SELECT value FROM settings WHERE key_name='tokopay_merchant_id' LIMIT 1");
    const [[skRow]] = await conn.query("SELECT value FROM settings WHERE key_name='tokopay_secret_key' LIMIT 1");
    const [[appRow]] = await conn.query("SELECT value FROM settings WHERE key_name='app_url' LIMIT 1");

    const merchantId = mkRow?.value || process.env.TOKOPAY_MERCHANT_ID;
    const secretKey  = skRow?.value  || process.env.TOKOPAY_SECRET_KEY;
    const appUrl     = appRow?.value  || process.env.APP_URL || '';

    if (!merchantId || !secretKey) {
      return res.status(500).json({ success: false, message: 'Konfigurasi Tokopay belum lengkap. Hubungi admin.' });
    }

    const depositId  = makeDepositId();
    const callbackUrl = `${appUrl}/api/webhook/tokopay-balance`;
    const returnUrl   = `${appUrl}/dashboard`;

    // Buat order ke Tokopay
    let payResult;
    try {
      payResult = await tokopay.createPayment({
        orderId:     depositId,
        amount:      amt,
        method:      payment_method,
        description: `Topup Saldo ${req.user.name}`,
        merchantId,
        secretKey,
        returnUrl,
        callbackUrl,
      });
    } catch (payErr) {
      console.error('[Balance/topup] Tokopay error:', payErr.message);
      return res.status(502).json({ success: false, message: `Gagal membuat pembayaran: ${payErr.message}` });
    }

    // Simpan ke tabel balance_deposits
    const expiredAt = payResult.expired_at || null;
    await conn.query(
      `INSERT INTO balance_deposits
         (deposit_id, user_id, amount, payment_method, payment_url, va_number, qr_code,
          trx_id, status, expired_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,'pending',?,NOW())`,
      [
        depositId,
        req.user.id,
        amt,
        payment_method,
        payResult.payment_url || payResult.checkout_url || null,
        payResult.va_number   || null,
        payResult.qr_code     || null,
        payResult.trx_id      || null,
        expiredAt,
      ]
    );

    res.json({
      success:      true,
      deposit_id:   depositId,
      payment_url:  payResult.payment_url || payResult.checkout_url,
      va_number:    payResult.va_number,
      qr_code:      payResult.qr_code,
      total_bayar:  payResult.total_bayar || amt,
      expired_at:   expiredAt,
    });

  } catch (err) {
    console.error('[Balance/topup]', err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  } finally {
    conn.release();
  }
});

// ── GET /api/balance/topup-history — riwayat deposit saldo ──────────────────
router.get('/topup-history', userAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT deposit_id, amount, payment_method, status, created_at, expired_at, note
       FROM balance_deposits
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 20`,
      [req.user.id]
    );
    res.json({ success: true, history: rows });
  } catch (err) {
    console.error('[Balance/topup-history]', err);
    res.status(500).json({ success: false, message: 'Gagal memuat riwayat' });
  }
});

// ── GET /api/balance/topup-status/:depositId — cek status deposit ───────────
router.get('/topup-status/:depositId', userAuth, async (req, res) => {
  try {
    const [[dep]] = await db.query(
      'SELECT deposit_id, amount, status, payment_method FROM balance_deposits WHERE deposit_id=? AND user_id=? LIMIT 1',
      [req.params.depositId, req.user.id]
    );
    if (!dep) return res.status(404).json({ success: false, message: 'Deposit tidak ditemukan' });
    res.json({ success: true, deposit: dep });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal cek status' });
  }
});

module.exports = router;
