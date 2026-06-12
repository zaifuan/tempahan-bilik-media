// ============================================================
// utils/time.js — Time & Date helpers
// Port dari GAS asal — KEKALKAN format & behavior yang sama
// ============================================================

const HARI_LIST = ['AHAD','ISNIN','SELASA','RABU','KHAMIS','JUMAAT','SABTU'];

const BULAN_PENUH = [
  'Januari','Februari','Mac','April','Mei','Jun',
  'Julai','Ogos','September','Oktober','November','Disember'
];

const BULAN_PENDEK = ['Jan','Feb','Mac','Apr','Mei','Jun','Jul','Ogs','Sep','Okt','Nov','Dis'];

// Piawai semua format masa → "HH:MM-HH:MM"
// Input: "10.10-10.40" | "10:10 - 10:40" → Output: "10:10-10:40"
function normalizeTimeFormat(str) {
  if (!str) return '';
  return String(str).replace(/\./g, ':').replace(/\s*-\s*/g, '-').trim();
}

function timeStrToMin(t) {
  if (!t) return NaN;
  const p = String(t).trim().split(':');
  return Number(p[0]) * 60 + Number(p[1] || 0);
}

// Parse "HH:MM-HH:MM" → { startStr, endStr, startMin, endMin }
function parseMasa(masaStr) {
  if (!masaStr) return null;
  const norm = normalizeTimeFormat(masaStr);
  const parts = norm.split('-');
  if (parts.length !== 2) return null;
  const sMin = timeStrToMin(parts[0]);
  const eMin = timeStrToMin(parts[1]);
  if (isNaN(sMin) || isNaN(eMin)) return null;
  return {
    startStr: parts[0].trim(),
    endStr: parts[1].trim(),
    startMin: sMin,
    endMin: eMin,
    masa: norm
  };
}

// true = kedua-dua julat masa bertindih
function isTimeOverlap(s1, e1, s2, e2) {
  return s1 < e2 && s2 < e1;
}

// Date → "YYYY-MM-DD"
function formatToYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// "YYYY-MM-DD" → Date (iOS/Safari safe — JANGAN guna new Date(str))
function parseTarikhYMD(str) {
  if (!str || !str.includes('-')) return null;
  const [y, m, d] = String(str).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// Handle format lama DD/MM/YYYY atau baru YYYY-MM-DD
function parseTarikhFlexible(str) {
  if (!str) return null;
  if (String(str).indexOf('-') === 4) return parseTarikhYMD(str);
  if (String(str).includes('/')) {
    const [d, m, y] = String(str).split('/').map(Number);
    return new Date(y, m - 1, d);
  }
  return null;
}

function normalizeTarikh(val) {
  if (!val && val !== 0) return null;
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? null : formatToYMD(val);
  }
  const d = parseTarikhFlexible(String(val).trim());
  return d ? formatToYMD(d) : null;
}

// "YYYY-MM-DD" → hari Melayu (ISNIN, SELASA, ...)
function getHariDariTarikh(tarikhYMD) {
  const d = parseTarikhYMD(tarikhYMD);
  if (!d) return '';
  return HARI_LIST[d.getDay()];
}

function getHariMelayu(date) {
  return HARI_LIST[date.getDay()];
}

function normalizeHari(s) {
  if (!s) return '';
  const map = { isnin:'ISNIN',selasa:'SELASA',rabu:'RABU',khamis:'KHAMIS',jumaat:'JUMAAT',ahad:'AHAD',sabtu:'SABTU' };
  return map[String(s).toLowerCase().trim()] || String(s).toUpperCase().trim();
}

// Add days to YYYY-MM-DD → YYYY-MM-DD
function addDaysYMD(tarikhYMD, n) {
  const d = parseTarikhYMD(tarikhYMD);
  if (!d) return tarikhYMD;
  d.setDate(d.getDate() + n);
  return formatToYMD(d);
}

// Today in YYYY-MM-DD (in server TZ)
function todayYMD() {
  return formatToYMD(new Date());
}

// Format tarikh untuk paparan: "Selasa, 26 Mei 2026"
function formatTarikhPapar(tarikhYMD) {
  const d = parseTarikhYMD(tarikhYMD);
  if (!d) return tarikhYMD;
  const hari = getHariDariTarikh(tarikhYMD);
  const labelHari = hari.charAt(0) + hari.slice(1).toLowerCase();
  return `${labelHari}, ${d.getDate()} ${BULAN_PENUH[d.getMonth()]} ${d.getFullYear()}`;
}

// Format jam 12-jam: "8:30 AM"
function formatJam12(timeStr) {
  if (!timeStr) return '-';
  const parts = String(timeStr).trim().split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1] || 0);
  if (isNaN(h) || isNaN(m)) return timeStr;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2,'0')} ${period}`;
}

// Format julat: "8:00 AM – 2:30 PM"
function formatMasaRange(rangeStr) {
  if (!rangeStr) return '-';
  const norm = normalizeTimeFormat(rangeStr);
  const parts = norm.split('-');
  if (parts.length !== 2) return rangeStr;
  return `${formatJam12(parts[0])} – ${formatJam12(parts[1])}`;
}

// Fuzzy match nama guru — port dari GAS
function normNama(nama) {
  return String(nama || '').trim().toUpperCase()
    .replace(/\bBINTI\b|\bBINT\b|\bBTE\b|\bBT\.?\b/g, '')
    .replace(/\bBIN\b|\bB\.\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNamaSesuai(namaA, namaB) {
  if (!namaA || !namaB) return false;
  const a = String(namaA).trim().toUpperCase();
  const b = String(namaB).trim().toUpperCase();
  if (a === b) return true;

  const an = normNama(a);
  const bn = normNama(b);
  if (an === bn) return true;

  if (an.length >= 3 && bn.startsWith(an)) return true;
  if (bn.length >= 3 && an.startsWith(bn)) return true;

  const aWords = an.split(' ').filter(w => w.length > 2);
  const bWords = bn.split(' ').filter(w => w.length > 2);
  if (!aWords.length || !bWords.length) return false;
  const common = aWords.filter(w => bWords.includes(w));
  const minLen = Math.min(aWords.length, bWords.length);
  return common.length >= (minLen <= 1 ? 1 : 2);
}

module.exports = {
  HARI_LIST,
  BULAN_PENUH,
  BULAN_PENDEK,
  normalizeTimeFormat,
  timeStrToMin,
  parseMasa,
  isTimeOverlap,
  formatToYMD,
  parseTarikhYMD,
  parseTarikhFlexible,
  normalizeTarikh,
  getHariDariTarikh,
  getHariMelayu,
  normalizeHari,
  addDaysYMD,
  todayYMD,
  formatTarikhPapar,
  formatJam12,
  formatMasaRange,
  normNama,
  isNamaSesuai
};
