// ============================================================
// routes/public.js — Public endpoints (untuk guru)
// ============================================================

const express = require('express');
const router = express.Router();
const booking = require('../services/booking');
const { todayYMD } = require('../utils/time');
const { query } = require('../db');

// ── Senarai guru ─────────────────────────────────────────────
router.get('/teachers', async (req, res) => {
  try {
    const r = await query(`
      SELECT nama, singkatan FROM teachers
      WHERE aktif = TRUE ORDER BY nama
    `);
    res.json({ ok: true, data: r.rows });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── Senarai kelas ────────────────────────────────────────────
router.get('/classes', async (req, res) => {
  try {
    const r = await query(`SELECT nama_kelas FROM classes WHERE aktif = TRUE ORDER BY nama_kelas`);
    res.json({ ok: true, data: r.rows });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── Senarai subjek ───────────────────────────────────────────
router.get('/subjects', async (req, res) => {
  try {
    const r = await query(`SELECT kod, nama FROM subjects WHERE aktif = TRUE ORDER BY kod`);
    res.json({ ok: true, data: r.rows });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── Initial data — gabung untuk page load ────────────────────
router.get('/initial', async (req, res) => {
  try {
    const tarikh = req.query.date || todayYMD();
    const data = await booking.getInitialData(tarikh);
    res.json({ ok: true, ...data });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── Jadual untuk tarikh ──────────────────────────────────────
router.get('/jadual', async (req, res) => {
  try {
    const tarikh = req.query.date || todayYMD();
    const data = await booking.getJadualTarikh(tarikh);
    res.json({ ok: true, ...data });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── Jadual guru pada tarikh tertentu ─────────────────────────
router.get('/jadual-guru', async (req, res) => {
  try {
    const { teacher, date } = req.query;
    if (!teacher || !date) {
      return res.json({ ok: false, error: 'Parameter teacher & date diperlukan.' });
    }
    const data = await booking.getJadualGuruTarikh(teacher, date);
    res.json({ ok: true, ...data });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── Status sekarang (realtime) ───────────────────────────────
router.get('/status-sekarang', async (req, res) => {
  try {
    const data = await booking.getStatusSekarang();
    res.json({ ok: true, ...data });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── Statistik bulanan ────────────────────────────────────────
router.get('/statistik', async (req, res) => {
  try {
    const data = await booking.getStatistik();
    res.json({ ok: true, data });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── Tempahan saya ────────────────────────────────────────────
router.get('/tempahan-saya', async (req, res) => {
  try {
    const teacher = req.query.teacher;
    if (!teacher) return res.json({ ok: false, error: 'Parameter teacher diperlukan.' });
    const data = await booking.getTempahanSaya(teacher);
    res.json({ ok: true, data });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── Tempahan: rekod harian ───────────────────────────────────
router.get('/tempahan', async (req, res) => {
  try {
    const tarikh = req.query.date || todayYMD();
    const data = await booking.getTempahan(tarikh);
    res.json({ ok: true, data });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── POST: Buat tempahan PdPc (multi-slot) ────────────────────
router.post('/tempahan/pdp', async (req, res) => {
  try {
    const result = await booking.buatTempahanPDP(req.body, { createdBy: 'guru' });
    res.json(result);
  } catch (e) {
    res.json({
      ok: false,
      error: e.message,
      code: e.code || null,
      gagal: e.gagal || null
    });
  }
});

// ── POST: Buat tempahan Umum ─────────────────────────────────
router.post('/tempahan/umum', async (req, res) => {
  try {
    const result = await booking.buatTempahanUmum(req.body, { createdBy: 'guru' });
    res.json(result);
  } catch (e) {
    res.json({
      ok: false,
      error: e.message,
      code: e.code || null
    });
  }
});

// ── POST: Batal tempahan ─────────────────────────────────────
router.post('/tempahan/batal', async (req, res) => {
  try {
    const { tarikh, masa, guru } = req.body;
    if (!tarikh || !masa || !guru)
      return res.json({ ok: false, error: 'Data tidak lengkap.' });
    const result = await booking.batalTempahan(tarikh, masa, guru, { createdBy: 'guru' });
    res.json(result);
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

module.exports = router;
