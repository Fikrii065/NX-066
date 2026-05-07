# TopUp Game Website

Website top up game dengan integrasi Digiflazz, Tokopay, dan notifikasi WhatsApp via Fonnte.

## Fitur
- 🎮 Multi game & produk dari Digiflazz
- 💳 Payment gateway Tokopay (QRIS, VA, e-wallet, dll)
- 📱 Notifikasi WhatsApp pembeli via Fonnte
- 🌙 Dark/Light mode toggle
- 📊 Dashboard admin lengkap
- 📋 Manajemen order, game, paket, banner
- 🔍 Cek nickname/username game

## Cara Deploy ke Railway

1. Upload semua file ke GitHub repo baru
2. Buat project baru di Railway → Deploy from GitHub
3. Tambah MySQL database di Railway
4. Set environment variables berikut di Railway:

```
DB_HOST=       # dari Railway MySQL
DB_PORT=3306
DB_USER=root
DB_PASS=       # dari Railway MySQL
DB_NAME=railway
JWT_SECRET=    # string random panjang
ADMIN_USERNAME=admin
ADMIN_PASSWORD=password_kamu
SITE_URL=      # https://xxx.up.railway.app

# Opsional (bisa diisi di admin panel)
VIP_API_ID=
VIP_API_KEY=
```

5. Deploy → otomatis migrasi database

## Login Admin
- URL: `/login`
- Username & password sesuai ENV `ADMIN_USERNAME` & `ADMIN_PASSWORD`

## Setup API di Admin Panel
Setelah login, masuk ke **API Keys**:
- Isi Digiflazz username & API key
- Isi Tokopay merchant ID & secret key  
- Isi Fonnte token untuk notif WA
- Masuk **Pengaturan** → isi nomor WA admin

## Webhook URL
- Tokopay: `https://domain.com/api/webhook/tokopay`
- Digiflazz: `https://domain.com/api/webhook/digiflazz`
