const { google } = require('googleapis');
const { query, transaction } = require('../db');
const { normalizeTimeFormat, parseMasa, isNamaSesuai } = require('../utils/time');

function getSheetsClient() {
  if (!process.env.SHEET_ID) throw new Error('SHEET_ID belum ada dalam .env');
  if (!process.env.GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY belum ada dalam .env');

  return google.sheets({
    version: 'v4',
    auth: process.env.GOOGLE_API_KEY
  });
}

async function getRows(tabName) {
  const sheets = getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: "'" + tabName + "'!A:Z"
  });

  return res.data.values || [];
}

async function syncGuru() {
  const tabName = process.env.SHEET_TAB_GURU || 'SENARAI GURU';
  const rows = await getRows(tabName);

  let count = 0;

  for (let i = 1; i < rows.length; i++) {
    const guru = String(rows[i][0] || '').trim();
    const singkatan = String(rows[i][1] || '').trim();

    if (!guru) continue;

    await query(
      `
      INSERT INTO teachers (nama, singkatan, aktif)
      VALUES ($1, $2, TRUE)
      ON CONFLICT (nama)
      DO UPDATE SET
        singkatan = EXCLUDED.singkatan,
        aktif = TRUE
      `,
      [guru, singkatan || guru]
    );

    count++;
  }

  return count;
}

async function syncJadualGuru() {
  const tabName = process.env.SHEET_TAB_JADUAL || 'JADUAL GURU';
  const rows = await getRows(tabName);

  const records = [];
  const kelasSet = new Set();
  const subjekSet = new Set();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];

    const hari = String(r[0] || '').trim().toUpperCase();
    const slot = String(r[1] || '').trim();
    const masaText = normalizeTimeFormat(String(r[2] || '').trim());
    const guru = String(r[3] || '').trim();
    const kelas = String(r[4] || '').trim().toUpperCase();
    const subjek = String(r[5] || '').trim().toUpperCase();

    if (!hari || !masaText || !guru) continue;

    const p = parseMasa(masaText);
    if (!p) {
      console.warn(`Masa tidak sah baris ${i + 1}: ${masaText}`);
      continue;
    }

    if (kelas && kelas !== 'FREE') kelasSet.add(kelas);
    if (subjek) subjekSet.add(subjek);

    records.push({
      hari,
      slot,
      masa: p.masa,
      startMin: p.startMin,
      endMin: p.endMin,
      guru,
      kelas,
      subjek
    });
  }

  const allTeachers = (await query('SELECT id, nama FROM teachers')).rows;

  function findTeacher(name) {
    let t = allTeachers.find(
      x => x.nama.trim().toUpperCase() === name.trim().toUpperCase()
    );
    if (t) return t;

    t = allTeachers.find(x => isNamaSesuai(x.nama, name));
    return t || null;
  }

  await transaction(async (client) => {
    for (const kelas of kelasSet) {
      await client.query(
        `
        INSERT INTO classes (nama_kelas, aktif)
        VALUES ($1, TRUE)
        ON CONFLICT (nama_kelas)
        DO UPDATE SET aktif = TRUE
        `,
        [kelas]
      );
    }

    for (const subjek of subjekSet) {
      await client.query(
        `
        INSERT INTO subjects (kod, aktif)
        VALUES ($1, TRUE)
        ON CONFLICT (kod)
        DO UPDATE SET aktif = TRUE
        `,
        [subjek]
      );
    }

    const allClasses = (await client.query('SELECT id, nama_kelas FROM classes')).rows;
    const allSubjects = (await client.query('SELECT id, kod FROM subjects')).rows;

    await client.query('TRUNCATE teacher_schedule RESTART IDENTITY');

    for (const rec of records) {
      const teacher = findTeacher(rec.guru);
      const kelas = rec.kelas && rec.kelas !== 'FREE'
        ? allClasses.find(c => c.nama_kelas === rec.kelas)
        : null;
      const subject = rec.subjek
        ? allSubjects.find(s => s.kod === rec.subjek)
        : null;

      await client.query(
        `
        INSERT INTO teacher_schedule
          (hari, kelas_id, kelas_name, masa, start_min, end_min,
           teacher_id, teacher_name, subject_id, subject_kod)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `,
        [
          rec.hari,
          kelas ? kelas.id : null,
          rec.kelas || 'FREE',
          rec.masa,
          rec.startMin,
          rec.endMin,
          teacher ? teacher.id : null,
          rec.guru,
          subject ? subject.id : null,
          rec.subjek || null
        ]
      );
    }
  });

  return records.length;
}

async function syncGoogleSheet() {
  const guru = await syncGuru();
  const jadualGuru = await syncJadualGuru();

  return {
    ok: true,
    guru,
    jadualGuru
  };
}

module.exports = {
  syncGoogleSheet
};
