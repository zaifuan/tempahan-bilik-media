#!/usr/bin/env node
/**
 * fix-masa-petang.js — PEMULIHAN DATA SATU KALI untuk `teacher_schedule`.
 *
 * MASALAH:
 *   Slot petang dalam JADUAL KELAS tersimpan sebagai PAGI selepas import.
 *   Contoh:  "1:00-1:30"  start_min=60  end_min=90   (sepatutnya 13:00-13:30 = 780/810)
 *            "12:30-1:00" start_min=750 end_min=60    (sepatutnya 12:30-13:00 = 750/780)
 *   Punca: masa petang ditulis 12-jam ("1:00") dan disimpan sebagai 01:00.
 *   NOTA: paparan (formatMasa12Jam) adalah BETUL — yang rosak ialah DATA.
 *
 * PERATURAN (sekolah TIDAK beroperasi 00:00–06:59):
 *   Mana-mana komponen masa SEBELUM 07:00 (minit < 420) dianggap petang → +12 jam.
 *   'start' dan 'end' dinilai BERASINGAN supaya slot rentas-tengah hari seperti
 *   "12:30–01:00" turut betul → "12:30–13:00".
 *   Padan dengan diagnostik:  WHERE start_min < 420 OR end_min < 420.
 *
 * GUNA:
 *   node scripts/fix-masa-petang.js            # DRY-RUN — papar sahaja, TIADA perubahan
 *   node scripts/fix-masa-petang.js --apply    # laksanakan pembetulan
 *
 * Jalankan DRY-RUN dahulu dan semak senarai sebelum guna --apply.
 */
const { query, pool } = require('../backend/src/db');

const APPLY = process.argv.includes('--apply');
const BATAS = 420; // 07:00 — tiada kelas sebelum ini

const hhmm = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// Komponen sebelum 07:00 → petang (+12 jam). Selainnya kekal.
const fixMin = (min) => (min < BATAS ? min + 720 : min);

(async () => {
  try {
    console.log(
      APPLY
        ? '== MOD: APPLY — data teacher_schedule AKAN diubah ==\n'
        : '== MOD: DRY-RUN — tiada perubahan. Guna --apply untuk laksanakan. ==\n'
    );

    const { rows } = await query(
      `SELECT id, masa, start_min, end_min
         FROM teacher_schedule
        WHERE start_min < $1 OR end_min < $1
        ORDER BY id`,
      [BATAS]
    );

    console.log(`Jumlah baris perlu disemak: ${rows.length}\n`);

    let changed = 0;
    for (const r of rows) {
      const ns = fixMin(r.start_min);
      const ne = fixMin(r.end_min);
      if (ns === r.start_min && ne === r.end_min) continue; // tiada perubahan
      const newMasa = `${hhmm(ns)}-${hhmm(ne)}`;
      changed++;
      console.log(
        `  [#${r.id}] "${r.masa}" (${r.start_min}/${r.end_min}) -> "${newMasa}" (${ns}/${ne})`
      );
      if (APPLY) {
        await query(
          `UPDATE teacher_schedule SET masa = $1, start_min = $2, end_min = $3 WHERE id = $4`,
          [newMasa, ns, ne, r.id]
        );
      }
    }

    console.log(
      `\n=> ${changed} baris ${
        APPLY ? 'telah DIKEMASKINI.' : 'akan dibetulkan (dry-run). Jalankan dengan --apply untuk laksanakan.'
      }`
    );

    if (APPLY) {
      const sisa = await query(
        `SELECT COUNT(*)::int AS n FROM teacher_schedule WHERE start_min < $1 OR end_min < $1`,
        [BATAS]
      );
      console.log(`   Semakan selepas: ${sisa.rows[0].n} baris masih < 07:00 (sepatutnya 0).`);
    }
  } catch (e) {
    console.error('Ralat:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
