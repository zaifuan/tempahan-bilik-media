/* ═══════════════════════════════════════════════════════════
   SISTEM TEMPAHAN BILIK MEDIA — app.js
   v5.0 — Node.js Backend (Express + PostgreSQL)
   ═══════════════════════════════════════════════════════════ */

// ─── CONSTANTS ───────────────────────────────────────────────
const HARI_LIST  = ['ISNIN','SELASA','RABU','KHAMIS','JUMAAT'];
const HARI_LABEL = {ISNIN:'Isnin',SELASA:'Selasa',RABU:'Rabu',KHAMIS:'Khamis',JUMAAT:'Jumaat'};
const BULAN_LABEL= ['','Jan','Feb','Mac','Apr','Mei','Jun','Jul','Ogs','Sep','Okt','Nov','Dis'];
const BULAN_PENUH= ['','Januari','Februari','Mac','April','Mei','Jun','Julai','Ogos','September','Oktober','November','Disember'];

// ─── APP STATE ────────────────────────────────────────────────
const APP = {
  guru          : [],
  guruMap       : {},
  hariHariIni   : '',
  tarikhDipilih : '',
  settings      : null,
  jadualData    : null,
  modal: {
    jenis       : '',
    slotDipilih : [],
    tarikhTarget: '',
  },
  statusTimer   : null,
  refreshTimer  : null,
};

// ═══════════════════════════════════════════════════════════
//  API CLIENT — ganti google.script.run dengan fetch()
// ═══════════════════════════════════════════════════════════
const API = {
  async get(path) {
    try {
      const r = await fetch('/api' + path, { credentials: 'same-origin' });
      const data = await r.json();
      return data;
    } catch (e) {
      return { ok: false, error: 'Ralat sambungan: ' + e.message };
    }
  },
  async post(path, body) {
    try {
      const r = await fetch('/api' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body || {})
      });
      const data = await r.json();
      return data;
    } catch (e) {
      return { ok: false, error: 'Ralat sambungan: ' + e.message };
    }
  },
  // High-level helpers
  getInitialData : (date) => API.get(`/initial?date=${encodeURIComponent(date)}`),
  getJadualTarikh: (date) => API.get(`/jadual?date=${encodeURIComponent(date)}`),
  getJadualGuruTarikh: (guru, date) => API.get(`/jadual-guru?teacher=${encodeURIComponent(guru)}&date=${encodeURIComponent(date)}`),
  getTempahan    : (date) => API.get(`/tempahan?date=${encodeURIComponent(date)}`),
  getStatusSekarang: () => API.get('/status-sekarang'),
  getStatistik   : () => API.get('/statistik'),
  getSenaraGuru  : () => API.get('/teachers'),
  getTempahanSaya: (guru) => API.get(`/tempahan-saya?teacher=${encodeURIComponent(guru)}`),
  buatTempahanPDP: (payload) => API.post('/tempahan/pdp', payload),
  buatTempahanUmum: (payload) => API.post('/tempahan/umum', payload),
  batalTempahan  : (tarikh, masa, guru) => API.post('/tempahan/batal', { tarikh, masa, guru }),
};

// ─── INIT ────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  try {
    APP.tarikhDipilih = getTodayYMD();
    APP.hariHariIni   = getHariDariTarikhJS(APP.tarikhDipilih);
    startClock();
    showLoading('slotGrid');

    const res = await API.getInitialData(APP.tarikhDipilih);
    try {
      if (!res || !res.ok) {
        APP.settings = getDefaultSettings();
        showError('slotGrid', 'Gagal muatkan data. Cuba muat semula halaman.');
        return;
      }
      APP.settings = res.settings || getDefaultSettings();
      if (res.guru && res.guru.length) {
        APP.guru    = res.guru;
        APP.guruMap = {};
        res.guru.forEach(g => { APP.guruMap[g.nama] = g.singkatan; });
        fillGuruSelects();
      }
      initDatePicker();
      if (res.jadual) { APP.jadualData = res.jadual; renderJadual(res.jadual); }
      else { showError('slotGrid', 'Gagal muatkan jadual.'); }
      if (res.statistik) renderStatistik(res.statistik);
      if (res.status && res.status.ok) renderStatusBilik(res.status);
      const sec = (APP.settings?.AUTO_REFRESH || 60) * 1000;
      APP.statusTimer  = setInterval(loadStatusSekarang, sec);
      APP.refreshTimer = setInterval(() => {
        loadJadual(APP.tarikhDipilih);
        loadStatistik();
      }, sec);
    } catch(e) {
      showError('slotGrid', 'Ralat paparan: ' + e.message);
    }
  } catch(e) {
    startClock();
  }
});

// ─── DEFAULT SETTINGS FALLBACK ───────────────────────────────
function getDefaultSettings() {
  return {
    SCHOOL_NAME:'SABK Maahad Al Khair Lil Banat', ROOM_NAME:'BILIK MEDIA',
    MAX_BOOKING_DAY:30, AUTO_REFRESH:60,
    disabledBiasa:['10:40-11:30'], disabledJumaat:['10:15-10:35','12:05-12:35'],
    holidays:[], colors:{PDP:'#4ade80',UMUM:'#fbbf24',DISABLED:'#f1f5f9'}
  };
}

