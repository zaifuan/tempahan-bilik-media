#!/usr/bin/env node
// ============================================================
// scripts/import-excel.js — Import data dari Excel ke PostgreSQL
//
// Cara guna:
//   node scripts/import-excel.js path/ke/fail.xlsx
//   atau
//   npm run import-excel -- path/ke/fail.xlsx
//
// Excel yang dijangka (struktur sama dengan Google Sheet asal):
//   - Sheet "SENARAI GURU"   : GURU | SINGKATAN
//   - Sheet "JADUAL KELAS"   : HARI | KELAS | MASA | NAMA GURU | SUBJEK
//   - Sheet "SETTINGS"       : JENIS | HARI | MASA | KETERANGAN (REHAT/SOLAT)
//   - Sheet "TEMPAHAN_DB"    : (optional) data tempahan lama
// ============================================================

require('dotenv').config();
process.env.TZ = process.env.TZ || 'Asia/Kuala_Lumpur';

const path = require('path');
const XLSX = require('xlsx');
const { pool, query, transaction } = require('../backend/src/db');
const {
  normalizeTimeFormat, parseMasa, parseMasaJadual,
  normalizeTarikh, isNamaSesuai
} = require('../backend/src/utils/time');

const filePath = process.argv[2];
if (!filePath) {
  console.error('❌ Sila beri path ke fail Excel.\n   Contoh: node scripts/import-excel.js ./data.xlsx');
  process.exit(1);
}

