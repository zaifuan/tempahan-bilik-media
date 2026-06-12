#!/usr/bin/env node
// ============================================================
// scripts/create-admin.js — Cipta admin baru atau reset password
// ============================================================

require('dotenv').config();
const bcrypt = require('bcrypt');
const readline = require('readline');
const { pool, query } = require('../backend/src/db');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

(async () => {
  console.log('═══════════════════════════════════════════════════');
  console.log('  CIPTA / RESET ADMIN — Sistem Tempahan Bilik Media');
  console.log('═══════════════════════════════════════════════════\n');

  const username = (await ask('Username admin: ')).trim();
  if (!username) { console.error('Username diperlukan.'); process.exit(1); }

  const password = (await ask('Password (min 6 aksara): ')).trim();
  if (password.length < 6) { console.error('Password terlalu pendek.'); process.exit(1); }

  const nama = (await ask('Nama penuh: ')).trim() || username;
  const role = ((await ask('Role (admin/superadmin) [admin]: ')).trim() || 'admin').toLowerCase();

  rl.close();

  const hash = await bcrypt.hash(password, 10);

  try {
    const existing = await query(`SELECT id FROM admin_users WHERE username = $1`, [username]);
    if (existing.rows.length) {
      await query(`
        UPDATE admin_users
        SET password_hash = $2, nama_penuh = $3, role = $4, aktif = TRUE
        WHERE username = $1
      `, [username, hash, nama, role]);
      console.log(`\n✅ Admin "${username}" dikemas kini (password & maklumat baru).`);
    } else {
      await query(`
        INSERT INTO admin_users (username, password_hash, nama_penuh, role, aktif)
        VALUES ($1, $2, $3, $4, TRUE)
      `, [username, hash, nama, role]);
      console.log(`\n✅ Admin "${username}" berjaya dicipta.`);
    }
  } catch (e) {
    console.error('❌ Gagal:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