// ─── HELPERS: MASA ───────────────────────────────────────────
function normTime(str) {
  if (!str) return '';
  return String(str).replace(/\./g,':').replace(/\s*-\s*/g,'-').trim();
}
function parseMasaJS(str) {
  if (!str) return null;
  const n = normTime(str).split('-');
  if (n.length!==2) return null;
  const toM = t => { const x=t.trim().split(':'); return Number(x[0])*60+Number(x[1]||0); };
  const s=toM(n[0]), e=toM(n[1]);
  return (isNaN(s)||isNaN(e)) ? null : {s,e};
}
function isOverlapJS(s1,e1,s2,e2) { return s1<e2&&s2<e1; }

function formatMasa12Jam(timeStr) {
  if (!timeStr) return '-';
  const parts = String(timeStr).trim().split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1] || 0);
  if (isNaN(h) || isNaN(m)) return timeStr;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour   = h % 12 || 12;
  return `${hour}:${String(m).padStart(2,'0')} ${period}`;
}
function formatMasaRange(rangeStr) {
  if (!rangeStr) return '-';
  const norm  = normTime(rangeStr);
  const parts = norm.split('-');
  if (parts.length !== 2) return rangeStr;
  return `${formatMasa12Jam(parts[0])} – ${formatMasa12Jam(parts[1])}`;
}

// ─── HELPERS: TARIKH ─────────────────────────────────────────
function getTodayYMD() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
}
function parseTarikhYMD(str) {
  if (!str) return null;
  const [y,m,d] = str.split('-').map(Number);
  return new Date(y, m-1, d);
}
function addDays(tarikhYMD, n) {
  const d = parseTarikhYMD(tarikhYMD);
  d.setDate(d.getDate() + n);
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
}
function getHariDariTarikhJS(tarikhYMD) {
  const d = parseTarikhYMD(tarikhYMD);
  if (!d) return '';
  return ['AHAD','ISNIN','SELASA','RABU','KHAMIS','JUMAAT','SABTU'][d.getDay()];
}
function getHariJS() {
  return ['AHAD','ISNIN','SELASA','RABU','KHAMIS','JUMAAT','SABTU'][new Date().getDay()];
}
function formatTarikhPapar(tarikhYMD) {
  const d = parseTarikhYMD(tarikhYMD);
  if (!d) return tarikhYMD;
  const hari  = HARI_LABEL[getHariDariTarikhJS(tarikhYMD)] || '';
  const tgl   = d.getDate();
  const bln   = BULAN_PENUH[d.getMonth()+1];
  const thn   = d.getFullYear();
  return `${hari}, ${tgl} ${bln} ${thn}`;
}

function isHolidayJS(tarikhYMD) {
  return APP.settings?.holidays?.includes(tarikhYMD) || false;
}
function isDisabledSlotJS(slot, hari) {
  const s   = normTime(slot);
  const cfg = APP.settings || getDefaultSettings();
  if (hari === 'JUMAAT') return (cfg.disabledJumaat||[]).map(normTime).includes(s);
  return (cfg.disabledBiasa||[]).map(normTime).includes(s);
}

// ─── JAM REALTIME ────────────────────────────────────────────
function startClock() {
  const pad = n => String(n).padStart(2, '0');
  const HARI_PENDEK  = ['Ahd','Isn','Sel','Rab','Kha','Jum','Sab'];
  const BULAN_PENDEK = ['Jan','Feb','Mac','Apr','Mei','Jun','Jul','Ogs','Sep','Okt','Nov','Dis'];

  function tick() {
    const now = new Date();
    const el1 = document.getElementById('hJam');
    const el2 = document.getElementById('hTgl');
    if (el1) {
      const h = now.getHours();
      const m = now.getMinutes();
      const period = h >= 12 ? 'PM' : 'AM';
      const h12    = h % 12 || 12;
      el1.textContent = h12 + ':' + pad(m) + ' ' + period;
    }
    if (el2) el2.textContent =
      HARI_PENDEK[now.getDay()] + ', ' +
      now.getDate() + ' ' +
      BULAN_PENDEK[now.getMonth()];
  }
  tick();
  setInterval(tick, 1000);
}

// ─── NAVIGATION ──────────────────────────────────────────────
function showSection(name, btn) {
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('aktif'));
  document.getElementById('sec-'+name).classList.add('active');
  if (btn) btn.classList.add('aktif');
  if (name === 'rekod') loadStatistik();
}

// ─── DATE PICKER ─────────────────────────────────────────────
function initDatePicker() {
  const picker = document.getElementById('datePicker');
  if (!picker) return;
  const today    = getTodayYMD();
  const maxDays  = APP.settings?.MAX_BOOKING_DAY || 30;
  const maxDate  = addDays(today, maxDays);
  picker.min     = today;
  picker.max     = maxDate;
  picker.value   = APP.tarikhDipilih;
  updateDateDisplay();
}

