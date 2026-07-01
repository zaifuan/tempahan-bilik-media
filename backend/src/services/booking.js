// ============================================================
// services/booking.js — Core booking business logic
// Port dari Code.gs — kekalkan semua peraturan asal
// ============================================================

const crypto = require('crypto');
const { query, transaction } = require('../db');
const { getConfig, getDisabledForHari, isHoliday } = require('./settings');
const {
  normalizeTimeFormat,
  parseMasa,
  isTimeOverlap,
  parseTarikhYMD,
  todayYMD,
  formatToYMD,
  getHariDariTarikh,
  getHariMelayu,
  formatJam12,
  formatMasaRange,
  formatTarikhPapar,
  isNamaSesuai,
  BULAN_PENUH,
  HARI_LIST
} = require('../utils/time');

// ============================================================
// AMBIL TEMPAHAN BAGI TARIKH
// ============================================================
async function getTempahan(tarikhYMD) {
  const res = await query(`
    SELECT
      id, TO_CHAR(tarikh, 'YYYY-MM-DD') AS tarikh,
      hari, masa, start_min AS "startMin", end_min AS "endMin",
      jenis, guru, singkatan, kelas, subjek, tujuan,
      status, session_id AS "sessionId",
      override_by_admin AS "overrideByAdmin",
      EXTRACT(EPOCH FROM created_at) AS "createdAtTs"
    FROM bookings
    WHERE tarikh = $1 AND status = 'TEMPAH'
    ORDER BY start_min, created_at
  `, [tarikhYMD]);
  return res.rows;
}

// ============================================================
// AMBIL JADUAL GURU UNTUK TARIKH
// (auto-detect hari, fuzzy match nama)
// ============================================================
async function getJadualGuruTarikh(namaGuru, tarikhYMD) {
  const hari = getHariDariTarikh(tarikhYMD);
  if (!hari) {
    return { hari, tarikh: tarikhYMD, isClosed: true, data: [] };
  }

  // Cari guru — exact dahulu, lepas tu fuzzy
  let teacherId = null;
  const exact = await query(
    `SELECT id, nama FROM teachers WHERE UPPER(TRIM(nama)) = UPPER(TRIM($1)) LIMIT 1`,
    [namaGuru]
  );
  if (exact.rows.length) {
    teacherId = exact.rows[0].id;
  } else {
    // Fuzzy: load semua, padankan
    const all = await query(`SELECT id, nama FROM teachers WHERE aktif = TRUE`);
    const match = all.rows.find(g => isNamaSesuai(g.nama, namaGuru));
    if (match) teacherId = match.id;
  }

  if (!teacherId) {
    // Fallback: cari ikut teacher_name snapshot dalam jadual
    const fuzzy = await query(`
      SELECT DISTINCT teacher_name FROM teacher_schedule WHERE hari = $1
    `, [hari]);
    const match = fuzzy.rows.find(r => isNamaSesuai(r.teacher_name, namaGuru));
    if (match) {
      const r = await query(`
        SELECT masa, kelas_name AS kelas, subject_kod AS subjek, start_min AS "startMin", end_min AS "endMin"
        FROM teacher_schedule
        WHERE hari = $1 AND teacher_name = $2
        AND kelas_name IS NOT NULL
        ORDER BY start_min
      `, [hari, match.teacher_name]);
      return { hari, tarikh: tarikhYMD, data: r.rows };
    }
    return { hari, tarikh: tarikhYMD, data: [] };
  }

  const r = await query(`
    SELECT masa, kelas_name AS kelas, subject_kod AS subjek,
           start_min AS "startMin", end_min AS "endMin"
    FROM teacher_schedule
    WHERE hari = $1 AND teacher_id = $2
    AND kelas_name IS NOT NULL
    ORDER BY start_min
  `, [hari, teacherId]);

  return { hari, tarikh: tarikhYMD, data: r.rows };
}

