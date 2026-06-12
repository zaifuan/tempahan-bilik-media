// ============================================================
// services/settings.js — Settings & config (cached)
// ============================================================

const { query } = require('../db');
const { normalizeTimeFormat, parseMasa } = require('../utils/time');

let cache = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60_000; // 60 saat — selaras dengan GAS asal

function castValue(value, dataType) {
  switch (dataType) {
    case 'int':  return Number(value) || 0;
    case 'bool': return String(value).toLowerCase() === 'true';
    case 'json':
      try { return JSON.parse(value); } catch { return null; }
    default: return value;
  }
}

async function getConfig(force = false) {
  if (!force && cache && Date.now() < cacheExpiry) return cache;

  // 1. Settings KV
  const setRes = await query('SELECT key, value, data_type FROM settings');
  const set = {};
  setRes.rows.forEach(r => { set[r.key] = castValue(r.value, r.data_type); });

  // 2. Disabled slots (REHAT, SOLAT)
  const disRes = await query(`
    SELECT jenis, hari_type, masa, start_min, end_min, keterangan
    FROM disabled_slots WHERE aktif = TRUE
    ORDER BY start_min
  `);
  const disabledBiasa = [];
  const disabledJumaat = [];
  const disabledLabels = {};
  disRes.rows.forEach(r => {
    const masa = normalizeTimeFormat(r.masa);
    disabledLabels[masa] = r.keterangan ||
      (r.jenis === 'SOLAT' ? 'Solat Jumaat' : 'Waktu Rehat');
    if (r.hari_type === 'JUMAAT' || String(r.hari_type).includes('JUMAAT')) {
      disabledJumaat.push({ masa, startMin: r.start_min, endMin: r.end_min, keterangan: r.keterangan });
    } else {
      disabledBiasa.push({ masa, startMin: r.start_min, endMin: r.end_min, keterangan: r.keterangan });
    }
  });

  // 3. Holidays
  const holRes = await query(`
    SELECT TO_CHAR(tarikh, 'YYYY-MM-DD') AS tarikh, label
    FROM holidays WHERE aktif = TRUE
  `);
  const holidays = holRes.rows.map(r => r.tarikh);
  const holidayLabels = {};
  holRes.rows.forEach(r => { holidayLabels[r.tarikh] = r.label; });

  cache = {
    SCHOOL_NAME: set.SCHOOL_NAME || 'SABK Maahad Al Khair Lil Banat',
    ROOM_NAME: set.ROOM_NAME || 'BILIK MEDIA',
    SCHOOL_LOGO_URL: set.SCHOOL_LOGO_URL || '',
    MAX_BOOKING_DAY: Number(set.MAX_BOOKING_DAY) || 30,
    AUTO_REFRESH: Number(set.AUTO_REFRESH) || 60,
    HAD_TEMPAHAN_BULAN: Number(set.HAD_TEMPAHAN_BULAN) || 2,
    HAD_AKTIF: set.HAD_AKTIF === true || set.HAD_AKTIF === 'true',
    HAD_MODE: set.HAD_MODE || 'UNIQUE_DATE',
    BLOCK_REST_TIME: set.BLOCK_REST_TIME === true || set.BLOCK_REST_TIME === 'true',
    colors: {
      PDP: set.COLOR_PDP || '#4ade80',
      UMUM: set.COLOR_UMUM || '#fbbf24',
      DISABLED: set.COLOR_DISABLED || '#f1f5f9'
    },
    disabledBiasa,
    disabledJumaat,
    disabledLabels,
    holidays,
    holidayLabels
  };
  cacheExpiry = Date.now() + CACHE_TTL_MS;
  return cache;
}

function clearCache() {
  cache = null;
  cacheExpiry = 0;
}

function getDisabledForHari(cfg, hari) {
  if (hari === 'JUMAAT') return cfg.disabledJumaat;
  return cfg.disabledBiasa;
}

function isHoliday(tarikhYMD, cfg) {
  return cfg.holidays.includes(tarikhYMD);
}

async function setSetting(key, value, dataType = 'string') {
  await query(`
    INSERT INTO settings (key, value, data_type, updated_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (key) DO UPDATE SET value = $2, data_type = $3, updated_at = NOW()
  `, [key, String(value), dataType]);
  clearCache();
}

module.exports = {
  getConfig,
  clearCache,
  getDisabledForHari,
  isHoliday,
  setSetting
};