// Buka date picker / kalendar — guna showPicker() jika ada, jika tidak fallback ke focus()+click().
function bukaDatePicker() {
  const picker = document.getElementById('datePicker');
  if (!picker) return;
  try {
    if (typeof picker.showPicker === 'function') picker.showPicker();
    else { picker.focus(); picker.click(); }
  } catch (e) {
    try { picker.focus(); picker.click(); } catch (_) {}
  }
}

function onDatePickerChange() {
  const val = document.getElementById('datePicker')?.value;
  if (!val) return;
  APP.tarikhDipilih = val;
  updateDateDisplay();
  loadJadual(val);
}

function changeDate(offset) {
  const next = addDays(APP.tarikhDipilih, offset);
  const today = getTodayYMD();
  const maxDate = addDays(today, APP.settings?.MAX_BOOKING_DAY||30);
  if (next < today || next > maxDate) return;
  APP.tarikhDipilih = next;
  const picker = document.getElementById('datePicker');
  if (picker) picker.value = next;
  updateDateDisplay();
  loadJadual(next);
}

function setToday() {
  APP.tarikhDipilih = getTodayYMD();
  const picker = document.getElementById('datePicker');
  if (picker) picker.value = APP.tarikhDipilih;
  updateDateDisplay();
  loadJadual(APP.tarikhDipilih);
}

function updateDateDisplay() {
  const el = document.getElementById('dateDisplay');
  if (!el) return;
  const tarikh = APP.tarikhDipilih;
  const hari   = getHariDariTarikhJS(tarikh);
  const isToday = tarikh === getTodayYMD();
  const d      = parseTarikhYMD(tarikh);
  const label  = d
    ? `${HARI_LABEL[hari]||hari}, ${d.getDate()} ${BULAN_LABEL[d.getMonth()+1]}`
    : tarikh;
  el.textContent = label + (isToday ? ' ★' : '');
  el.style.fontWeight = isToday ? '800' : '700';

  const todayBtn = document.getElementById('btnToday');
  if (todayBtn) todayBtn.style.opacity = isToday ? '0.4' : '1';

  const title = document.getElementById('jadualTitle');
  if (title) title.textContent = isToday ? `Jadual Hari Ini — ${HARI_LABEL[hari]||hari}` : `Jadual ${formatTarikhPapar(tarikh)}`;
}

// ─── LOAD GURU ───────────────────────────────────────────────
async function loadGuru() {
  const res = await API.getSenaraGuru();
  if (!res.ok) return;
  APP.guru    = res.data;
  APP.guruMap = {};
  res.data.forEach(g => { APP.guruMap[g.nama] = g.singkatan; });
  fillGuruSelects();
}
function fillGuruSelects() {
  ['fGuru','fGuruUmum','myGuruSel'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const ph = el.options[0].cloneNode(true);
    el.innerHTML = ''; el.appendChild(ph);
    APP.guru.forEach(g => {
      const o = document.createElement('option');
      o.value = g.nama; o.textContent = g.nama; el.appendChild(o);
    });
  });
}

// ─── LOAD JADUAL TARIKH ───────────────────────────────────────
async function loadJadual(tarikhYMD) {
  showLoading('slotGrid');
  const res = await API.getJadualTarikh(tarikhYMD);
  APP.jadualData = res;
  if (!res.ok) { showError('slotGrid','Gagal muatkan jadual.'); return; }
  renderJadual(res);
}