// ============================================================
// JADUAL UNTUK TARIKH — events (booking + disabled)
// ============================================================
async function getJadualTarikh(tarikhYMD) {
  const cfg = await getConfig();
  const hari = getHariDariTarikh(tarikhYMD);

  // Bilik media sentiasa beroperasi: tiada sekatan cuti / hujung minggu.
  const tempahan = await getTempahan(tarikhYMD);

  // Bilik media tiada slot rehat / disabled — papar tempahan sahaja.
  const events = [];

  tempahan.forEach(t => {
    events.push({
      type: 'booking',
      slot: t.masa,
      startMin: t.startMin, endMin: t.endMin,
      status: t.jenis,
      items: [t]
    });
  });

  events.sort((a, b) => {
    if (a.startMin !== b.startMin) return a.startMin - b.startMin;
    return a.type === 'disabled' ? -1 : 1;
  });

  return {
    tarikh: tarikhYMD, hari,
    slots: events,
    tempahan,
    colors: cfg.colors,
    isHoliday: false,
    isWeekend: false
  };
}

// ============================================================
// STATUS BILIK SEKARANG (realtime)
// ============================================================
async function getStatusSekarang() {
  const now = new Date();
  const tarikh = formatToYMD(now);
  const hari = getHariMelayu(now);
  const waktu = now.getHours() * 60 + now.getMinutes();
  const hh = now.getHours();
  const mm = now.getMinutes();
  const period = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 || 12;
  const jam = `${h12}:${String(mm).padStart(2,'0')} ${period}`;

  // Tempahan aktif sekarang
  const tempahan = await getTempahan(tarikh);
  const semasaReal = tempahan.find(t => waktu >= t.startMin && waktu < t.endMin) || null;

  // Operating hours — guna jadual sekolah sebenar
  // Berdasarkan jadual: 7:30 (Jumaat) atau 7:40 (Isnin-Khamis) - 14:30
  const opsMin = hari === 'JUMAAT' ? 7 * 60 + 30 : 7 * 60 + 40;
  const opsMax = hari === 'JUMAAT' ? 12 * 60 + 35 : 14 * 60 + 30;
  const isWeekend = hari === 'AHAD' || hari === 'SABTU';
  const inOps = !isWeekend && waktu >= opsMin && waktu < opsMax;

  return { tarikh, hari, jam, waktu, semasaReal, inOps };
}

// ============================================================
// STATISTIK — siapa sudah / belum masuk (default: bulan semasa)
// boleh pilih bulan & tahun melalui parameter
// ============================================================
async function getStatistik(opts = {}) {
  const now = new Date();
  let bulan = now.getMonth() + 1; // 1-12
  let tahun = now.getFullYear();

  // Parameter pilihan bulan/tahun (1-12 / 4 digit). Fallback ke bulan semasa.
  if (opts.bulan !== undefined && opts.bulan !== null && opts.bulan !== '') {
    const b = Number(opts.bulan);
    if (Number.isInteger(b) && b >= 1 && b <= 12) bulan = b;
  }
  if (opts.tahun !== undefined && opts.tahun !== null && opts.tahun !== '') {
    const t = Number(opts.tahun);
    if (Number.isInteger(t) && t >= 2000 && t <= 2100) tahun = t;
  }

  const bulanLabel = `${BULAN_PENUH[bulan - 1]} ${tahun}`;

  // Guru yang sudah masuk pada bulan/tahun yang dipilih.
  // Sumber: rekod booking (statistik slot TETAP dikira dari rekod sebenar).
  const usedRes = await query(`
    SELECT DISTINCT guru, COUNT(*) AS jumlah_slot
    FROM bookings
    WHERE status = 'TEMPAH'
      AND EXTRACT(MONTH FROM tarikh) = $1
      AND EXTRACT(YEAR FROM tarikh) = $2
    GROUP BY guru
  `, [bulan, tahun]);
  let totalSlots = 0;
  usedRes.rows.forEach(r => { totalSlots += Number(r.jumlah_slot); });

  // Sumber senarai guru = guru AKTIF terkini hasil sync Google Sheet.
  // Guru lama yang sudah dibuang dari Google Sheet (aktif = FALSE)
  // TIDAK akan muncul dalam paparan Rekod, walaupun ada rekod booking lama.
  const semuaRes = await query(`
    SELECT nama FROM teachers WHERE aktif = TRUE ORDER BY nama
  `);
  const semuaGuru = semuaRes.rows.map(r => r.nama);

  // Nama yang ada tempahan pada bulan dipilih (untuk padanan fuzzy).
  const sudahNama = usedRes.rows.map(r => r.guru);

  // Kategorikan — berdasarkan guru aktif terkini sahaja.
  // "Sudah Masuk" = guru aktif yang ada rekod tempahan bulan dipilih.
  // "Belum Masuk" = guru aktif yang tiada rekod tempahan bulan dipilih.
  const sudah = semuaGuru.filter(g =>
    sudahNama.some(s => isNamaSesuai(s, g))
  );
  const belum = semuaGuru.filter(g =>
    !sudahNama.some(s => isNamaSesuai(s, g))
  );

  return {
    bulan: bulan - 1,  // selaras dengan format JS Date (0-11)
    tahun,
    bulanLabel,
    jumlah: totalSlots,
    sudahMasuk: sudah,
    belumMasuk: belum,
    jumlahSudah: sudah.length,
    jumlahBelum: belum.length,
    jumlahGuru: semuaGuru.length
  };
}

