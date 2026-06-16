// ============================================================
// routes/admin.js � Admin API (authenticated)
// ============================================================

const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const { syncGoogleSheet } = require('../services/googleSheetSync');

const { query, transaction } = require('../db');
const { signToken, requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const booking = require('../services/booking');
const settings = require('../services/settings');
const { parseMasa, todayYMD } = require('../utils/time');

// ============================================================
// LOGIN
// ============================================================
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.json({ ok: false, error: 'Username & password diperlukan.' });

    const r = await query(`
      SELECT id, username, password_hash, nama_penuh, role, aktif
      FROM admin_users WHERE username = $1
    `, [username]);

    if (!r.rows.length) return res.json({ ok: false, error: 'Username atau password salah.' });
    const u = r.rows[0];
    if (!u.aktif) return res.json({ ok: false, error: 'Akaun tidak aktif.' });

    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.json({ ok: false, error: 'Username atau password salah.' });

    await query(`UPDATE admin_users SET last_login = NOW() WHERE id = $1`, [u.id]);

    const token = signToken({
      id: u.id, username: u.username, role: u.role, nama: u.nama_penuh
    });

    res.json({
      ok: true,
      token,
      admin: {
        id: u.id,
        username: u.username,
        role: u.role,
        nama: u.nama_penuh
      }
    });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ============================================================
// SEMUA ROUTE DI BAWAH MEMERLUKAN AUTH
// ============================================================
router.use(requireAdmin);

// ============================================================
// PROFILE / VERIFY TOKEN
// ============================================================
router.get('/me', (req, res) => {
  res.json({ ok: true, admin: req.admin });
});

// ============================================================
// DASHBOARD STATS
// ============================================================
router.get('/dashboard', async (req, res) => {
  try {
    const today = todayYMD();
    const [tg, kg, jl, tnow, tbb, sd, log] = await Promise.all([
      query(`SELECT COUNT(*) AS n FROM teachers WHERE aktif = TRUE`),
      query(`SELECT COUNT(*) AS n FROM classes WHERE aktif = TRUE`),
      query(`SELECT COUNT(*) AS n FROM teacher_schedule`),
      query(`SELECT COUNT(*) AS n FROM bookings WHERE status = 'TEMPAH' AND tarikh = $1`, [today]),
      query(`
        SELECT COUNT(*) AS n FROM bookings
        WHERE status = 'TEMPAH'
        AND EXTRACT(MONTH FROM tarikh) = EXTRACT(MONTH FROM NOW())
        AND EXTRACT(YEAR FROM tarikh) = EXTRACT(YEAR FROM NOW())
      `),
      query(`SELECT COUNT(*) AS n FROM disabled_slots WHERE aktif = TRUE`),
      query(`
        SELECT bl.action, bl.by_user, bl.reason, bl.at, b.guru, b.masa,
               TO_CHAR(b.tarikh, 'YYYY-MM-DD') AS tarikh
        FROM booking_logs bl
        LEFT JOIN bookings b ON b.id = bl.booking_id
        ORDER BY bl.at DESC LIMIT 10
      `)
    ]);

    res.json({
      ok: true,
      data: {
        totalGuru: Number(tg.rows[0].n),
        totalKelas: Number(kg.rows[0].n),
        totalJadual: Number(jl.rows[0].n),
        tempahanHariIni: Number(tnow.rows[0].n),
        tempahanBulanIni: Number(tbb.rows[0].n),
        slotDitutup: Number(sd.rows[0].n),
        recentLogs: log.rows
      }
    });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ============================================================
// GURU CRUD
// ============================================================
router.get('/teachers', async (req, res) => {
  try {
    const r = await query(`
      SELECT id, nama, singkatan, no_telefon, aktif, override_limit, created_at
      FROM teachers ORDER BY nama
    `);
    res.json({ ok: true, data: r.rows });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.post('/teachers', async (req, res) => {
  try {
    const { nama, singkatan, no_telefon, aktif = true } = req.body;
    if (!nama || !singkatan) return res.json({ ok: false, error: 'Nama & singkatan wajib.' });

    const r = await query(`
      INSERT INTO teachers (nama, singkatan, no_telefon, aktif)
      VALUES ($1, $2, $3, $4) RETURNING id
    `, [String(nama).trim(), String(singkatan).trim(), no_telefon || null, aktif]);

    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.put('/teachers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nama, singkatan, no_telefon, aktif, override_limit } = req.body;

    await query(`
      UPDATE teachers
      SET nama = COALESCE($2, nama),
          singkatan = COALESCE($3, singkatan),
          no_telefon = $4,
          aktif = COALESCE($5, aktif),
          override_limit = COALESCE($6, override_limit)
      WHERE id = $1
    `, [id, nama, singkatan, no_telefon, aktif, override_limit]);

    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.delete('/teachers/:id', async (req, res) => {
  try {
    await query(`UPDATE teachers SET aktif = FALSE WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ============================================================
// KELAS CRUD
// ============================================================
router.get('/classes', async (req, res) => {
  const r = await query(`SELECT * FROM classes ORDER BY nama_kelas`);
  res.json({ ok: true, data: r.rows });
});

router.post('/classes', async (req, res) => {
  try {
    const { nama_kelas, tingkatan, aktif = true } = req.body;
    if (!nama_kelas) return res.json({ ok: false, error: 'Nama kelas wajib.' });

    const r = await query(`
      INSERT INTO classes (nama_kelas, tingkatan, aktif)
      VALUES ($1, $2, $3) RETURNING id
    `, [String(nama_kelas).trim(), tingkatan || null, aktif]);

    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.put('/classes/:id', async (req, res) => {
  try {
    const { nama_kelas, tingkatan, aktif } = req.body;

    await query(`
      UPDATE classes SET
        nama_kelas = COALESCE($2, nama_kelas),
        tingkatan = $3,
        aktif = COALESCE($4, aktif)
      WHERE id = $1
    `, [req.params.id, nama_kelas, tingkatan, aktif]);

    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.delete('/classes/:id', async (req, res) => {
  try {
    await query(`UPDATE classes SET aktif = FALSE WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ============================================================
// SUBJEK CRUD
// ============================================================
router.get('/subjects', async (req, res) => {
  const r = await query(`SELECT * FROM subjects ORDER BY kod`);
  res.json({ ok: true, data: r.rows });
});

router.post('/subjects', async (req, res) => {
  try {
    const { kod, nama, aktif = true } = req.body;
    if (!kod) return res.json({ ok: false, error: 'Kod wajib.' });

    const r = await query(`
      INSERT INTO subjects (kod, nama, aktif)
      VALUES ($1, $2, $3) RETURNING id
    `, [String(kod).trim().toUpperCase(), nama || null, aktif]);

    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.put('/subjects/:id', async (req, res) => {
  try {
    const { kod, nama, aktif } = req.body;

    await query(`
      UPDATE subjects SET
        kod = COALESCE($2, kod), nama = $3, aktif = COALESCE($4, aktif)
      WHERE id = $1
    `, [req.params.id, kod, nama, aktif]);

    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.delete('/subjects/:id', async (req, res) => {
  await query(`UPDATE subjects SET aktif = FALSE WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

// ============================================================
// JADUAL KELAS / GURU
// ============================================================
router.get('/schedule', async (req, res) => {
  try {
    const { hari, teacher_id, kelas_id } = req.query;
    const where = [];
    const params = [];

    if (hari) {
      params.push(hari);
      where.push(`hari = $${params.length}`);
    }

    if (teacher_id) {
      params.push(teacher_id);
      where.push(`teacher_id = $${params.length}`);
    }

    if (kelas_id) {
      params.push(kelas_id);
      where.push(`kelas_id = $${params.length}`);
    }

    const q = `
      SELECT id, hari, kelas_id, kelas_name, masa, start_min, end_min,
             teacher_id, teacher_name, subject_id, subject_kod
      FROM teacher_schedule
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY
        CASE hari
          WHEN 'ISNIN' THEN 1 WHEN 'SELASA' THEN 2 WHEN 'RABU' THEN 3
          WHEN 'KHAMIS' THEN 4 WHEN 'JUMAAT' THEN 5 ELSE 9 END,
        start_min, kelas_name
    `;

    const r = await query(q, params);
    res.json({ ok: true, data: r.rows });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.post('/schedule', async (req, res) => {
  try {
    const { hari, kelas_id, kelas_name, masa, teacher_id, teacher_name, subject_id, subject_kod } = req.body;
    const p = parseMasa(masa);

    if (!p) return res.json({ ok: false, error: 'Format masa tidak sah.' });

    const r = await query(`
      INSERT INTO teacher_schedule
        (hari, kelas_id, kelas_name, masa, start_min, end_min,
         teacher_id, teacher_name, subject_id, subject_kod)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id
    `, [
      String(hari).toUpperCase(), kelas_id || null, kelas_name || null,
      p.masa, p.startMin, p.endMin,
      teacher_id || null, teacher_name || null,
      subject_id || null, subject_kod || null
    ]);

    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.put('/schedule/:id', async (req, res) => {
  try {
    const { hari, kelas_id, kelas_name, masa, teacher_id, teacher_name, subject_id, subject_kod } = req.body;
    const p = masa ? parseMasa(masa) : null;

    await query(`
      UPDATE teacher_schedule SET
        hari = COALESCE($2, hari),
        kelas_id = $3, kelas_name = $4,
        masa = COALESCE($5, masa),
        start_min = COALESCE($6, start_min),
        end_min = COALESCE($7, end_min),
        teacher_id = $8, teacher_name = $9,
        subject_id = $10, subject_kod = $11
      WHERE id = $1
    `, [
      req.params.id,
      hari ? String(hari).toUpperCase() : null,
      kelas_id, kelas_name,
      p ? p.masa : null, p ? p.startMin : null, p ? p.endMin : null,
      teacher_id, teacher_name, subject_id, subject_kod
    ]);

    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.delete('/schedule/:id', async (req, res) => {
  await query(`DELETE FROM teacher_schedule WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

// ============================================================
// TEMPAHAN
// ============================================================
router.get('/bookings', async (req, res) => {
  try {
    const { from, to, teacher, jenis, status } = req.query;
    const where = [];
    const params = [];

    if (from) {
      params.push(from);
      where.push(`tarikh >= $${params.length}`);
    }

    if (to) {
      params.push(to);
      where.push(`tarikh <= $${params.length}`);
    }

    if (jenis) {
      params.push(jenis);
      where.push(`jenis = $${params.length}`);
    }

    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }

    if (teacher) {
      params.push('%' + teacher + '%');
      where.push(`guru ILIKE $${params.length}`);
    }

    const q = `
      SELECT id, TO_CHAR(tarikh, 'YYYY-MM-DD') AS tarikh,
             hari, masa, start_min, end_min, jenis,
             guru, singkatan, kelas, subjek, tujuan,
             status, override_by_admin, override_reason,
             created_by, created_at
      FROM bookings
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY tarikh DESC, start_min
      LIMIT 500
    `;

    const r = await query(q, params);
    res.json({ ok: true, data: r.rows });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Admin force create PDP
router.post('/bookings/pdp', async (req, res) => {
  try {
    const result = await booking.buatTempahanPDP(req.body, {
      byAdmin: true,
      overrideReason: req.body.overrideReason || 'Admin manual',
      createdBy: 'admin:' + req.admin.username
    });

    res.json(result);
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Admin force create UMUM
router.post('/bookings/umum', async (req, res) => {
  try {
    const result = await booking.buatTempahanUmum(req.body, {
      byAdmin: true,
      overrideReason: req.body.overrideReason || 'Admin manual',
      createdBy: 'admin:' + req.admin.username
    });

    res.json(result);
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Admin cancel single booking by ID
router.post('/bookings/:id/cancel', async (req, res) => {
  try {
    const { reason } = req.body;
    const bookingId = Number(req.params.id);

    if (!Number.isInteger(bookingId)) {
      return res.json({ ok: false, error: 'ID tempahan tidak sah.' });
    }

    let cancelledId = null;

// UPDATE terus (auto-commit). Log ditulis SELEPAS itu secara best-effort,
    // supaya kegagalan menulis log TIDAK rollback kemaskini status.
    const r = await query(`
      UPDATE bookings
      SET status = 'BATAL'
      WHERE id = $1 AND status = 'TEMPAH'
      RETURNING id
    `, [bookingId]);

    if (!r.rows.length) {
      return res.json({ ok: false, error: 'Rekod tidak dijumpai atau sudah dibatal.' });
    }

    cancelledId = r.rows[0].id;

    try {
      await query(`
        INSERT INTO booking_logs (booking_id, action, by_user, reason)
        VALUES ($1, 'CANCEL', $2, $3)
      `, [
        cancelledId,
        'admin:' + (req.admin && req.admin.username ? req.admin.username : 'unknown'),
        reason || ''
      ]);
    } catch (logErr) {
      console.error('booking_logs INSERT gagal (diabaikan):', logErr.message);
    }
    res.json({
      ok: true,
      message: 'Tempahan berjaya dibatalkan.',
      bookingId: cancelledId
    });
  } catch (e) {
    console.error('CANCEL ERROR:', e);
    res.json({ ok: false, error: e.message });
  }
});
// Admin bulk cancel booking by ID
router.post('/bookings/bulk-cancel', async (req, res) => {
  try {
    const { ids, reason } = req.body;

    if (!Array.isArray(ids) || !ids.length) {
      return res.json({ ok: false, error: 'Tiada ID dipilih.' });
    }

    const cleanIds = ids
      .map(id => Number(id))
      .filter(id => Number.isInteger(id));

    if (!cleanIds.length) {
      return res.json({ ok: false, error: 'Tiada ID tempahan yang sah.' });
    }

    let cancelledIds = [];

// UPDATE terus tanpa updated_at (elak ralat jika kolum tiada).
    const r = await query(`
      UPDATE bookings
      SET status = 'BATAL'
      WHERE id = ANY($1::int[]) AND status = 'TEMPAH'
      RETURNING id
    `, [cleanIds]);

    cancelledIds = r.rows.map(row => row.id);

    for (const bookingId of cancelledIds) {
      try {
        await query(`
          INSERT INTO booking_logs (booking_id, action, by_user, reason)
          VALUES ($1, 'CANCEL', $2, $3)
        `, [
          bookingId,
          'admin:' + (req.admin && req.admin.username ? req.admin.username : 'unknown'),
          reason || ''
        ]);
      } catch (logErr) {
        console.error('booking_logs INSERT gagal (diabaikan):', logErr.message);
      }
    }

    const success = cancelledIds.length;
    const fail = cleanIds.length - success;

    res.json({
      ok: true,
      message: success + ' berjaya dibatalkan' + (fail ? ', ' + fail + ' gagal atau sudah dibatal' : '') + '.',
      success,
      fail,
      cancelledIds
    });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ============================================================
// SETTINGS
// ============================================================
router.get('/settings', async (req, res) => {
  try {
    const r = await query(`SELECT key, value, data_type, description FROM settings ORDER BY key`);
    res.json({ ok: true, data: r.rows });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.put('/settings/:key', async (req, res) => {
  try {
    const { value, data_type } = req.body;
    await settings.setSetting(req.params.key, value, data_type || 'string');
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ============================================================
// AKAUN SAYA — kemaskini username & password admin yang log masuk
// UI ringkas (sekolah hanya ada seorang pentadbir).
// Hanya menyentuh rekod admin SEMASA; logik login/auth tidak diubah.
// Guna mekanisme hash sedia ada (bcrypt cost 10).
// ============================================================
router.put('/account', async (req, res) => {
  try {
    const id = req.admin.id;
    const username = (req.body.username || '').trim();
    const password = req.body.password || '';

    if (!username) {
      return res.json({ ok: false, error: 'Username diperlukan.' });
    }

    // Pastikan username tidak bertembung dengan admin lain
    const dup = await query(
      `SELECT id FROM admin_users WHERE username = $1 AND id <> $2`,
      [username, id]
    );
    if (dup.rows.length) {
      return res.json({ ok: false, error: 'Username sudah digunakan.' });
    }

    if (password) {
      if (password.length < 6) {
        return res.json({ ok: false, error: 'Password minimum 6 aksara.' });
      }
      const hash = await bcrypt.hash(password, 10);
      await query(
        `UPDATE admin_users SET username = $2, password_hash = $3 WHERE id = $1`,
        [id, username, hash]
      );
    } else {
      // Password kosong → kemaskini username sahaja
      await query(
        `UPDATE admin_users SET username = $2 WHERE id = $1`,
        [id, username]
      );
    }

    res.json({ ok: true, username });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ============================================================
// DISABLED SLOTS
// ============================================================
router.get('/disabled-slots', async (req, res) => {
  const r = await query(`SELECT * FROM disabled_slots ORDER BY hari_type, start_min`);
  res.json({ ok: true, data: r.rows });
});

router.post('/disabled-slots', async (req, res) => {
  try {
    const { jenis, hari_type, masa, keterangan, aktif = true } = req.body;
    const p = parseMasa(masa);

    if (!p) return res.json({ ok: false, error: 'Format masa tidak sah.' });

    const r = await query(`
      INSERT INTO disabled_slots (jenis, hari_type, masa, start_min, end_min, keterangan, aktif)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id
    `, [jenis, hari_type, p.masa, p.startMin, p.endMin, keterangan, aktif]);

    settings.clearCache();
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.put('/disabled-slots/:id', async (req, res) => {
  try {
    const { jenis, hari_type, masa, keterangan, aktif } = req.body;
    const p = masa ? parseMasa(masa) : null;

    await query(`
      UPDATE disabled_slots SET
        jenis = COALESCE($2, jenis),
        hari_type = COALESCE($3, hari_type),
        masa = COALESCE($4, masa),
        start_min = COALESCE($5, start_min),
        end_min = COALESCE($6, end_min),
        keterangan = $7,
        aktif = COALESCE($8, aktif)
      WHERE id = $1
    `, [
      req.params.id,
      jenis,
      hari_type,
      p ? p.masa : null,
      p ? p.startMin : null,
      p ? p.endMin : null,
      keterangan,
      aktif
    ]);

    settings.clearCache();
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.delete('/disabled-slots/:id', async (req, res) => {
  await query(`DELETE FROM disabled_slots WHERE id = $1`, [req.params.id]);
  settings.clearCache();
  res.json({ ok: true });
});

// ============================================================
// CUTI / HOLIDAYS
// ============================================================
router.get('/holidays', async (req, res) => {
  const r = await query(`
    SELECT id, TO_CHAR(tarikh, 'YYYY-MM-DD') AS tarikh, label, aktif
    FROM holidays ORDER BY tarikh
  `);

  res.json({ ok: true, data: r.rows });
});

router.post('/holidays', async (req, res) => {
  try {
    const { tarikh, label, aktif = true } = req.body;

    if (!tarikh || !label) {
      return res.json({ ok: false, error: 'Tarikh & label wajib.' });
    }

    const r = await query(`
      INSERT INTO holidays (tarikh, label, aktif) VALUES ($1, $2, $3) RETURNING id
    `, [tarikh, label, aktif]);

    settings.clearCache();
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.delete('/holidays/:id', async (req, res) => {
  await query(`DELETE FROM holidays WHERE id = $1`, [req.params.id]);
  settings.clearCache();
  res.json({ ok: true });
});

// ============================================================
// ADMIN USERS
// ============================================================
router.get('/admins', requireSuperAdmin, async (req, res) => {
  const r = await query(`
    SELECT id, username, nama_penuh, role, aktif, last_login, created_at
    FROM admin_users ORDER BY username
  `);

  res.json({ ok: true, data: r.rows });
});

router.post('/admins', requireSuperAdmin, async (req, res) => {
  try {
    const { username, password, nama_penuh, role = 'admin' } = req.body;

    if (!username || !password) {
      return res.json({ ok: false, error: 'Username & password wajib.' });
    }

    const hash = await bcrypt.hash(password, 10);

    const r = await query(`
      INSERT INTO admin_users (username, password_hash, nama_penuh, role)
      VALUES ($1, $2, $3, $4) RETURNING id
    `, [username, hash, nama_penuh, role]);

    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.put('/admins/:id/password', async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (id !== req.admin.id && req.admin.role !== 'superadmin') {
      return res.status(403).json({ ok: false, error: 'Tidak dibenarkan.' });
    }

    const { password } = req.body;

    if (!password || password.length < 6) {
      return res.json({ ok: false, error: 'Password minimum 6 aksara.' });
    }

    const hash = await bcrypt.hash(password, 10);
    await query(`UPDATE admin_users SET password_hash = $2 WHERE id = $1`, [id, hash]);

    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.delete('/admins/:id', requireSuperAdmin, async (req, res) => {
  await query(`UPDATE admin_users SET aktif = FALSE WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

// ============================================================
// CACHE CLEAR
// ============================================================
router.post('/cache/clear', (req, res) => {
  settings.clearCache();
  res.json({ ok: true, message: 'Cache dibersihkan.' });
});

module.exports = router;

// Manual sync Google Sheet
router.post('/sync/google-sheet', async (req, res) => {
  try {
    const result = await syncGoogleSheet();

    res.json({
      success: true,
      message: 'Sync Google Sheet berjaya',
      data: result
    });
  } catch (err) {
    console.error('Sync Google Sheet gagal:', err);

    res.status(500).json({
      success: false,
      message: 'Sync Google Sheet gagal',
      error: err.message
    });
  }
});