function renderJadual(res) {
  const grid = document.getElementById('slotGrid');
  if (!grid) return;

  if (res.isHoliday) {
    grid.innerHTML = `
      <div class="day-notice holiday-notice">
        <div class="dn-icon">🎉</div>
        <div class="dn-text">
          <strong>Hari Cuti</strong>
          <span>${escapeHtml(res.holidayLabel || 'Cuti Umum')}</span>
        </div>
      </div>`;
    return;
  }
  if (res.isWeekend) {
    grid.innerHTML = `
      <div class="day-notice weekend-notice">
        <div class="dn-icon">🌴</div>
        <div class="dn-text">
          <strong>Hujung Minggu</strong>
          <span>Bilik tidak beroperasi</span>
        </div>
      </div>`;
    return;
  }

  grid.innerHTML = '';
  const isToday = APP.tarikhDipilih === getTodayYMD();
  const waktu   = isToday ? (new Date().getHours()*60 + new Date().getMinutes()) : -1;
  const events  = res.slots || [];
  const bookings = events.filter(e => e.type === 'booking');

  // Header ringkasan — badge statistik
  const summary = document.createElement('div');
  if (bookings.length === 0) {
    summary.className = 'jadual-summary is-free';
    summary.innerHTML = `<span class="sum-ic">✅</span>
      <span class="sum-free">Bilik tersedia${isToday ? ' sepanjang hari' : ''}</span>
      ${isToday ? '<span class="sum-hint">Tekan + untuk tempah</span>' : ''}`;
  } else {
    summary.className = 'jadual-summary';
    summary.innerHTML = `<span class="sum-ic">📅</span>
      <span class="sum-count">${bookings.length}</span>
      <span class="sum-label">Tempahan${isToday ? ' Hari Ini' : ''}</span>`;
  }
  grid.appendChild(summary);

  events.forEach(ev => {
    const div = document.createElement('div');

    if (ev.type === 'disabled') {
      div.className = 'slot-item is-rehat';
      div.innerHTML = `
        <span class="rehat-icon">☕</span>
        <div class="slot-masa">${formatMasaRange(ev.slot)}</div>
        <div class="slot-info">
          <div class="slot-label" style="color:#94a3b8">${escapeHtml(ev.disabledLabel || 'Waktu Rehat')}</div>
        </div>`;
    } else {
      const t       = ev.items[0] || {};
      const isSemasa = isToday && waktu >= ev.startMin && waktu < ev.endMin;
      let cls = 'slot-item ';
      if (isSemasa)             cls += 'is-semasa';
      else if (ev.status==='PDP')  cls += 'is-pdp is-booked';
      else                         cls += 'is-umum is-booked';

      div.className = cls;

      const nama   = escapeHtml(t.singkatan || t.guru || '—');
      const detail = ev.status === 'PDP' ? (t.subjek || '') : (t.tujuan || '');
      const metaParts = [];
      if (t.kelas) metaParts.push(escapeHtml(t.kelas));
      if (detail)  metaParts.push(escapeHtml(detail));
      const meta  = metaParts.join(' • ');
      const badge = `<span class="slot-badge bdg-${ev.status.toLowerCase()}">${ev.status}</span>`;
      const live  = isSemasa ? '<span class="slot-live">● Sedang digunakan</span>' : '';

      const batalBtn = t.guru && t.tarikh
        ? `<button class="slot-batal-btn"
            onclick="konfirmBatalTempahan('${t.tarikh}','${ev.slot}','${(t.guru||'').replace(/'/g,"\\'")}',this)"
            title="Batalkan tempahan ini">✕</button>`
        : '';

      div.innerHTML = `
        <div class="slot-top">
          <span class="slot-masa"><span class="slot-clock">🕒</span>${formatMasaRange(ev.slot)}</span>
          ${badge}
          ${batalBtn}
        </div>
        <div class="slot-name">${nama}</div>
        ${meta ? `<div class="slot-meta">${meta}</div>` : ''}
        ${live}`;
    }

    grid.appendChild(div);
  });

  if (bookings.length === 0) {
    const free = document.createElement('div');
    free.className = 'slot-free-day';
    free.innerHTML = `<div class="sfd-icon">📭</div>
      <div class="sfd-text">Tiada tempahan${isToday ? '' : ' pada tarikh ini'}</div>`;
    grid.appendChild(free);
  }
}

// ─── STATUS SEKARANG ──────────────────────────────────────────
async function loadStatusSekarang() {
  const res = await API.getStatusSekarang();
  if (!res.ok) return;
  renderStatusBilik(res);
}

function renderStatusBilik(res) {
  const el    = document.getElementById('statusBilik');
  const icon  = document.getElementById('statusIcon');
  const title = document.getElementById('statusTitle');
  const desc  = document.getElementById('statusDesc');
  const badge = document.getElementById('statusBadge');
  if (!el) return;

  if (!res.inOps) {
    el.className='status-bilik s-luar'; icon.textContent='🔒';
    title.textContent='Di Luar Waktu Operasi';
    desc.textContent=`Jam ${res.jam} — bilik tidak beroperasi`;
    badge.className='status-badge bdg-luar'; badge.textContent='LUAR WAKTU';
    return;
  }
  if (!res.semasaReal) {
    el.className='status-bilik s-kosong'; icon.textContent='🟢';
    title.textContent='Bilik Kosong';
    desc.textContent=`Tiada sesi aktif — Jam ${res.jam}`;
    badge.className='status-badge bdg-kosong'; badge.textContent='KOSONG';
    return;
  }
  const t = res.semasaReal;
  el.className='status-bilik s-guna'; icon.textContent='🔴';
  title.textContent=`${t.singkatan||t.guru}${t.kelas?' | '+t.kelas:''}`;
  desc.textContent=`${t.jenis==='PDP'?t.subjek:t.tujuan}  ·  ${formatMasaRange(t.masa)}`;
  badge.className='status-badge bdg-guna'; badge.textContent='SEDANG DIGUNAKAN';
}

// ─── STATISTIK ────────────────────────────────────────────────
async function loadStatistik() {
  const res = await API.getStatistik();
  if (res.ok) renderStatistik(res.data);
}