// ============================================================
// SEMAK HAD BULANAN — UNIQUE_DATE mode (default per prompt)
// Banyak slot pada hari sama = 1 hari penggunaan
// ============================================================
async function semakHadBulan(namaGuru, tarikhYMD) {
  const cfg = await getConfig();
  if (!cfg.HAD_AKTIF) return { ada: false };

  // Cek override per guru
  const tr = await query(`
    SELECT override_limit FROM teachers
    WHERE UPPER(TRIM(nama)) = UPPER(TRIM($1))
  `, [namaGuru]);
  if (tr.rows.length && tr.rows[0].override_limit) return { ada: false };

  const tObj = parseTarikhYMD(tarikhYMD);
  if (!tObj) return { ada: false };
  const bulan = tObj.getMonth() + 1;
  const tahun = tObj.getFullYear();
  const bulanLabel = `${BULAN_PENUH[bulan - 1]} ${tahun}`;

  // Kira penggunaan ikut MODE
  let rows;
  if (cfg.HAD_MODE === 'SLOT') {
    // Mode lama (ikut sesi) — hitung baris
    const r = await query(`
      SELECT TO_CHAR(tarikh, 'YYYY-MM-DD') AS tarikh, masa
      FROM bookings
      WHERE status = 'TEMPAH'
        AND EXTRACT(MONTH FROM tarikh) = $1
        AND EXTRACT(YEAR FROM tarikh) = $2
        AND override_by_admin = FALSE
      ORDER BY tarikh, start_min
    `, [bulan, tahun]);
    // Filter ikut nama
    rows = r.rows.filter(x => true); // semua, kita filter pakai guru di bawah
    const allBookings = await query(`
      SELECT TO_CHAR(tarikh, 'YYYY-MM-DD') AS tarikh, masa, guru
      FROM bookings
      WHERE status = 'TEMPAH'
        AND EXTRACT(MONTH FROM tarikh) = $1
        AND EXTRACT(YEAR FROM tarikh) = $2
        AND override_by_admin = FALSE
    `, [bulan, tahun]);
    const matched = allBookings.rows.filter(x => isNamaSesuai(x.guru, namaGuru));
    if (matched.length >= cfg.HAD_TEMPAHAN_BULAN) {
      // Tarikh yang sudah ditempah pun dibenarkan tambah slot lagi
      const tarikhSama = matched.some(m => m.tarikh === tarikhYMD);
      if (tarikhSama) return { ada: false };
      return {
        ada: true,
        bilangan: matched.length,
        had: cfg.HAD_TEMPAHAN_BULAN,
        senarai: matched.map(m => ({ tarikh: m.tarikh, masa: m.masa })),
        bulan: bulanLabel
      };
    }
    return { ada: false };
  }

  // UNIQUE_DATE mode (default — ikut prompt)
  const r = await query(`
    SELECT DISTINCT TO_CHAR(tarikh, 'YYYY-MM-DD') AS tarikh, guru
    FROM bookings
    WHERE status = 'TEMPAH'
      AND EXTRACT(MONTH FROM tarikh) = $1
      AND EXTRACT(YEAR FROM tarikh) = $2
      AND override_by_admin = FALSE
  `, [bulan, tahun]);

  // Fuzzy match nama
  const tarikhSet = new Set();
  r.rows.forEach(x => {
    if (isNamaSesuai(x.guru, namaGuru)) tarikhSet.add(x.tarikh);
  });

  // PENTING: jika tarikh yang nak ditempah SUDAH ada dalam set,
  // dia BUKAN hari baru → benarkan tambah slot pada tarikh tersebut
  if (tarikhSet.has(tarikhYMD)) return { ada: false };

  // Jika set sudah penuh, BLOCK
  if (tarikhSet.size >= cfg.HAD_TEMPAHAN_BULAN) {
    return {
      ada: true,
      bilangan: tarikhSet.size,
      had: cfg.HAD_TEMPAHAN_BULAN,
      senarai: [...tarikhSet].sort().map(t => ({ tarikh: t })),
      bulan: bulanLabel,
      mode: 'UNIQUE_DATE'
    };
  }

  return { ada: false };
}

