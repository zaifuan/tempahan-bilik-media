# 📘 PANDUAN PEMASANGAN — Sistem Tempahan Bilik Media

Panduan ini menerangkan cara pasang sistem pada VPS Ubuntu (22.04 atau 24.04).

---

## 🎯 Senarai Semak Pra-Pemasangan

- [ ] VPS Ubuntu 22.04/24.04 dengan akses sudo
- [ ] Nama domain (cth: `tempahan.byzaifuan.com`) yang DNS A record dah point ke IP VPS
- [ ] Fail Excel data jadual asal (dari Google Sheet eksport, atau yang sedia ada)
- [ ] Port 22 (SSH), 80 (HTTP), 443 (HTTPS) terbuka

---

## ⚡ Cara Pantas (Automated)

```bash
# 1. Clone / extract project ke server
cd /opt
sudo git clone <repo-url> sistem-tempahan
sudo chown -R $USER:$USER sistem-tempahan
cd sistem-tempahan

# 2. Run script setup
DOMAIN=tempahan.byzaifuan.com ./deploy/ubuntu-setup.sh
```

Script ini akan setup automatik:
- Node.js 20, PostgreSQL 16, Nginx, PM2, Certbot, UFW firewall
- Database + user dengan password random
- File `.env` dengan secrets random
- Schema database
- Nginx reverse proxy config

Selepas script selesai, ikut langkah dalam output untuk import data + start aplikasi.

---

## 🔧 Cara Manual (Step-by-Step)

### 1. Update sistem & install packages asas

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git build-essential ufw fail2ban
```

### 2. Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # Mesti v20.x.x
npm -v
```

### 3. Install PostgreSQL

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql
psql --version
```

### 4. Cipta database & user

```bash
sudo -u postgres psql
```

Dalam psql:
```sql
CREATE USER tempahan_user WITH PASSWORD 'PASSWORD_KUAT_DI_SINI';
CREATE DATABASE tempahan_db OWNER tempahan_user;
GRANT ALL PRIVILEGES ON DATABASE tempahan_db TO tempahan_user;
ALTER DATABASE tempahan_db SET timezone TO 'Asia/Kuala_Lumpur';
\c tempahan_db
GRANT ALL ON SCHEMA public TO tempahan_user;
\q
```

### 5. Clone project & install dependencies

```bash
cd /opt
sudo git clone <repo-url> sistem-tempahan
sudo chown -R $USER:$USER sistem-tempahan
cd sistem-tempahan
npm install --omit=dev
```

### 6. Setup `.env`

```bash
cp .env.example .env
nano .env
```

Isi nilai berikut:
```env
NODE_ENV=production
PORT=3000
TZ=Asia/Kuala_Lumpur

DB_HOST=localhost
DB_PORT=5432
DB_NAME=tempahan_db
DB_USER=tempahan_user
DB_PASSWORD=PASSWORD_YANG_TADI

# Generate dengan: openssl rand -base64 48
SESSION_SECRET=...
JWT_SECRET=...
```

Selamatkan:
```bash
chmod 600 .env
```

### 7. Init database schema

```bash
npm run init-db
```

Ini akan cipta semua jadual + admin default (`admin` / `admin123`).

### 8. Import data Excel

Letak fail Excel data jadual dalam `/tmp/` atau mana-mana location, kemudian:

```bash
npm run import-excel -- /path/to/SISTEM_TEMPAHAN_BILIK_MEDIA.xlsx
```

Script akan import:
- Sheet **SENARAI GURU** → 48 guru
- Sheet **JADUAL KELAS** → kelas + subjek + jadual mengajar (auto-create kelas & subjek)
- Sheet **SETTINGS** → disabled slots (REHAT/SOLAT)
- Sheet **TEMPAHAN_DB** → tempahan sedia ada (kalau ada)

### 9. Tukar password admin (PENTING!)

```bash
npm run create-admin
```

Pilih `r` (reset password) untuk username `admin`, kemudian set password baru yang kuat.

### 10. Install PM2 & start aplikasi

```bash
sudo npm install -g pm2
mkdir -p logs
pm2 start ecosystem.config.js
pm2 save
pm2 startup    # ikut arahan yang dipaparkan (copy-paste command)
```

Semak status:
```bash
pm2 status
pm2 logs tempahan-bilik-media
```

Aplikasi sekarang running di `http://127.0.0.1:3000`. Tapi belum boleh akses dari luar — perlu setup Nginx.