(async () => {
  console.log(`📂 Membaca: ${filePath}`);
  const wb = XLSX.readFile(path.resolve(filePath), { cellDates: true });
  console.log(`   Sheets: ${wb.SheetNames.join(', ')}`);

  // ──────────────────────────────────────────────────────────
  // 1. SENARAI GURU
  // ──────────────────────────────────────────────────────────
  const guruSheet = wb.Sheets['SENARAI GURU'];
  if (!guruSheet) { console.error('❌ Sheet "SENARAI GURU" tiada.'); process.exit(1); }
  const guruRows = XLSX.utils.sheet_to_json(guruSheet, { header: 1, defval: '' });
  console.log(`\n▶ SENARAI GURU: ${guruRows.length - 1} baris`);

  let guruInserted = 0;
  for (let i = 1; i < guruRows.length; i++) {
    const r = guruRows[i];
    const nama = String(r[0] || '').trim();
    const sing = String(r[1] || '').trim();
    if (!nama || nama.toUpperCase() === 'GURU' || nama.toUpperCase() === 'NAMA') continue;
    try {
      await query(`
        INSERT INTO teachers (nama, singkatan, aktif)
        VALUES ($1, $2, TRUE)
        ON CONFLICT (nama) DO UPDATE SET singkatan = EXCLUDED.singkatan, aktif = TRUE
      `, [nama, sing || nama.split(' ')[0]]);
      guruInserted++;
    } catch (e) {
      console.warn(`   ⚠ ${nama}: ${e.message}`);
    }
  }
  console.log(`   ✓ ${guruInserted} guru berjaya import.`);

  // ──────────────────────────────────────────────────────────
  // 2. JADUAL KELAS
  // ──────────────────────────────────────────────────────────
  const jSheet = wb.Sheets['JADUAL KELAS'];
  if (!jSheet) { console.warn('⚠ Sheet "JADUAL KELAS" tiada — langkau.'); }
  else {
    const jRows = XLSX.utils.sheet_to_json(jSheet, { header: 1, defval: '' });
    console.log(`\n▶ JADUAL KELAS: ${jRows.length - 1} baris`);

    // Kosongkan jadual sedia ada
    await query('TRUNCATE teacher_schedule RESTART IDENTITY');

    // Kumpul kelas & subjek unik untuk auto-insert
    const kelasSet = new Set();
    const subjekSet = new Set();
    const records = [];

    for (let i = 1; i < jRows.length; i++) {
      const r = jRows[i];
      const hari   = String(r[0] || '').trim().toUpperCase();
      const kelas  = String(r[1] || '').trim();
      const masa   = normalizeTimeFormat(String(r[2] || '').trim());
      const guru   = String(r[3] || '').trim();
      const subjek = String(r[4] || '').trim().toUpperCase();

      if (!hari || !kelas || !masa) continue;
      const p = parseMasaJadual(masa);   // betulkan slot petang 12-jam → 24-jam
      if (!p) { console.warn(`   ⚠ Baris ${i + 1}: masa "${r[2]}" tidak sah`); continue; }

      kelasSet.add(kelas);
      if (subjek) subjekSet.add(subjek);
      records.push({ hari, kelas, masa: p.masa, startMin: p.startMin, endMin: p.endMin, guru, subjek });
    }

    // Insert classes
    for (const k of kelasSet) {
      await query(`
        INSERT INTO classes (nama_kelas, aktif) VALUES ($1, TRUE)
        ON CONFLICT (nama_kelas) DO NOTHING
      `, [k]);
    }
    console.log(`   ✓ ${kelasSet.size} kelas unik`);

    // Insert subjects
    for (const s of subjekSet) {
      await query(`
        INSERT INTO subjects (kod, aktif) VALUES ($1, TRUE)
        ON CONFLICT (kod) DO NOTHING
      `, [s]);
    }
    console.log(`   ✓ ${subjekSet.size} subjek unik`);

    // Load teachers untuk fuzzy match
    const allTeachers = (await query(`SELECT id, nama, singkatan FROM teachers`)).rows;
    const allClasses  = (await query(`SELECT id, nama_kelas FROM classes`)).rows;
    const allSubjects = (await query(`SELECT id, kod FROM subjects`)).rows;

    function findTeacher(name) {
      // Exact dahulu
      let t = allTeachers.find(x => x.nama.trim().toUpperCase() === name.trim().toUpperCase());
      if (t) return t;
      // Fuzzy
      t = allTeachers.find(x => isNamaSesuai(x.nama, name));
      return t || null;
    }

    // Insert schedules (batch)
    let inserted = 0;
    let unmatchedTeachers = new Set();
    await transaction(async (client) => {
      for (const rec of records) {
        const teacher = findTeacher(rec.guru);
        const kelas   = allClasses.find(c => c.nama_kelas === rec.kelas);
        const subject = rec.subjek ? allSubjects.find(s => s.kod === rec.subjek) : null;

        if (!teacher) unmatchedTeachers.add(rec.guru);

        await client.query(`
          INSERT INTO teacher_schedule
            (hari, kelas_id, kelas_name, masa, start_min, end_min,
             teacher_id, teacher_name, subject_id, subject_kod)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `, [
          rec.hari,
          kelas ? kelas.id : null, rec.kelas,
          rec.masa, rec.startMin, rec.endMin,
          teacher ? teacher.id : null, rec.guru,
          subject ? subject.id : null, rec.subjek
        ]);
        inserted++;
      }
    });
    console.log(`   ✓ ${inserted} baris jadual disisipkan.`);
    if (unmatchedTeachers.size > 0) {
      console.log(`   ⚠ ${unmatchedTeachers.size} nama guru dalam jadual tidak match dengan SENARAI GURU:`);
      [...unmatchedTeachers].forEach(n => console.log(`      - ${n}`));
      console.log(`      (Rekod tetap disimpan dengan teacher_name snapshot — pakai fuzzy lookup di runtime)`);
    }
  }

  // ──────────────────────────────────────────────────────────
  // 3. SETTINGS (REHAT / SOLAT)
  // ──────────────────────────────────────────────────────────
  const sSheet = wb.Sheets['SETTINGS'];
  if (sSheet) {
    const sRows = XLSX.utils.sheet_to_json(sSheet, { header: 1, defval: '' });
    console.log(`\n▶ SETTINGS: ${sRows.length - 1} baris`);

    // Clear existing disabled slots
    await query('TRUNCATE disabled_slots RESTART IDENTITY');

    let disInserted = 0;
    for (let i = 1; i < sRows.length; i++) {
      const r = sRows[i];
      const jenis     = String(r[0] || '').trim().toUpperCase();
      const hari_type = String(r[1] || '').trim().toUpperCase();
      const masa      = normalizeTimeFormat(String(r[2] || '').trim());
      const ket       = String(r[3] || '').trim();

      if (!['REHAT','SOLAT'].includes(jenis)) continue;
      const p = parseMasa(masa);
      if (!p) continue;

      await query(`
        INSERT INTO disabled_slots (jenis, hari_type, masa, start_min, end_min, keterangan, aktif)
        VALUES ($1,$2,$3,$4,$5,$6,TRUE)
      `, [jenis, hari_type, p.masa, p.startMin, p.endMin,
          ket || (jenis === 'SOLAT' ? 'Solat Jumaat' : 'Waktu Rehat')]);
      disInserted++;
    }
    console.log(`   ✓ ${disInserted} disabled slots`);
  }

  // ──────────────────────────────────────────────────────────
  // 4. TEMPAHAN_DB (optional — migrate data lama)
  // ──────────────────────────────────────────────────────────
  const tSheet = wb.Sheets['TEMPAHAN_DB'];
  if (tSheet) {
    const tRows = XLSX.utils.sheet_to_json(tSheet, { header: 1, defval: '' });
    console.log(`\n▶ TEMPAHAN_DB: ${tRows.length - 1} baris`);

    let booksInserted = 0;
    for (let i = 1; i < tRows.length; i++) {
      const r = tRows[i];
      if (!r[0]) continue;

      const tarikh = normalizeTarikh(r[1]);
      const hari   = String(r[2] || '').trim().toUpperCase();
      const masa   = normalizeTimeFormat(String(r[3] || '').trim());
      const jenis  = String(r[4] || 'PDP').trim().toUpperCase();
      const guru   = String(r[5] || '').trim();
      const sing   = String(r[6] || '').trim();
      const kelas  = String(r[7] || '').trim();
      const subjek = String(r[8] || '').trim();
      const tujuan = String(r[9] || '').trim();
      const status = String(r[10] || 'TEMPAH').trim().toUpperCase();

      if (!tarikh || !masa || !guru) continue;
      const p = parseMasa(masa);
      if (!p) continue;
      if (!['PDP','UMUM'].includes(jenis)) continue;

      try {
        await query(`
          INSERT INTO bookings (
            tarikh, hari, masa, start_min, end_min, jenis,
            guru, singkatan, kelas, subjek, tujuan, status, created_by
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'migrated')
          ON CONFLICT DO NOTHING
        `, [
          tarikh, hari, p.masa, p.startMin, p.endMin, jenis,
          guru, sing || guru.split(' ')[0],
          kelas, subjek, tujuan, status
        ]);
        booksInserted++;
      } catch (e) {
        console.warn(`   ⚠ Baris ${i + 1}: ${e.message}`);
      }
    }
    console.log(`   ✓ ${booksInserted} tempahan lama dimigrasi.`);
  }

  // ──────────────────────────────────────────────────────────
  // Selesai
  // ──────────────────────────────────────────────────────────
  console.log(`\n✅ Import selesai!`);
  await pool.end();
  process.exit(0);
})().catch(e => {
  console.error('❌ Ralat:', e.message);
  console.error(e.stack);
  process.exit(1);
});