// ============================================================
// SEMAK KONFLIK (overlap masa)
// ============================================================
async function semakKonflik(tarikhYMD, startMin, endMin, client = null) {
  const q = `
    SELECT id, masa, guru, singkatan, jenis
    FROM bookings
    WHERE tarikh = $1
      AND status = 'TEMPAH'
      AND start_min < $3
      AND end_min   > $2
    LIMIT 1
  `;
  const res = client
    ? await client.query(q, [tarikhYMD, startMin, endMin])
    : await query(q, [tarikhYMD, startMin, endMin]);

  if (res.rows.length) {
    const r = res.rows[0];
    return { adaKonflik: true, data: r };
  }
  return { adaKonflik: false };
}

// ============================================================
// VALIDASI ASAS — common rules
// Throw error kalau tak lulus
// ============================================================
async function validasiAsas(payload, cfg, options = {}) {
  const { tarikhYMD, guru, jenis } = payload;
  const { allowOverride = false } = options;

  if (!tarikhYMD) throw new Error('Tarikh tidak diberikan.');

  const hari = getHariDariTarikh(tarikhYMD);
  if (!hari)
    throw new Error('Tarikh tidak sah.');

  if (!allowOverride) {
    const today = parseTarikhYMD(todayYMD());
    const tObj = parseTarikhYMD(tarikhYMD);
    if (!tObj || tObj < today)
      throw new Error('Tidak boleh membuat tempahan untuk tarikh yang telah lepas.');

    const maxDate = parseTarikhYMD(todayYMD());
    maxDate.setDate(maxDate.getDate() + cfg.MAX_BOOKING_DAY);
    if (tObj > maxDate)
      throw new Error(`Tempahan hanya dibenarkan sehingga ${cfg.MAX_BOOKING_DAY} hari ke hadapan.`);
  }

  // Bilik media boleh ditempah pada hari cuti — tiada sekatan cuti.

  if (!guru || !String(guru).trim())
    throw new Error('Nama guru tidak diberikan.');

  // Semak guru wujud & aktif
  const tr = await query(`
    SELECT id, nama, singkatan, aktif FROM teachers
    WHERE UPPER(TRIM(nama)) = UPPER(TRIM($1))
    LIMIT 1
  `, [guru]);
  if (tr.rows.length) {
    if (!tr.rows[0].aktif) throw new Error('Guru ini tidak aktif. Hubungi admin.');
  }

  return { hari, teacher: tr.rows[0] || null };
}

