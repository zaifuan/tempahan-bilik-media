# 📚 Sistem Tempahan Bilik Media

Sistem tempahan bilik media untuk **SABK Maahad Al Khair Lil Banat**, dibina semula dari Google Apps Script ke stack moden **Node.js + Express + PostgreSQL** untuk dihost di server sendiri.

> Versi: **5.0** | Stack: Node.js 20 + Express 4 + PostgreSQL 16 | Brand: [byzaifuan.com](https://byzaifuan.com)

---

## ✨ Ciri-Ciri Utama

### Untuk Guru / Pengguna
- 📅 **Tempahan PdPc** — pilih satu atau lebih slot dari jadual mengajar sebenar
- 🎤 **Tempahan Umum** — untuk mesyuarat, taklimat, seminar (masa custom)
- ⏱️ **Status realtime** — papar status bilik (kosong/digunakan/luar waktu) setiap 60 saat
- 📊 **Statistik bulanan** — lihat siapa sudah/belum guna bilik bulan ini
- 🗓️ **Navigasi tarikh** — boleh tempah sehingga 30 hari ke hadapan
- 🖨️ **Papar & Cetak jadual** — output bercetak untuk papan kenyataan
- 📱 **Mobile-first** — direka untuk mobile, jalan di desktop juga
- ❌ **Auto-block** — Sabtu, Ahad, hari cuti, slot rehat/solat

### Untuk Admin
- 👥 CRUD Guru, Kelas, Subjek, Jadual Mengajar
- 📋 Audit log semua aktiviti tempahan & batal
- ⚙️ Settings configurable (nama sekolah, had bulanan, auto-refresh, dll.)
- ⏸️ Urus slot disabled (rehat/solat)
- 🎉 Urus cuti & hari kelepasan
- 🔑 Multi-admin dengan role (`admin` / `superadmin`)
- 🔐 JWT authentication, password di-hash bcrypt
- 🔄 Cancel tempahan dengan log sebab

### Untuk Sistem
- 🔒 Race-condition safe (`pg_advisory_xact_lock`)
- 🧠 Fuzzy name matching (BIN/BINTI variants)
- 📦 Soft delete (tempahan lepas dikekalkan)
- 🛡️ Helmet + rate limit + compression + CORS
- 📝 Morgan request log
- ♻️ Settings cache (60s) — kurang query DB

---

## 🏗️ Senibina

```
┌──────────────────────────────────────────────────────────┐
│  Browser (Mobile/Desktop)                                 │
│    ├─ /          → index.html  + app.js  + app.css        │
│    └─ /admin     → admin.html  + admin.js + admin.css     │
└──────────────────────────────────────────────────────────┘
                            │ HTTPS
                            ▼
┌──────────────────────────────────────────────────────────┐
│  Nginx (port 443) — reverse proxy + SSL                   │
└──────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────┐
│  Express App (port 3000) — PM2 managed                    │
│    ├─ /api/*        → public.js (no auth)                 │
│    ├─ /api/admin/*  → admin.js  (JWT auth)                │
│    └─ services/booking.js, settings.js                    │
└──────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────┐
│  PostgreSQL — tables:                                     │
│    teachers, classes, subjects, teacher_schedule          │
│    bookings, booking_logs, disabled_slots, holidays       │
│    settings (KV), admin_users                             │
└──────────────────────────────────────────────────────────┘
```

---

## 🚀 Pemasangan Pantas

Untuk panduan lengkap, baca [`deploy/DEPLOYMENT.md`](deploy/DEPLOYMENT.md).

### Tempatan (Development)

```bash
# 1. Install dependencies
npm install

# 2. Copy environment & edit nilai
cp .env.example .env
nano .env

# 3. Init database (pastikan PostgreSQL dah running)
npm run init-db

# 4. Import data dari Excel (kalau ada)
npm run import-excel -- /path/to/data.xlsx

# 5. Run dalam dev mode
npm run dev

# 6. Akses
# Aplikasi utama: http://localhost:3000
# Admin panel:    http://localhost:3000/admin
#                 (default: admin / admin123)
```

### Production (Ubuntu Server)

```bash
# Automated setup (recommended)
DOMAIN=tempahan.byzaifuan.com ./deploy/ubuntu-setup.sh

# Atau ikut langkah-langkah manual dalam deploy/DEPLOYMENT.md
```

---

## 📁 Struktur Project

```
sistem-tempahan-bilik-media/
├── backend/src/
│   ├── server.js              ← Express main
│   ├── db.js                  ← PostgreSQL pool
│   ├── utils/time.js          ← Time/date helpers
│   ├── middleware/auth.js     ← JWT auth
│   ├── services/
│   │   ├── booking.js         ← Business logic
│   │   └── settings.js        ← Settings (cached)
│   └── routes/
│       ├── public.js          ← Public API
│       └── admin.js           ← Admin API
├── frontend/public/
│   ├── index.html             ← App utama
│   ├── admin.html             ← Admin panel
│   ├── css/{app,admin}.css
│   └── js/{app,admin}.js
├── db/schema.sql              ← Schema PostgreSQL
├── scripts/
│   ├── init-db.js             ← Setup DB schema
│   ├── import-excel.js        ← Import dari .xlsx
│   └── create-admin.js        ← Cipta/reset admin
├── nginx/sistem-tempahan.conf ← Nginx reverse proxy
├── deploy/
│   ├── DEPLOYMENT.md          ← Panduan deploy lengkap
│   └── ubuntu-setup.sh        ← Script automated
├── ecosystem.config.js        ← PM2 config
├── package.json
├── .env.example
└── README.md
```

---

## 🔑 Akses Default

Selepas `npm run init-db`:

| Field    | Value       |
|----------|-------------|
| Username | `admin`     |
| Password | `admin123`  |

⚠️ **WAJIB tukar password** selepas pemasangan:
```bash
npm run create-admin
# Pilih 'r' untuk reset password
```

---

## 📋 Skrip NPM

| Command                    | Fungsi                                    |
|----------------------------|-------------------------------------------|
| `npm start`                | Run production mode                       |
| `npm run dev`              | Run dev mode dengan nodemon (auto-reload) |
| `npm run init-db`          | Cipta schema database + admin default     |
| `npm run import-excel -- file.xlsx` | Import data dari Excel           |
| `npm run create-admin`     | Cipta atau reset admin user (interactive) |

---

## ⚙️ Konfigurasi (.env)

| Key             | Default             | Fungsi                                |
|-----------------|---------------------|---------------------------------------|
| `NODE_ENV`      | `production`        | Mode aplikasi                         |
| `PORT`          | `3000`              | Port Express                          |
| `TZ`            | `Asia/Kuala_Lumpur` | Timezone (penting!)                   |
| `DB_HOST`       | `localhost`         | Host PostgreSQL                       |
| `DB_PORT`       | `5432`              | Port PostgreSQL                       |
| `DB_NAME`       | `tempahan_db`       | Nama database                         |
| `DB_USER`       | `tempahan_user`     | User PostgreSQL                       |
| `DB_PASSWORD`   | —                   | Password PostgreSQL                   |
| `SESSION_SECRET`| —                   | Random string (48+ char)              |
| `JWT_SECRET`    | —                   | Random string (48+ char)              |

Generate secret:
```bash
openssl rand -base64 48
```

---

## 🧠 Business Rules

| Peraturan                   | Default     | Configurable? |
|-----------------------------|-------------|---------------|
| Maks tempahan ke hadapan    | 30 hari     | ✅ (settings) |
| Maks hari unik / guru / bln | 2 hari      | ✅ (settings + override per guru) |
| Tempahan Sabtu/Ahad         | ❌ Disabled | ❌            |
| Tempahan tarikh lepas       | ❌ Disabled | ❌            |
| Slot rehat/solat            | ❌ Disabled | ✅ (disabled_slots) |
| Conflict detection          | Overlap     | —             |

### Mode Had Bulanan

Setting `HAD_MODE`:
- `UNIQUE_DATE` *(default)* — kira **hari unik** sahaja. Guru boleh tempah berbilang slot pada hari yang sama, dan ia dikira sebagai 1 hari.
- `SLOT` — kira setiap slot. Guru tempah 3 slot pada hari yang sama = 3 sesi.

### Override per Guru

Setiap guru boleh ada `had_tempahan_bulanan` sendiri (override default). Berguna untuk guru penting yang perlu lebih banyak akses.

---

## 🔌 API Endpoints

### Public API (`/api/*`)

| Method | Path                       | Fungsi                              |
|--------|----------------------------|-------------------------------------|
| GET    | `/teachers`                | Senarai guru                        |
| GET    | `/classes`                 | Senarai kelas                       |
| GET    | `/subjects`                | Senarai subjek                      |
| GET    | `/initial?date=YYYY-MM-DD` | Initial data (1 panggilan)          |
| GET    | `/jadual?date=`            | Jadual + events untuk tarikh        |
| GET    | `/jadual-guru?teacher=&date=` | Jadual mengajar guru              |
| GET    | `/status-sekarang`         | Status bilik live                   |
| GET    | `/statistik`               | Statistik bulanan                   |
| GET    | `/tempahan-saya?teacher=`  | Tempahan akan datang oleh guru      |
| GET    | `/tempahan?date=`          | Tempahan untuk tarikh               |
| POST   | `/tempahan/pdp`            | Tempah PdPc (multi-slot)            |
| POST   | `/tempahan/umum`           | Tempah Umum                         |
| POST   | `/tempahan/batal`          | Batalkan tempahan                   |

### Admin API (`/api/admin/*`) — JWT required

CRUD penuh untuk semua entiti. Lihat `backend/src/routes/admin.js` untuk senarai lengkap.

---

## 🛡️ Keselamatan

- ✅ Password admin di-hash dengan bcrypt (cost 10)
- ✅ JWT token (8 jam expiry)
- ✅ Rate limit pada `/api/admin/login` (5 percubaan / 15 minit)
- ✅ Helmet (security headers)
- ✅ Helmet CSP-friendly
- ✅ CORS configured
- ✅ SQL injection-safe (parameterized queries)
- ✅ XSS-safe (escapeHtml semua output)
- ✅ Race-condition safe (PostgreSQL advisory lock)

---

## 📜 Lesen

Proprietary — © byzaifuan.com & SABK Maahad Al Khair Lil Banat

Untuk pertanyaan tentang penggunaan komersial atau pelesenan kepada sekolah lain, sila hubungi melalui [byzaifuan.com](https://byzaifuan.com).

---

## 👨‍💻 Dibangunkan Oleh

**Mohamad Zaifuan Bin Zulkaflee** ([@zaifuan](https://github.com/zaifuan))
Guru SABK Maahad Al Khair Lil Banat — di-port dari Google Apps Script original kepada Node.js untuk performance, ownership, dan kebolehan-perluasan.

---

> 💡 **Tips Production**: Buat backup harian database. Pasang [UptimeRobot](https://uptimerobot.com) atau sejenisnya untuk monitor uptime. Pasang [BetterStack](https://betterstack.com) untuk log aggregation kalau nak lebih advanced.