function renderStatistik(d) {
  if (!d) return;

  const pctSudah = d.jumlahGuru > 0 ? Math.round(d.jumlahSudah / d.jumlahGuru * 100) : 0;
  const mkChip   = (nama, warna) =>
    `<span class="stat-chip stat-chip-${warna}" title="${escapeHtml(nama)}">${escapeHtml(nama)}</span>`;

  const html = `
    <div style="padding:12px 14px">
      <div class="stat-bulan-header">
        <span class="stat-bulan-title">📅 ${escapeHtml(d.bulanLabel)}</span>
        <span class="stat-bulan-count">${d.jumlah} slot ditempah</span>
      </div>
      <div class="stat-progress-wrap">
        <div class="stat-progress-bar" style="width:${pctSudah}%"></div>
      </div>
      <div class="stat-progress-label">
        <span>${d.jumlahSudah} daripada ${d.jumlahGuru} guru telah masuk</span>
        <span>${pctSudah}%</span>
      </div>
      <div class="stat-section">
        <div class="stat-section-hdr stat-hdr-sudah">
          ✅ Sudah Masuk Bilik Media
          <span class="stat-badge">${d.jumlahSudah}</span>
        </div>
        <div class="stat-chips">
          ${d.sudahMasuk.length
            ? d.sudahMasuk.map(n => mkChip(n,'hijau')).join('')
            : '<span class="stat-empty">Tiada lagi bulan ini</span>'}
        </div>
      </div>
      <div class="stat-section">
        <div class="stat-section-hdr stat-hdr-belum">
          ⏳ Belum Masuk Bilik Media
          <span class="stat-badge">${d.jumlahBelum}</span>
        </div>
        <div class="stat-chips">
          ${d.belumMasuk.length
            ? d.belumMasuk.map(n => mkChip(n,'merah')).join('')
            : '<span class="stat-empty">✨ Semua guru dah masuk bulan ini!</span>'}
        </div>
      </div>
    </div>`;

  const el2  = document.getElementById('statBlockRekod');
  if (el2) el2.innerHTML = html;
}

// ─── TEMPAHAN SAYA ────────────────────────────────────────────
async function loadTempahanSaya() {
  const guru = document.getElementById('myGuruSel')?.value;
  const el   = document.getElementById('myList');
  if (!guru) {
    el.innerHTML = '<div class="empty"><div class="ei">📋</div><p>Pilih nama guru untuk lihat tempahan</p></div>';
    return;
  }
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Memuatkan...</div>';
  const res = await API.getTempahanSaya(guru);
  if (!res.ok || !res.data.length) {
    el.innerHTML = '<div class="empty"><div class="ei">📭</div><p>Tiada tempahan akan datang</p></div>';
    return;
  }
  el.innerHTML = res.data.map(t => {
    const d  = parseTarikhYMD(t.tarikh);
    const dd = d ? d.getDate() : '--';
    const mm = d ? BULAN_LABEL[d.getMonth()+1] : '--';
    const sub = t.jenis==='PDP' ? t.subjek : t.tujuan;
    return `
      <div class="mybk-item">
        <div class="mybk-date"><span class="dd">${dd}</span><span class="mm">${mm}</span></div>
        <div class="mybk-info">
          <h4>${HARI_LABEL[t.hari]||t.hari}, ${formatMasaRange(t.masa)}</h4>
          <p>${t.jenis}${t.kelas?' · '+escapeHtml(t.kelas):''} ${sub?' · '+escapeHtml(sub):''}</p>
        </div>
        <button class="batal-btn" onclick="batalTempahan('${t.tarikh}','${t.masa}','${guru.replace(/'/g,"\\'")}')">Batal</button>
      </div>`;
  }).join('');
}

// ─── BATAL TEMPAHAN ──────────────────────────────────────────
function konfirmBatalTempahan(tarikh, masa, guru, btnEl) {
  if (btnEl) {
    const orig = btnEl.textContent;
    btnEl.textContent = 'Pasti?';
    btnEl.classList.add('batal-confirm');
    btnEl.onclick = () => eksekusiBatal(tarikh, masa, guru, btnEl);
    setTimeout(() => {
      if (btnEl.classList.contains('batal-confirm')) {
        btnEl.textContent = orig;
        btnEl.classList.remove('batal-confirm');
        btnEl.onclick = () => konfirmBatalTempahan(tarikh, masa, guru, btnEl);
      }
    }, 3000);
  }
}

async function eksekusiBatal(tarikh, masa, guru, btnEl) {
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '...'; }
  const res = await API.batalTempahan(tarikh, masa, guru);
  showToast(res.ok ? res.message : res.error, res.ok ? 'ok' : 'err');
  if (res.ok) {
    loadJadual(APP.tarikhDipilih);
    loadStatistik();
    loadTempahanSaya();
  } else {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = '✕'; btnEl.classList.remove('batal-confirm'); }
  }
}

async function batalTempahan(tarikh, masa, guru) {
  if (!confirm(`Batalkan tempahan?\n${formatMasaRange(masa)}  ·  ${tarikh}`)) return;
  const res = await API.batalTempahan(tarikh, masa, guru);
  showToast(res.ok ? res.message : res.error, res.ok ? 'ok' : 'err');
  if (res.ok) {
    loadTempahanSaya();
    loadJadual(APP.tarikhDipilih);
    loadStatistik();
  }
}

// ═══════════════════════════════════════════════════════════
//  MODAL TEMPAHAN
// ═══════════════════════════════════════════════════════════
function bukaModal() {
  resetModal();
  APP.modal.tarikhTarget = APP.tarikhDipilih;
  syncModalTarikh(APP.tarikhDipilih);
  document.getElementById('modalOverlay').classList.add('open');
}

function bukaModalTarikh(tarikh) {
  resetModal();
  APP.modal.tarikhTarget = tarikh;
  syncModalTarikh(tarikh);
  document.getElementById('modalOverlay').classList.add('open');
}