// ============================================================
// BUAT TEMPAHAN UMUM (time range bebas)
// ============================================================
async function buatTempahanUmum(payload, options = {}) {
  const cfg = await getConfig();
  const { tarikhYMD, masa, guru, singkatan, tujuan } = payload;
  const { byAdmin = false, overrideReason = null, createdBy = 'guru' } = options;

  const { hari, teacher } = await validasiAsas(
    { tarikhYMD, guru, jenis: 'UMUM' }, cfg, { allowOverride: byAdmin }
  );

  if (!masa) throw new Error('Masa tidak diberikan.');
  if (!tujuan || !String(tujuan).trim()) throw new Error('Tujuan penggunaan wajib diisi.');

  const p = parseMasa(masa);
  if (!p) throw new Error('Format masa tidak sah.');
  if (p.startMin >= p.endMin) throw new Error('Masa tamat mesti selepas masa mula.');

  // Bilik media tiada waktu rehat / solat — tiada sekatan slot.

  // Had bulanan (hanya untuk guru biasa, bukan admin override)
  if (!byAdmin) {
    const had = await semakHadBulan(guru, tarikhYMD);
    if (had.ada) {
      const senarai = had.senarai.map((t, i) =>
        `${i + 1}. ${t.tarikh}${t.masa ? ' (' + t.masa + ')' : ''}`).join('\n');
      const err = new Error(
        `${guru} sudah mencapai had ${had.had} hari penggunaan bulan ${had.bulan}.\n\n` +
        `Hari yang sudah ditempah:\n${senarai}`
      );
      err.code = 'HAD_BULAN';
      throw err;
    }
  }

  // Transaction: lock + check conflict + insert
  return await transaction(async (client) => {
    // Advisory lock untuk elak race condition
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [tarikhYMD]);

    const konflik = await semakKonflik(tarikhYMD, p.startMin, p.endMin, client);
    if (konflik.adaKonflik) {
      throw new Error(`Slot bertindih dengan ${konflik.data.singkatan || konflik.data.guru} (${konflik.data.masa}). Pilih masa lain.`);
    }

    const sing = singkatan || (teacher && teacher.singkatan) || String(guru).split(' ')[0];
    const sessionId = crypto.randomUUID();

    const ins = await client.query(`
      INSERT INTO bookings
        (tarikh, hari, masa, start_min, end_min, jenis,
         teacher_id, guru, singkatan,
         kelas, subjek, tujuan,
         status, session_id, override_by_admin, override_reason, created_by)
      VALUES ($1, $2, $3, $4, $5, 'UMUM',
              $6, $7, $8,
              '', '', $9,
              'TEMPAH', $10, $11, $12, $13)
      RETURNING id
    `, [
      tarikhYMD, hari, p.masa, p.startMin, p.endMin,
      teacher ? teacher.id : null, guru, sing,
      String(tujuan).trim(),
      sessionId, byAdmin, overrideReason, createdBy
    ]);

    await client.query(`
      INSERT INTO booking_logs (booking_id, action, by_user, reason, payload)
      VALUES ($1, $2, $3, $4, $5)
    `, [ins.rows[0].id, 'CREATE', createdBy, overrideReason,
        JSON.stringify({ tarikh: tarikhYMD, masa: p.masa, jenis: 'UMUM', tujuan })]);

    const tglLabel = formatTarikhPapar(tarikhYMD);
    return {
      ok: true,
      bookingId: ins.rows[0].id,
      sessionId,
      message: `✅ Tempahan berjaya! ${tglLabel}, ${formatMasaRange(p.masa)}.`
    };
  });
}