### 11. Setup Nginx

```bash
sudo apt install -y nginx
sudo cp nginx/sistem-tempahan.conf /etc/nginx/sites-available/sistem-tempahan

# Tukar domain dalam fail
sudo nano /etc/nginx/sites-available/sistem-tempahan
# Ganti 'tempahan.byzaifuan.com' dengan domain anda

# Buat dahulu: comment block HTTPS (server { listen 443 ssl... }) dahulu
# Sehingga SSL dipasang. Aktifkan terus proxy dalam block HTTP.

sudo ln -sf /etc/nginx/sites-available/sistem-tempahan /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

Test akses: `http://tempahan.byzaifuan.com` — patut nampak aplikasi.

### 12. Setup SSL (HTTPS)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tempahan.byzaifuan.com

# Ikut prompt — pilih option 2 (redirect HTTP → HTTPS)
```

Certbot akan auto-edit Nginx config untuk include SSL. Auto-renewal sudah aktif by default.

### 13. Firewall (UFW)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

---

## 🔍 Verifikasi Pemasangan

```bash
# Status PostgreSQL
sudo systemctl status postgresql

# Status Nginx
sudo systemctl status nginx

# Status aplikasi
pm2 status
pm2 logs tempahan-bilik-media --lines 50

# Test endpoint
curl http://127.0.0.1:3000/api/teachers   # patut return JSON dengan senarai guru
```

Akses melalui browser:
- **Aplikasi utama**: `https://tempahan.byzaifuan.com`
- **Admin panel**: `https://tempahan.byzaifuan.com/admin`

---

## 🔄 Update / Restart

```bash
cd /opt/sistem-tempahan
git pull                       # kalau guna git
npm install --omit=dev         # kalau ada dependency baru
pm2 restart tempahan-bilik-media
```

---

## 🐛 Troubleshooting

### Error: ECONNREFUSED 127.0.0.1:5432
PostgreSQL tak running:
```bash
sudo systemctl restart postgresql
sudo systemctl status postgresql
```

### Error: relation "teachers" does not exist
Schema belum di-init:
```bash
npm run init-db
```

### Aplikasi tak nampak booking — tapi data sedia ada dalam Excel
Belum import Excel:
```bash
npm run import-excel -- /path/to/file.xlsx
```

### 502 Bad Gateway dari Nginx
Aplikasi tidak running atau bukan di port 3000:
```bash
pm2 status
pm2 logs tempahan-bilik-media
```
Pastikan `PORT=3000` dalam `.env`, dan PM2 telah restart selepas tukar `.env`.

### Login admin tak boleh — "Username atau password salah"
Reset:
```bash
npm run create-admin
# pilih 'r' untuk reset password untuk username 'admin'
```

### Import Excel error — "could not match teacher"
Beberapa nama guru dalam JADUAL KELAS mungkin tak sepadan dengan SENARAI GURU. Script akan papar nama yang gagal — boleh edit Excel atau tambah guru tersebut dalam admin panel kemudian.

---

## 📋 Backup Strategy

Database backup (recommended daily via cron):
```bash
# Backup harian
sudo -u postgres pg_dump tempahan_db > /backup/tempahan_$(date +%Y%m%d).sql

# Tambah dalam crontab (sudo crontab -e):
0 2 * * * sudo -u postgres pg_dump tempahan_db | gzip > /backup/tempahan_$(date +\%Y\%m\%d).sql.gz
```

Restore:
```bash
sudo -u postgres psql tempahan_db < /backup/tempahan_20260101.sql
```

---

## 📞 Sokongan

Sistem ini dibangunkan oleh **byzaifuan** untuk SABK Maahad Al Khair Lil Banat.

Untuk sebarang isu, semak log:
```bash
pm2 logs tempahan-bilik-media
tail -f logs/error.log
sudo tail -f /var/log/nginx/sistem-tempahan-error.log
```