function syncModalTarikh(tarikhYMD) {
  ['mDatePdp','mDateUmum'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const today = getTodayYMD();
    const max   = addDays(today, APP.settings?.MAX_BOOKING_DAY||30);
    el.min   = today;
    el.max   = max;
    el.value = tarikhYMD;
  });
  updateModalDateLabel(tarikhYMD);
}

function updateModalDateLabel(tarikhYMD) {
  const el = document.getElementById('mDateLabel');
  if (el) el.textContent = formatTarikhPapar(tarikhYMD);
}

function tutupModal() { document.getElementById('modalOverlay').classList.remove('open'); }

function resetModal() {
  APP.modal.jenis=''; APP.modal.slotDipilih=[];
  showStep('step-jenis');
  const mt = document.getElementById('modalTitle');
  if (mt) mt.textContent='Buat Tempahan';
  ['fGuru','fGuruUmum','fTujuan','fMasaMula','fMasaTamat'].forEach(id=>{
    const e=document.getElementById(id); if(e) e.value='';
  });
  const g = document.getElementById('pdpKelasGrid');
  if (g) g.innerHTML='<div class="empty"><div class="ei">👆</div><p>Pilih guru untuk lihat jadual</p></div>';
  const pi = document.getElementById('pdpInfo');
  if (pi) pi.style.display='none';
  const uw = document.getElementById('umumWarn');
  if (uw) uw.style.display='none';
  ['btnTempah','btnTempahUmum'].forEach(id=>{const b=document.getElementById(id);if(b)b.disabled=true;});
  document.querySelectorAll('.jenis-card').forEach(c=>c.classList.remove('sel'));
}

function pilihJenis(jenis) {
  APP.modal.jenis=jenis;
  document.getElementById('jenisPDP')?.classList.toggle('sel',jenis==='PDP');
  document.getElementById('jenisUMUM')?.classList.toggle('sel',jenis==='UMUM');
  const mt = document.getElementById('modalTitle');
  if (mt) mt.textContent = jenis==='PDP' ? 'Tempahan PdPc' : 'Tempahan Umum';
  showStep(jenis==='PDP'?'step-pdp':'step-umum');
}
function balik() { showStep('step-jenis'); document.getElementById('modalTitle').textContent='Buat Tempahan'; }
function showStep(id) {
  ['step-jenis','step-pdp','step-umum'].forEach(s=>{
    const e=document.getElementById(s); if(e) e.style.display=s===id?'block':'none';
  });
}

// ─── PdPc: DATE CHANGE ───────────────────────────────────────
function onPdpDateChange() {
  const d = document.getElementById('mDatePdp')?.value;
  if (!d) return;
  APP.modal.tarikhTarget = d;
  updateModalDateLabel(d);
  document.getElementById('fGuru').value='';
  const g = document.getElementById('pdpKelasGrid');
  if (g) g.innerHTML='<div class="empty"><div class="ei">👆</div><p>Pilih guru untuk lihat jadual</p></div>';
  document.getElementById('pdpInfo').style.display='none';
  document.getElementById('btnTempah').disabled=true;
  APP.modal.slotDipilih=[];
}

async function onGuruChange() {
  const guru   = document.getElementById('fGuru')?.value;
  const tarikh = APP.modal.tarikhTarget || APP.tarikhDipilih;
  const grid   = document.getElementById('pdpKelasGrid');
  const hari   = getHariDariTarikhJS(tarikh);

  document.getElementById('pdpInfo').style.display='none';
  document.getElementById('btnTempah').disabled=true;
  APP.modal.slotDipilih=[];

  if (!guru) {
    if(grid) grid.innerHTML='<div class="empty"><div class="ei">👆</div><p>Pilih guru untuk lihat jadual</p></div>';
    return;
  }
  if (!hari) {
    if(grid) grid.innerHTML='<div class="empty"><div class="ei">📅</div><p>Tarikh tidak sah</p></div>';
    return;
  }

  if(grid) grid.innerHTML='<div class="loading"><div class="spinner"></div> Memuatkan jadual guru...</div>';

  // Run in parallel
  const [jadualRes, tempahanRes] = await Promise.all([
    API.getJadualGuruTarikh(guru, tarikh),
    API.getTempahan(tarikh)
  ]);
  const jadualData = jadualRes.ok ? jadualRes.data : [];
  const tempahanData = tempahanRes.ok ? tempahanRes.data : [];
  renderKelasGrid(jadualData, tempahanData, hari, grid);
}