// ============================================================
// BUAT TEMPAHAN PDP (multi-slot dalam 1 sesi)
// ============================================================
async function buatTempahanPDP(payload, options = {}) {
  const cfg = await getConfig();
  const { tarikhYMD, guru, singkatan, slots } = payload;
  const { byAdmin = false, overrideReason = null, createdBy = 'guru' } = options;

  const { hari, teacher } = await validasiAsas(
    { tarikhYMD, guru, jenis: 'PDP' }, cfg, { allowOverride: byAdmin }
  );

  if (!Array.isArray(slots) || !slots.length)
    throw new Error('Tiada slot dipilih.');

  // Had bulanan
  if (!byAdmin) {
    const had = await semakHadBulan(guru, tarikhYMD);
    if (had.ada) {
      const senarai = had.senarai.map((t, i) =>
        `${i + 1}. ${t.tarikh}`).join('\n');
      const err = new Error(
        `${guru} sudah mencapai had ${had.had} hari penggunaan bulan ${had.bulan}.\n\n` +
        `Hari yang sudah ditempah:\n${senarai}`
      );
      err.code = 'HAD_BULAN';
      throw err;
    }
  }

  return await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [tarikhYMD]);

    const sing = singkatan || (teacher && teacher.singkatan) || String(guru).split(' ')[0];
    const sessionId = crypto.randomUUID();

    const berjaya = [];
    const gagal = [];

    // FASA 1: validate & detect conflicts
    const validSlots = [];
    for (const slot of slots) {
      const masaNorm = normalizeTimeFormat(slot.masa);
      const p = parseMasa(masaNorm);

      if (!p) {
        gagal.push({ masa: masaNorm, kelas: slot.kelas || '', sebab: 'Format masa tidak sah' });
        continue;
      }

      // Bilik media tiada waktu rehat / solat — tiada sekatan slot.

      const konflik = await semakKonflik(tarikhYMD, p.startMin, p.endMin, client);
      if (konflik.adaKonflik) {
        const k = konflik.data;
        gagal.push({
          masa: masaNorm,
          kelas: slot.kelas || '',
          sebab: `Bertindih dengan ${k.singkatan || k.guru} (${k.masa})`
        });
        continue;
      }

      validSlots.push({ ...slot, masaNorm, p });
    }

    // FASA 2: insert semua yang valid
    for (const slot of validSlots) {
      const ins = await client.query(`
        INSERT INTO bookings
          (tarikh, hari, masa, start_min, end_min, jenis,
           teacher_id, guru, singkatan,
           kelas, subjek, tujuan,
           status, session_id, override_by_admin, override_reason, created_by)
        VALUES ($1, $2, $3, $4, $5, 'PDP',
                $6, $7, $8,
                $9, $10, '',
                'TEMPAH', $11, $12, $13, $14)
        RETURNING id
      `, [
        tarikhYMD, hari, slot.masaNorm, slot.p.startMin, slot.p.endMin,
        teacher ? teacher.id : null, guru, sing,
        slot.kelas || '', slot.subjek || '',
        sessionId, byAdmin, overrideReason, createdBy
      ]);
      berjaya.push({ id: ins.rows[0].id, masa: slot.masaNorm, kelas: slot.kelas || '' });

      await client.query(`
        INSERT INTO booking_logs (booking_id, action, by_user, reason, payload)
        VALUES ($1, $2, $3, $4, $5)
      `, [ins.rows[0].id, 'CREATE', createdBy, overrideReason,
          JSON.stringify({ tarikh: tarikhYMD, masa: slot.masaNorm, jenis: 'PDP', kelas: slot.kelas, subjek: slot.subjek, sessionId })]);
    }

    if (berjaya.length === 0) {
      const gagalMsg = gagal.map(g => `• ${g.masa}${g.kelas ? ' | ' + g.kelas : ''}: ${g.sebab}`).join('\n');
      const err = new Error(`Tiada slot berjaya ditempah.\n\nSlot gagal:\n${gagalMsg}`);
      err.gagal = gagal;
      throw err;
    }

    return {
      ok: true,
      sessionId,
      message: `✅ ${berjaya.length} slot berjaya ditempah.${gagal.length ? ' (' + gagal.length + ' slot gagal)' : ''}`,
      jumlahBerjaya: berjaya.length,
      jumlahGagal: gagal.length,
      berjaya,
      gagal
    };
  });
}