function renderKelasGrid(jadual, tempahan, hari, grid) {
  if (!jadual||!jadual.length) {
    grid.innerHTML='<div class="empty"><div class="ei">📭</div><p>Tiada jadual mengajar guru ini pada hari tersebut.</p></div>';
    return;
  }
  grid.innerHTML='';

  const available = jadual.filter(kelas => {
    const conflict = tempahan.find(t=>{
      const tS=t.startMin,tE=t.endMin;
      if (!tS||!tE){const p=parseMasaJS(normTime(t.masa));return p?isOverlapJS(kelas.startMin,kelas.endMin,p.s,p.e):false;}
      return isOverlapJS(kelas.startMin,kelas.endMin,tS,tE);
    });
    return !conflict;
  });

  if (available.length > 1) {
    const allBtn = document.createElement('button');
    allBtn.className = 'btn-pilih-semua';
    allBtn.textContent = `📋 Pilih Semua Slot Saya (${available.length})`;
    allBtn.onclick = () => pilihSemuaSlot(available);
    grid.appendChild(allBtn);
  }

  jadual
  .filter(kelas => kelas.kelas && kelas.subjek)
  .forEach(kelas => {
    const conflict = tempahan.find(t => {
      const tS = t.startMin, tE = t.endMin;
      if (!tS || !tE) {
        const p = parseMasaJS(normTime(t.masa));
        return p ? isOverlapJS(kelas.startMin, kelas.endMin, p.startMin, p.endMin) : false;
      }
      return isOverlapJS(kelas.startMin, kelas.endMin, tS, tE);
    });

    const card = document.createElement('div');
    card.className='kelas-card'+(conflict?' kelas-booked':'');
    card.innerHTML=`
      <div class="kelas-masa">${formatMasaRange(kelas.masa)}</div>
      <div class="kelas-info">
        <div class="ki-kelas">${escapeHtml(kelas.kelas)}</div>
        <div class="ki-sub">${escapeHtml(kelas.subjek||'')}</div>
      </div>
      <span class="kelas-status ${conflict?'ks-booked':'ks-ok'}">${conflict?'Ditempah':'Kosong'}</span>`;
    if (!conflict) card.onclick=()=>pilihKelasCard(card,kelas);
    grid.appendChild(card);
  });
}

function pilihKelasCard(card, kelas) {
  const idx = APP.modal.slotDipilih.findIndex(
    s => normTime(s.masa) === normTime(kelas.masa) && s.kelas === kelas.kelas
  );

  if (idx >= 0) {
    APP.modal.slotDipilih.splice(idx, 1);
    card.classList.remove('kelas-sel');
    const s = card.querySelector('.kelas-status');
    if (s) { s.className = 'kelas-status ks-ok'; s.textContent = 'Kosong'; }
  } else {
    APP.modal.slotDipilih.push(kelas);
    card.classList.add('kelas-sel');
    const s = card.querySelector('.kelas-status');
    if (s) { s.className = 'kelas-status ks-sel'; s.textContent = '✓ Dipilih'; }
  }

  updatePdpInfo();
}

function pilihSemuaSlot(available) {
  APP.modal.slotDipilih = [];
  document.querySelectorAll('.kelas-card').forEach(c => {
    if (!c.classList.contains('kelas-booked')) {
      c.classList.remove('kelas-sel');
      const s = c.querySelector('.kelas-status');
      if (s) { s.className = 'kelas-status ks-ok'; s.textContent = 'Kosong'; }
    }
  });

  available.forEach(kelas => {
    APP.modal.slotDipilih.push(kelas);
    document.querySelectorAll('.kelas-card:not(.kelas-booked)').forEach(c => {
      const masa = c.querySelector('.kelas-masa')?.textContent?.trim();
      const kelasName = c.querySelector('.ki-kelas')?.textContent?.trim();
      if (normTime(masa) === normTime(kelas.masa) && kelasName === kelas.kelas) {
        c.classList.add('kelas-sel');
        const s = c.querySelector('.kelas-status');
        if (s) { s.className = 'kelas-status ks-sel'; s.textContent = '✓ Dipilih'; }
      }
    });
  });

  updatePdpInfo();
}

function updatePdpInfo() {
  const pi   = document.getElementById('pdpInfo');
  const btn  = document.getElementById('btnTempah');
  const slots = APP.modal.slotDipilih;

  if (!slots.length) {
    if (pi)  pi.style.display = 'none';
    if (btn) btn.disabled = true;
    return;
  }

  if (pi) {
    pi.style.display = 'block';
    const listHTML = slots
      .map(s => `<li>${escapeHtml(s.kelas)} &nbsp;|&nbsp; ${formatMasaRange(s.masa)}</li>`)
      .join('');
    pi.innerHTML = `
      <strong>✅ Slot Dipilih (${slots.length})</strong>
      <ul>${listHTML}</ul>`;
  }
  if (btn) btn.disabled = false;
}

// ─── UMUM: VALIDATE ──────────────────────────────────────────
function validateUmum() {
  const guru  = document.getElementById('fGuruUmum')?.value;
  const tarikh= document.getElementById('mDateUmum')?.value || APP.tarikhDipilih;
  const mula  = document.getElementById('fMasaMula')?.value;
  const tamat = document.getElementById('fMasaTamat')?.value;
  const tuju  = document.getElementById('fTujuan')?.value.trim();
  const hari  = getHariDariTarikhJS(tarikh);

  const valid = guru && tarikh && mula && tamat && tuju && mula<tamat;

  const btn = document.getElementById('btnTempahUmum');
  if (btn) btn.disabled = !valid;

  const warn = document.getElementById('umumWarn');
  if (warn) {
    if (mula&&tamat&&mula>=tamat) {
      warn.style.display='block'; warn.textContent='⚠️ Masa tamat mesti lebih lewat dari masa mula.';
    } else {
      warn.style.display='none';
    }
  }
}