// ============================================================
// BATAL TEMPAHAN
// ============================================================
async function batalTempahan(tarikhYMD, masa, namaGuru, options = {}) {
  const { byAdmin = false, createdBy = 'guru', reason = null } = options;
  const masaNorm = normalizeTimeFormat(masa);

  // Cari rekod
  const r = await query(`
    SELECT id, guru FROM bookings
    WHERE tarikh = $1 AND masa = $2 AND status = 'TEMPAH'
    ORDER BY created_at DESC
  `, [tarikhYMD, masaNorm]);

  if (!r.rows.length) {
    throw new Error('Rekod tidak dijumpai atau sudah dibatal.');
  }

  // Fuzzy match nama (untuk guna pengguna biasa)
  let target = null;
  if (byAdmin) {
    target = r.rows[0];
  } else {
    target = r.rows.find(row => isNamaSesuai(row.guru, namaGuru));
  }
  if (!target) throw new Error('Rekod tidak dijumpai atau bukan tempahan anda.');

  await transaction(async (client) => {
    await client.query(`UPDATE bookings SET status = 'BATAL' WHERE id = $1`, [target.id]);
    await client.query(`
      INSERT INTO booking_logs (booking_id, action, by_user, reason)
      VALUES ($1, 'CANCEL', $2, $3)
    `, [target.id, createdBy, reason]);
  });

  return { ok: true, message: '✅ Tempahan berjaya dibatalkan.', bookingId: target.id };
}

// ============================================================
// TEMPAHAN SAYA — akan datang sahaja
// ============================================================
async function getTempahanSaya(namaGuru) {
  const today = todayYMD();
  // Exact + fuzzy: ambil semua bookings teacher tu (case-insensitive guru col),
  // lepas tu filter dengan isNamaSesuai
  const all = await query(`
    SELECT id, TO_CHAR(tarikh, 'YYYY-MM-DD') AS tarikh, hari, masa,
           jenis, guru, kelas, subjek, tujuan, status
    FROM bookings
    WHERE status = 'TEMPAH' AND tarikh >= $1
    ORDER BY tarikh, start_min
  `, [today]);

  const data = all.rows.filter(r => isNamaSesuai(r.guru, namaGuru));
  return data;
}

// ============================================================
// INITIAL DATA — satu call untuk semua
// ============================================================
async function getInitialData(tarikhYMD) {
  const tarikh = tarikhYMD || todayYMD();
  const cfg = await getConfig();

  const [guruRes, jadual, statistik, status] = await Promise.all([
    query(`SELECT nama, singkatan FROM teachers WHERE aktif = TRUE ORDER BY nama`),
    getJadualTarikh(tarikh),
    getStatistik(),
    getStatusSekarang()
  ]);

  return {
    settings: {
      SCHOOL_NAME: cfg.SCHOOL_NAME,
      ROOM_NAME: cfg.ROOM_NAME,
      SCHOOL_LOGO_URL: cfg.SCHOOL_LOGO_URL,
      MAX_BOOKING_DAY: cfg.MAX_BOOKING_DAY,
      AUTO_REFRESH: cfg.AUTO_REFRESH,
      HAD_TEMPAHAN_BULAN: cfg.HAD_TEMPAHAN_BULAN,
      HAD_MODE: cfg.HAD_MODE,
      disabledBiasa: cfg.disabledBiasa.map(d => d.masa),
      disabledJumaat: cfg.disabledJumaat.map(d => d.masa),
      holidays: cfg.holidays,
      colors: cfg.colors
    },
    guru: guruRes.rows,
    jadual,
    statistik,
    status
  };
}

module.exports = {
  getTempahan,
  getJadualGuruTarikh,
  getJadualTarikh,
  getStatusSekarang,
  getStatistik,
  semakHadBulan,
  semakKonflik,
  buatTempahanUmum,
  buatTempahanPDP,
  batalTempahan,
  getTempahanSaya,
  getInitialData
};