// ─── SUBMIT PdPc ─────────────────────────────────────────────
async function submitPdP() {
  const slots  = APP.modal.slotDipilih;
  const guru   = document.getElementById('fGuru')?.value;
  const tarikh = APP.modal.tarikhTarget || APP.tarikhDipilih;

  if (!slots || !slots.length) {
    showToast('Sila pilih sekurang-kurangnya satu slot kelas.', 'err');
    return;
  }
  if (!guru) {
    showToast('Sila pilih nama guru.', 'err');
    return;
  }

  setLoading('btnTempah', true);

  const res = await API.buatTempahanPDP({
    tarikhYMD: tarikh,
    guru,
    singkatan: APP.guruMap[guru] || guru.split(' ')[0],
    slots: slots.map(s => ({
      masa  : normTime(s.masa),
      kelas : s.kelas  || '',
      subjek: s.subjek || ''
    }))
  });

  setLoading('btnTempah', false);

  if (res.ok) {
    tutupModal();
    const msg = res.message || `✅ ${res.jumlahBerjaya} slot berjaya ditempah.`;
    showToast(msg, 'ok');

    if (res.jumlahGagal > 0 && res.gagal && res.gagal.length) {
      const gagalList = res.gagal.map(g => `${g.masa}${g.kelas ? ' | ' + g.kelas : ''}: ${g.sebab}`).join('\n');
      setTimeout(() => showToast('⚠️ ' + res.jumlahGagal + ' slot gagal: ' + gagalList, 'err'), 4000);
    }

    if (tarikh && tarikh !== APP.tarikhDipilih) {
      APP.tarikhDipilih = tarikh;
      const picker = document.getElementById('datePicker');
      if (picker) picker.value = tarikh;
      updateDateDisplay();
    }

    loadJadual(APP.tarikhDipilih);
    loadStatistik();
    loadStatusSekarang();
  } else {
    showToast(res.error || 'Tempahan gagal.', 'err');
  }
}

// ─── SUBMIT UMUM ─────────────────────────────────────────────
async function submitUmum() {
  const guru   = document.getElementById('fGuruUmum')?.value;
  const tarikh = document.getElementById('mDateUmum')?.value || APP.tarikhDipilih;
  const mula   = document.getElementById('fMasaMula')?.value;
  const tamat  = document.getElementById('fMasaTamat')?.value;
  const tuju   = document.getElementById('fTujuan')?.value.trim();
  if (!guru||!tarikh||!mula||!tamat||!tuju) { showToast('Sila lengkapkan semua maklumat.','err'); return; }
  if (mula >= tamat) { showToast('Masa tamat mesti lebih lewat.','err'); return; }

  setLoading('btnTempahUmum', true);
  const res = await API.buatTempahanUmum({
    tarikhYMD: tarikh,
    masa     : normTime(mula + '-' + tamat),
    jenis    : 'UMUM',
    guru,
    singkatan: APP.guruMap[guru] || guru.split(' ')[0],
    kelas:'', subjek:'', tujuan: tuju
  });
  setLoading('btnTempahUmum', false);

  if (res.ok) {
    tutupModal();
    showToast(res.message, 'ok');

    if (tarikh && tarikh !== APP.tarikhDipilih) {
      APP.tarikhDipilih = tarikh;
      const picker = document.getElementById('datePicker');
      if (picker) picker.value = tarikh;
      updateDateDisplay();
    }

    loadJadual(APP.tarikhDipilih);
    loadStatistik();
    loadStatusSekarang();
  } else {
    showToast(res.error, 'err');
  }
}

// ─── UTILITIES ───────────────────────────────────────────────
function showLoading(id){const e=document.getElementById(id);if(e)e.innerHTML='<div class="loading"><div class="spinner"></div> Memuatkan...</div>';}
function showError(id,msg){const e=document.getElementById(id);if(e)e.innerHTML=`<div class="empty"><div class="ei">⚠️</div><p>${escapeHtml(msg)}</p></div>`;}
function setLoading(id,on){
  const b=document.getElementById(id); if(!b)return;
  b.disabled=on;
  b.innerHTML=on?'<div class="spinner" style="border-top-color:#fff;width:15px;height:15px;display:inline-block"></div> Memproses...':'✓ Tempah';
}
function showToast(msg,type){
  const t=document.getElementById('toast');
  t.textContent=msg; t.className=`toast ${type||''} show`;
  setTimeout(()=>{t.className='toast';},3800);
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

document.addEventListener('DOMContentLoaded', () => {
  const ov=document.getElementById('modalOverlay');
  if(ov) ov.addEventListener('click',e=>{if(e.target===ov)tutupModal();});
});

// Auto-refresh bila pengguna kembali ke tab (tab visible semula)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && APP.tarikhDipilih) {
    loadJadual(APP.tarikhDipilih);
    loadStatusSekarang();
    if (document.getElementById('sec-rekod')?.classList.contains('active')) {
      loadStatistik();
    }
    if (document.getElementById('sec-saya')?.classList.contains('active')) {
      loadTempahanSaya();
    }
  }
});
