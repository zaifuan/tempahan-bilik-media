/* ═══════════════════════════════════════════════════════════
   ADMIN PANEL — admin.js
   Login, token management, CRUD for all admin entities
   ═══════════════════════════════════════════════════════════ */

const TOKEN_KEY = 'tempahan_admin_token';
let CURRENT_ADMIN = null;

// Cache untuk dropdown selects
const CACHE = {
  teachers: [],
  classes : [],
  subjects: [],
};

// ═══════════════════════════════════════════════════════════
// API CLIENT (with Bearer token)
// ═══════════════════════════════════════════════════════════
const API = {
  token: () => localStorage.getItem(TOKEN_KEY),
  async req(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const t = API.token();
    if (t) headers['Authorization'] = 'Bearer ' + t;
    try {
      const opts = { method, headers };
      if (body !== undefined) opts.body = JSON.stringify(body);
      const r = await fetch('/api/admin' + path, opts);
      if (r.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        showLogin();
        return { ok: false, error: 'Session tamat. Sila log masuk semula.' };
      }
      return await r.json();
    } catch (e) {
      return { ok: false, error: 'Ralat sambungan: ' + e.message };
    }
  },
  get   : (p)    => API.req('GET',    p),
  post  : (p,b)  => API.req('POST',   p, b||{}),
  put   : (p,b)  => API.req('PUT',    p, b||{}),
  del   : (p)    => API.req('DELETE', p),
};

// ═══════════════════════════════════════════════════════════
// ENTRY
// ═══════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', async () => {
  if (API.token()) {
    const r = await API.get('/me');
    if (r.ok) { CURRENT_ADMIN = r.admin; showApp(); return; }
    localStorage.removeItem(TOKEN_KEY);
  }
  showLogin();
});

function showLogin() {
  document.getElementById('loginView').style.display = 'flex';
  document.getElementById('appView').style.display = 'none';
}
function showApp() {
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('appView').style.display = 'block';
  document.getElementById('adminName').textContent =
    `👤 ${CURRENT_ADMIN.username || CURRENT_ADMIN.nama || 'Admin'}`;

  // Default tab
  loadDashboard();
}

async function doLogin() {
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value;
  const err = document.getElementById('loginErr');
  const btn = document.getElementById('btnLogin');
  err.style.display = 'none';
  btn.disabled = true;

  const r = await API.post('/login', { username: u, password: p });
  btn.disabled = false;

  if (!r.ok) {
    err.style.display = 'block';
    err.textContent = '⚠️ ' + (r.error || 'Login gagal.');
    return;
  }
  localStorage.setItem(TOKEN_KEY, r.token);
  CURRENT_ADMIN = r.admin;
  showApp();
}

function doLogout() {
  if (!confirm('Log keluar dari sistem?')) return;
  localStorage.removeItem(TOKEN_KEY);
  CURRENT_ADMIN = null;
  location.reload();
}

// ═══════════════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════════════
function showTab(name, btn) {
  document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('aktif'));
  document.getElementById('tab-' + name).classList.add('active');
  if (btn) btn.classList.add('aktif');

  switch (name) {
    case 'dashboard': loadDashboard(); break;
    case 'bookings' : loadBookings(); break;
    case 'teachers' : loadTeachers(); break;
    case 'classes'  : loadClasses(); break;
    case 'subjects' : loadSubjects(); break;
    case 'schedule' : loadSchedule(); break;
    case 'settings' : loadSettings(); break;
    case 'disabled' : loadDisabled(); break;
    case 'holidays' : loadHolidays(); break;
  }
}

// ═══════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════
async function loadDashboard() {
  const r = await API.get('/dashboard');
  const el = document.getElementById('dashStats');
  const lg = document.getElementById('dashLogs');
  if (!r.ok) { el.innerHTML = `<div class="warn-box">${escapeHtml(r.error||'Gagal')}</div>`; return; }

  const d = r.data;
  el.innerHTML = `
    <div class="dash-stat"><div class="dash-stat-num">${d.tempahanHariIni}</div><div class="dash-stat-lbl">Tempahan Hari Ini</div></div>
    <div class="dash-stat"><div class="dash-stat-num">${d.tempahanBulanIni}</div><div class="dash-stat-lbl">Tempahan Bulan Ini</div></div>
    <div class="dash-stat"><div class="dash-stat-num">${d.totalGuru}</div><div class="dash-stat-lbl">Guru Aktif</div></div>
    <div class="dash-stat"><div class="dash-stat-num">${d.slotDitutup != null ? d.slotDitutup : 0}</div><div class="dash-stat-lbl">Slot Ditutup</div></div>
  `;

  const logs = (d.recentLogs || []).slice(0, 10);
  if (!logs.length) {
    lg.innerHTML = '<div class="empty"><div class="ei">📭</div><p>Tiada aktiviti</p></div>';
  } else {
    lg.innerHTML = logs.map(l => {
      const t = new Date(l.at);
      const tstr = t.toLocaleString('ms-MY', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
      const action = (l.action || '').toLowerCase();
      return `<div class="log-item">
        <span class="log-action ${action.includes('batal')||action.includes('cancel')?'batal':''}">${escapeHtml(l.action||'—')}</span>
        <span class="log-meta">${escapeHtml(l.guru||'—')} · ${escapeHtml(l.tarikh||'—')} ${escapeHtml(l.masa||'')}</span>
        <span class="log-time">${tstr}</span>
      </div>`;
    }).join('');
  }
}

// ═══════════════════════════════════════════════════════════
// SYNC GOOGLE SHEET
// ═══════════════════════════════════════════════════════════
async function doSyncSheet() {
  const btn = document.getElementById('btnSyncSheet');
  const box = document.getElementById('syncResult');
  if (!btn) return;

  const labelAsal = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> ⏳ Sedang Sync...';
  if (box) box.style.display = 'none';

  try {
    const r = await API.post('/sync/google-sheet');

    // Endpoint pulang { success, message, data:{ guru, jadualGuru } } jika berjaya.
    // Jika gagal/401: { success:false, error } atau { ok:false, error }.
    if (r && r.success === true) {
      const d = r.data || {};
      const guru   = (d.guru != null) ? d.guru : '—';
      const jadual = (d.jadualGuru != null) ? d.jadualGuru : '—';
      const masa   = new Date().toLocaleTimeString('ms-MY', { hour12: false });

      if (box) {
        box.className = 'info-box';
        box.textContent = '✅ Sync berjaya\nGuru: ' + guru + '\nJadual: ' + jadual + '\nMasa: ' + masa;
        box.style.display = 'block';
      }
      showToast('✅ Sync berjaya', 'ok');
      await loadDashboard();   // refresh kad statistik & log aktiviti
    } else {
      const msg = (r && (r.error || r.message)) || 'Ralat tidak diketahui.';
      if (box) {
        box.className = 'warn-box';
        box.textContent = '❌ Sync gagal\n' + msg;
        box.style.display = 'block';
      }
      showToast('❌ Sync gagal', 'err');
    }
  } catch (e) {
    if (box) {
      box.className = 'warn-box';
      box.textContent = '❌ Sync gagal\n' + e.message;
      box.style.display = 'block';
    }
    showToast('❌ Sync gagal', 'err');
  } finally {
    btn.disabled = false;
    btn.innerHTML = labelAsal;
  }
}

// ═══════════════════════════════════════════════════════════
// BOOKINGS
// ═══════════════════════════════════════════════════════════
async function loadBookings() {
  const from   = document.getElementById('bkDateFrom').value;
  const to     = document.getElementById('bkDateTo').value;
  const status = document.getElementById('bkStatus').value;
  const q = new URLSearchParams();
  if (from)   q.set('from', from);
  if (to)     q.set('to', to);
  if (status) q.set('status', status);
  const r = await API.get('/bookings?' + q.toString());
  const el = document.getElementById('bookingsTable');
  if (!r.ok) { el.innerHTML = '<div class="warn-box">' + escapeHtml(r.error) + '</div>'; return; }
  if (!r.data.length) { el.innerHTML = '<div class="empty"><div class="ei">📭</div><p>Tiada tempahan</p></div>'; return; }

  const cancelableIds = r.data.filter(function(t){ return t.status === 'TEMPAH'; }).map(function(t){ return t.id; });

  var rows = '';
  for (var i = 0; i < r.data.length; i++) {
    var t = r.data[i];
    var checkbox = t.status === 'TEMPAH' ? '<input type="checkbox" class="bk-check" data-id="' + t.id + '"/>' : '';
    var action   = t.status === 'TEMPAH' ? '<button class="action-btn action-del" onclick="cancelBooking(' + t.id + ')">Batal</button>' : '';
    var subjek   = t.jenis === 'PDP' ? (t.subjek || '') : (t.tujuan || '');
    rows += '<tr class="' + (t.status === 'BATAL' ? 'inactive' : '') + '">'
      + '<td>' + checkbox + '</td>'
      + '<td>' + escapeHtml(t.tarikh) + '</td>'
      + '<td>' + escapeHtml(t.masa) + '</td>'
      + '<td><span class="badge badge-' + t.jenis.toLowerCase() + '">' + t.jenis + '</span></td>'
      + '<td>' + escapeHtml(t.guru) + '</td>'
      + '<td>' + escapeHtml(t.kelas || '') + '</td>'
      + '<td>' + escapeHtml(subjek) + '</td>'
      + '<td><span class="badge badge-' + t.status.toLowerCase() + '">' + t.status + '</span></td>'
      + '<td class="actions">' + action + '</td>'
      + '</tr>';
  }

  el.innerHTML = '<div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;align-items:center">'
    + '<label style="display:flex;align-items:center;gap:6px;font-size:.82rem;cursor:pointer">'
    + '<input type="checkbox" id="bkCheckAll" onchange="toggleAllBookings(this)"/> Pilih Semua</label>'
    + '<button class="action-btn action-del" onclick="cancelSelectedBookings()">🗑️ Batal Dipilih</button>'
    + '<button class="action-btn action-del" style="background:#fef3c7;color:#92400e;border:1px solid #fcd34d" onclick="cancelAllBookings([' + cancelableIds.join(',') + '])">⚠️ Batal Semua (' + cancelableIds.length + ')</button>'
    + '<span style="font-size:.72rem;color:var(--kelabu);margin-left:auto" id="bkSelectedCount">0 dipilih</span>'
    + '</div>'
    + '<div class="atable-wrap"><table class="atable">'
    + '<thead><tr><th style="width:30px"></th><th>Tarikh</th><th>Masa</th><th>Jenis</th><th>Guru</th><th>Kelas</th><th>Subjek/Tujuan</th><th>Status</th><th></th></tr></thead>'
    + '<tbody>' + rows + '</tbody>'
    + '</table></div>';

  var boxes = document.querySelectorAll('.bk-check');
  for (var j = 0; j < boxes.length; j++) {
    boxes[j].addEventListener('change', updateSelectedCount);
  }
}

function updateSelectedCount() {
  var n = document.querySelectorAll('.bk-check:checked').length;
  var el = document.getElementById('bkSelectedCount');
  if (el) el.textContent = n + ' dipilih';
}

function toggleAllBookings(masterBox) {
  var boxes = document.querySelectorAll('.bk-check');
  for (var i = 0; i < boxes.length; i++) { boxes[i].checked = masterBox.checked; }
  updateSelectedCount();
}

async function cancelBooking(id) {
  var reason = prompt('Sebab pembatalan (optional):');
  if (reason === null) return;
  var r = await API.post('/bookings/' + id + '/cancel', { reason: reason });
  showToast(r.ok ? '✅ Tempahan dibatalkan' : ('⚠️ ' + r.error), r.ok ? 'ok' : 'err');
  if (r.ok) loadBookings();
}

async function cancelSelectedBookings() {
  var checked = document.querySelectorAll('.bk-check:checked');
  if (!checked.length) { showToast('Tiada tempahan dipilih.', 'err'); return; }
  var ids = [];
  for (var i = 0; i < checked.length; i++) { ids.push(Number(checked[i].dataset.id)); }
  if (!confirm('Batalkan ' + ids.length + ' tempahan dipilih?')) return;
  var reason = prompt('Sebab pembatalan (optional):');
  if (reason === null) return;
  await loopCancelBookings(ids, reason || '');
}

async function cancelAllBookings(ids) {
  if (!ids.length) { showToast('Tiada tempahan boleh dibatalkan.', 'err'); return; }
  if (!confirm('AMARAN: Batalkan SEMUA ' + ids.length + ' tempahan? Tindakan tidak boleh diundur.')) return;
  var reason = prompt('Sebab pembatalan (WAJIB):');
  if (!reason || !reason.trim()) { showToast('Sebab pembatalan wajib.', 'err'); return; }
  await loopCancelBookings(ids, reason);
}

async function loopCancelBookings(ids, reason) {
  var success = 0;
  var fail = 0;

  for (var i = 0; i < ids.length; i++) {
    var r = await API.post('/bookings/' + ids[i] + '/cancel', {
      reason: reason || ''
    });

    if (r.ok) {
      success++;
    } else {
      fail++;
    }
  }

  var msg = success + ' berjaya dibatalkan' + (fail ? ', ' + fail + ' gagal' : '') + '.';
  showToast((fail ? '⚠️ ' : '✅ ') + msg, fail ? 'err' : 'ok');
  loadBookings();
}

// ═══════════════════════════════════════════════════════════
// TEACHERS
// ═══════════════════════════════════════════════════════════
async function loadTeachers() {
  const r = await API.get('/teachers');
  const el = document.getElementById('teachersTable');
  if (!r.ok) { el.innerHTML = `<div class="warn-box">${escapeHtml(r.error)}</div>`; return; }
  CACHE.teachers = r.data;
  if (!r.data.length) { el.innerHTML = '<div class="empty"><div class="ei">📭</div><p>Tiada guru</p></div>'; return; }

  const rows = r.data.map(g => `<tr class="${!g.aktif?'inactive':''}">
    <td>${escapeHtml(g.nama)}</td>
    <td>${escapeHtml(g.singkatan||'')}</td>
    <td>${escapeHtml(g.no_telefon||'')}</td>
    <td>${g.override_limit ? '<span class="badge badge-super">YA</span>' : '<span class="badge badge-tidak">Tiada</span>'}</td>
    <td><span class="badge badge-${g.aktif?'aktif':'tidak'}">${g.aktif?'Aktif':'Tidak Aktif'}</span></td>
    <td class="actions">
      <button class="action-btn action-edit" onclick='editTeacher(${JSON.stringify(g).replace(/'/g,"&#39;")})'>Edit</button>
      <button class="action-btn action-del" onclick="deleteTeacher(${g.id})">Padam</button>
    </td>
  </tr>`).join('');
  el.innerHTML = `
    <div class="atable-wrap"><table class="atable">
      <thead><tr><th>Nama</th><th>Singkatan</th><th>No. Telefon</th><th>Override Had</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function openTeacherModal(t) {
  showAdminModal(t ? 'Edit Guru' : 'Tambah Guru', `
    <div class="fg"><label>Nama Penuh <span>*</span></label>
      <input class="fc" id="tNama" value="${escapeHtml(t?.nama||'')}" required/></div>
    <div class="fg"><label>Singkatan / Panggilan <span>*</span></label>
      <input class="fc" id="tSing" value="${escapeHtml(t?.singkatan||'')}" required/></div>
    <div class="fg"><label>No. Telefon</label>
      <input class="fc" id="tTel" value="${escapeHtml(t?.no_telefon||'')}" placeholder="cth: 012-3456789"/></div>
    <div class="fg">
      <label><input type="checkbox" id="tOverride" ${t?.override_limit?'checked':''}/> Override had bulanan (tidak terhad)</label>
      <p style="font-size:.72rem;color:var(--kelabu);margin-top:4px">Tick jika guru ini dibenarkan tempah lebih dari had biasa.</p>
    </div>
    <div class="fg">
      <label><input type="checkbox" id="tAktif" ${(!t || t.aktif)?'checked':''}/> Aktif</label>
    </div>
    <div class="btn-row">
      <button class="btn btn-ghost" onclick="closeAdminModal()">Batal</button>
      <button class="btn btn-hijau" onclick="saveTeacher(${t?.id||'null'})">Simpan</button>
    </div>
  `);
}
function editTeacher(t) { openTeacherModal(t); }

async function saveTeacher(id) {
  const body = {
    nama:           document.getElementById('tNama').value.trim(),
    singkatan:      document.getElementById('tSing').value.trim(),
    no_telefon:     document.getElementById('tTel').value.trim() || null,
    override_limit: document.getElementById('tOverride').checked,
    aktif:          document.getElementById('tAktif').checked,
  };
  if (!body.nama || !body.singkatan) { showToast('Nama & singkatan wajib','err'); return; }
  const r = id ? await API.put(`/teachers/${id}`, body) : await API.post('/teachers', body);
  showToast(r.ok ? '✅ Berjaya disimpan' : ('⚠️ '+r.error), r.ok?'ok':'err');
  if (r.ok) { closeAdminModal(); loadTeachers(); }
}

async function deleteTeacher(id) {
  if (!confirm('Padam guru ini? (Tempahan lepas akan kekal.)')) return;
  const r = await API.del('/teachers/' + id);
  showToast(r.ok ? '✅ Berjaya dipadam' : ('⚠️ '+r.error), r.ok?'ok':'err');
  if (r.ok) loadTeachers();
}

// ═══════════════════════════════════════════════════════════
// CLASSES
// ═══════════════════════════════════════════════════════════
async function loadClasses() {
  const r = await API.get('/classes');
  const el = document.getElementById('classesTable');
  if (!r.ok) { el.innerHTML = `<div class="warn-box">${escapeHtml(r.error)}</div>`; return; }
  CACHE.classes = r.data;
  if (!r.data.length) { el.innerHTML = '<div class="empty"><div class="ei">📭</div><p>Tiada kelas</p></div>'; return; }

  const rows = r.data.map(c => `<tr class="${!c.aktif?'inactive':''}">
    <td>${escapeHtml(c.nama_kelas)}</td>
    <td>${escapeHtml(c.tingkatan||'')}</td>
    <td><span class="badge badge-${c.aktif?'aktif':'tidak'}">${c.aktif?'Aktif':'Tidak'}</span></td>
    <td class="actions">
      <button class="action-btn action-edit" onclick='editClass(${JSON.stringify(c).replace(/'/g,"&#39;")})'>Edit</button>
      <button class="action-btn action-del" onclick="deleteClass(${c.id})">Padam</button>
    </td>
  </tr>`).join('');
  el.innerHTML = `
    <div class="atable-wrap"><table class="atable">
      <thead><tr><th>Nama Kelas</th><th>Tingkatan</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}
function openClassModal(c) {
  showAdminModal(c?'Edit Kelas':'Tambah Kelas', `
    <div class="fg"><label>Nama Kelas <span>*</span></label>
      <input class="fc" id="cNama" value="${escapeHtml(c?.nama_kelas||'')}" required/></div>
    <div class="fg"><label>Tingkatan</label>
      <input class="fc" id="cTing" value="${escapeHtml(c?.tingkatan||'')}" placeholder="cth: 1, 2, STAM"/></div>
    <div class="fg">
      <label><input type="checkbox" id="cAktif" ${(!c||c.aktif)?'checked':''}/> Aktif</label>
    </div>
    <div class="btn-row">
      <button class="btn btn-ghost" onclick="closeAdminModal()">Batal</button>
      <button class="btn btn-hijau" onclick="saveClass(${c?.id||'null'})">Simpan</button>
    </div>
  `);
}
function editClass(c){ openClassModal(c); }
async function saveClass(id) {
  const body = {
    nama_kelas: document.getElementById('cNama').value.trim(),
    tingkatan:  document.getElementById('cTing').value.trim() || null,
    aktif:      document.getElementById('cAktif').checked,
  };
  if (!body.nama_kelas) { showToast('Nama wajib','err'); return; }
  const r = id ? await API.put(`/classes/${id}`, body) : await API.post('/classes', body);
  showToast(r.ok ? '✅ Berjaya' : ('⚠️ '+r.error), r.ok?'ok':'err');
  if (r.ok) { closeAdminModal(); loadClasses(); }
}
async function deleteClass(id) {
  if (!confirm('Padam kelas ini?')) return;
  const r = await API.del('/classes/' + id);
  showToast(r.ok ? '✅ Berjaya' : ('⚠️ '+r.error), r.ok?'ok':'err');
  if (r.ok) loadClasses();
}

// ═══════════════════════════════════════════════════════════
// SUBJECTS
// ═══════════════════════════════════════════════════════════
async function loadSubjects() {
  const r = await API.get('/subjects');
  const el = document.getElementById('subjectsTable');
  if (!r.ok) { el.innerHTML = `<div class="warn-box">${escapeHtml(r.error)}</div>`; return; }
  CACHE.subjects = r.data;
  if (!r.data.length) { el.innerHTML = '<div class="empty"><div class="ei">📭</div><p>Tiada subjek</p></div>'; return; }

  const rows = r.data.map(s => `<tr class="${!s.aktif?'inactive':''}">
    <td>${escapeHtml(s.kod)}</td>
    <td>${escapeHtml(s.nama||'')}</td>
    <td><span class="badge badge-${s.aktif?'aktif':'tidak'}">${s.aktif?'Aktif':'Tidak'}</span></td>
    <td class="actions">
      <button class="action-btn action-edit" onclick='editSubject(${JSON.stringify(s).replace(/'/g,"&#39;")})'>Edit</button>
      <button class="action-btn action-del" onclick="deleteSubject(${s.id})">Padam</button>
    </td>
  </tr>`).join('');
  el.innerHTML = `
    <div class="atable-wrap"><table class="atable">
      <thead><tr><th>Kod</th><th>Nama Penuh</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}
function openSubjectModal(s) {
  showAdminModal(s?'Edit Subjek':'Tambah Subjek', `
    <div class="fg"><label>Kod <span>*</span></label>
      <input class="fc" id="sKod" value="${escapeHtml(s?.kod||'')}" required/></div>
    <div class="fg"><label>Nama Penuh</label>
      <input class="fc" id="sNama" value="${escapeHtml(s?.nama||'')}"/></div>
    <div class="btn-row">
      <button class="btn btn-ghost" onclick="closeAdminModal()">Batal</button>
      <button class="btn btn-hijau" onclick="saveSubject(${s?.id||'null'})">Simpan</button>
    </div>
  `);
}
function editSubject(s){ openSubjectModal(s); }
async function saveSubject(id) {
  const body = {
    kod:  document.getElementById('sKod').value.trim(),
    nama: document.getElementById('sNama').value.trim(),
  };
  if (!body.kod) { showToast('Kod wajib','err'); return; }
  const r = id ? await API.put(`/subjects/${id}`, body) : await API.post('/subjects', body);
  showToast(r.ok ? '✅ Berjaya' : ('⚠️ '+r.error), r.ok?'ok':'err');
  if (r.ok) { closeAdminModal(); loadSubjects(); }
}
async function deleteSubject(id) {
  if (!confirm('Padam subjek ini?')) return;
  const r = await API.del('/subjects/' + id);
  showToast(r.ok ? '✅ Berjaya' : ('⚠️ '+r.error), r.ok?'ok':'err');
  if (r.ok) loadSubjects();
}

// ═══════════════════════════════════════════════════════════
// SCHEDULE
// ═══════════════════════════════════════════════════════════
async function loadSchedule() {
  // Populate guru filter on first load
  if (!CACHE.teachers.length) {
    const tr = await API.get('/teachers');
    if (tr.ok) CACHE.teachers = tr.data;
    if (!CACHE.classes.length) { const cr = await API.get('/classes'); if (cr.ok) CACHE.classes = cr.data; }
    if (!CACHE.subjects.length) { const sr = await API.get('/subjects'); if (sr.ok) CACHE.subjects = sr.data; }

    const sel = document.getElementById('schFilterGuru');
    if (sel && sel.options.length <= 1) {
      CACHE.teachers.forEach(t => {
        const o = document.createElement('option');
        o.value = t.id; o.textContent = t.nama;
        sel.appendChild(o);
      });
    }
  }

  const guruId = document.getElementById('schFilterGuru').value;
  const hari   = document.getElementById('schFilterHari').value;
  const q = new URLSearchParams();
  if (guruId) q.set('teacher_id', guruId);
  if (hari)   q.set('hari', hari);
  const r = await API.get('/schedule?' + q.toString());
  const el = document.getElementById('scheduleTable');
  if (!r.ok) { el.innerHTML = `<div class="warn-box">${escapeHtml(r.error)}</div>`; return; }
  if (!r.data.length) { el.innerHTML = '<div class="empty"><div class="ei">📭</div><p>Tiada jadual</p></div>'; return; }

  const rows = r.data.map(j => `<tr>
    <td>${escapeHtml(j.hari)}</td>
    <td>${escapeHtml(j.masa)}</td>
    <td>${escapeHtml(j.teacher_name||'')}</td>
    <td>${escapeHtml(j.kelas_name||'')}</td>
    <td>${escapeHtml(j.subject_kod||'')}</td>
    <td class="actions">
      <button class="action-btn action-edit" onclick='editSchedule(${JSON.stringify(j).replace(/'/g,"&#39;")})'>Edit</button>
      <button class="action-btn action-del" onclick="deleteSchedule(${j.id})">Padam</button>
    </td>
  </tr>`).join('');
  el.innerHTML = `
    <div class="atable-wrap"><table class="atable">
      <thead><tr><th>Hari</th><th>Masa</th><th>Guru</th><th>Kelas</th><th>Subjek</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}
function openScheduleModal(j) {
  const teacherOpts = CACHE.teachers.map(t => `<option value="${t.id}" ${j&&j.teacher_id===t.id?'selected':''}>${escapeHtml(t.nama)}</option>`).join('');
  const classOpts   = CACHE.classes.map(c => `<option value="${c.id}" ${j&&j.kelas_id===c.id?'selected':''}>${escapeHtml(c.nama_kelas)}</option>`).join('');
  const subjOpts    = CACHE.subjects.map(s => `<option value="${s.id}" ${j&&j.subject_id===s.id?'selected':''}>${escapeHtml(s.kod)}</option>`).join('');

  showAdminModal(j?'Edit Jadual':'Tambah Jadual', `
    <div class="fg"><label>Hari <span>*</span></label>
      <select class="fc" id="jHari">
        ${['ISNIN','SELASA','RABU','KHAMIS','JUMAAT'].map(h=>`<option value="${h}" ${j&&j.hari===h?'selected':''}>${h}</option>`).join('')}
      </select></div>
    <div class="fg"><label>Masa <span>*</span></label>
      <input class="fc" id="jMasa" value="${escapeHtml(j?.masa||'')}" placeholder="cth: 8:00-8:30 atau 8.00-8.30" required/></div>
    <div class="fg"><label>Guru <span>*</span></label>
      <select class="fc" id="jGuru"><option value="">— Pilih —</option>${teacherOpts}</select></div>
    <div class="fg"><label>Kelas <span>*</span></label>
      <select class="fc" id="jKelas"><option value="">— Pilih —</option>${classOpts}</select></div>
    <div class="fg"><label>Subjek</label>
      <select class="fc" id="jSubj"><option value="">— Pilih —</option>${subjOpts}</select></div>
    <div class="btn-row">
      <button class="btn btn-ghost" onclick="closeAdminModal()">Batal</button>
      <button class="btn btn-hijau" onclick="saveSchedule(${j?.id||'null'})">Simpan</button>
    </div>
  `);
}
function editSchedule(j){ openScheduleModal(j); }
async function saveSchedule(id) {
  const teacherId = Number(document.getElementById('jGuru').value);
  const kelasId   = Number(document.getElementById('jKelas').value);
  const subjectId = Number(document.getElementById('jSubj').value) || null;

  // Sertakan snapshot nama untuk dikekalkan walaupun referensi diubah
  const teacher = CACHE.teachers.find(t => t.id === teacherId);
  const kelas   = CACHE.classes.find(c => c.id === kelasId);
  const subj    = subjectId ? CACHE.subjects.find(s => s.id === subjectId) : null;

  const body = {
    hari:         document.getElementById('jHari').value,
    masa:         document.getElementById('jMasa').value.trim(),
    teacher_id:   teacherId,
    teacher_name: teacher ? teacher.nama : '',
    kelas_id:     kelasId,
    kelas_name:   kelas ? kelas.nama_kelas : '',
    subject_id:   subjectId,
    subject_kod:  subj ? subj.kod : null,
  };
  if (!body.hari||!body.masa||!body.teacher_id||!body.kelas_id) {
    showToast('Sila lengkapkan medan wajib','err'); return;
  }
  const r = id ? await API.put(`/schedule/${id}`, body) : await API.post('/schedule', body);
  showToast(r.ok ? '✅ Berjaya' : ('⚠️ '+r.error), r.ok?'ok':'err');
  if (r.ok) { closeAdminModal(); loadSchedule(); }
}
async function deleteSchedule(id) {
  if (!confirm('Padam slot jadual ini?')) return;
  const r = await API.del('/schedule/' + id);
  showToast(r.ok ? '✅ Berjaya' : ('⚠️ '+r.error), r.ok?'ok':'err');
  if (r.ok) loadSchedule();
}

// ═══════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════
async function loadSettings() {
  const r = await API.get('/settings');
  const el = document.getElementById('settingsForm');
  if (!r.ok) { el.innerHTML = `<div class="warn-box">${escapeHtml(r.error)}</div>`; return; }

  const uname = (CURRENT_ADMIN && CURRENT_ADMIN.username) ? CURRENT_ADMIN.username : '';
  const akaunHtml = `
    <div class="dash-card" style="margin-bottom:18px;max-width:480px">
      <h3>Akaun</h3>
      <div class="fg">
        <label>Username</label>
        <input class="fc" id="accUser" value="${escapeHtml(uname)}" autocomplete="username"/>
      </div>
      <div class="fg">
        <label>Password</label>
        <input class="fc" id="accPass" type="password" placeholder="Biar kosong jika tidak mahu tukar" autocomplete="new-password"/>
      </div>
      <button class="btn btn-hijau btn-auto" onclick="saveAccount()">Simpan Akaun</button>
    </div>
  `;

  const settingsHtml = !r.data.length
    ? '<div class="empty"><div class="ei">📭</div><p>Tiada tetapan</p></div>'
    : `
    <div class="info-box">
      Tetapan ini disimpan dalam database dan menggantikan nilai default. Klik Simpan untuk setiap baris yang ditukar.
    </div>
    <div class="atable-wrap"><table class="atable">
      <thead><tr><th>Kekunci</th><th>Nilai</th><th>Keterangan</th><th></th></tr></thead>
      <tbody>
        ${r.data.map(s => `<tr>
          <td><code>${escapeHtml(s.key)}</code></td>
          <td><input class="fc" id="set-${s.key}" value="${escapeHtml(s.value||'')}"/></td>
          <td style="font-size:.75rem;color:var(--kelabu)">${escapeHtml(s.deskripsi||'')}</td>
          <td><button class="action-btn action-edit" onclick="saveSetting('${escapeHtml(s.key)}')">Simpan</button></td>
        </tr>`).join('')}
      </tbody>
    </table></div>
    <div style="margin-top:14px">
      <button class="btn btn-ghost btn-auto" onclick="clearCache()">🔄 Clear Settings Cache</button>
    </div>
  `;

  el.innerHTML = akaunHtml + settingsHtml;
}
async function saveAccount() {
  const username = document.getElementById('accUser').value.trim();
  const password = document.getElementById('accPass').value;
  if (!username) { showToast('Username diperlukan','err'); return; }
  if (password && password.length < 6) { showToast('Password minimum 6 aksara','err'); return; }

  const r = await API.put('/account', { username: username, password: password });
  if (!r.ok) { showToast('⚠️ ' + (r.error || 'Gagal'), 'err'); return; }

  if (CURRENT_ADMIN) CURRENT_ADMIN.username = r.username || username;
  const nameEl = document.getElementById('adminName');
  if (nameEl) nameEl.textContent = `👤 ${CURRENT_ADMIN.username}`;
  const passEl = document.getElementById('accPass');
  if (passEl) passEl.value = '';
  showToast(password ? '✅ Akaun & password dikemaskini' : '✅ Username dikemaskini','ok');
}
async function saveSetting(key) {
  const val = document.getElementById('set-' + key).value;
  const r = await API.put('/settings/' + encodeURIComponent(key), { value: val });
  showToast(r.ok ? '✅ Tersimpan' : ('⚠️ '+r.error), r.ok?'ok':'err');
}
async function clearCache() {
  const r = await API.post('/cache/clear');
  showToast(r.ok ? '✅ Cache cleared' : ('⚠️ '+r.error), r.ok?'ok':'err');
}

// ═══════════════════════════════════════════════════════════
// DISABLED SLOTS
// ═══════════════════════════════════════════════════════════
async function loadDisabled() {
  const r = await API.get('/disabled-slots');
  const el = document.getElementById('disabledTable');
  if (!r.ok) { el.innerHTML = `<div class="warn-box">${escapeHtml(r.error)}</div>`; return; }
  if (!r.data.length) { el.innerHTML = '<div class="empty"><div class="ei">📭</div><p>Tiada disabled slot</p></div>'; return; }

  const rows = r.data.map(d => `<tr class="${!d.aktif?'inactive':''}">
    <td><span class="badge ${d.jenis==='REHAT'?'badge-pdp':'badge-umum'}">${escapeHtml(d.jenis||'-')}</span></td>
    <td>${escapeHtml(d.hari_type||'SEMUA')}</td>
    <td>${escapeHtml(d.masa)}</td>
    <td>${escapeHtml(d.keterangan||'')}</td>
    <td><span class="badge badge-${d.aktif?'aktif':'tidak'}">${d.aktif?'Aktif':'Tidak'}</span></td>
    <td class="actions">
      <button class="action-btn action-edit" onclick='editDisabled(${JSON.stringify(d).replace(/'/g,"&#39;")})'>Edit</button>
      <button class="action-btn action-del" onclick="deleteDisabled(${d.id})">Padam</button>
    </td>
  </tr>`).join('');
  el.innerHTML = `
    <div class="atable-wrap"><table class="atable">
      <thead><tr><th>Jenis</th><th>Hari</th><th>Masa</th><th>Keterangan</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}
function openDisabledModal(d) {
  showAdminModal(d?'Edit Disabled':'Tambah Disabled Slot', `
    <div class="fg"><label>Jenis <span>*</span></label>
      <select class="fc" id="dJenis">
        <option value="REHAT" ${d&&d.jenis==='REHAT'?'selected':''}>REHAT</option>
        <option value="SOLAT" ${d&&d.jenis==='SOLAT'?'selected':''}>SOLAT</option>
        <option value="LAIN"  ${d&&d.jenis==='LAIN'?'selected':''}>LAIN-LAIN</option>
      </select></div>
    <div class="fg"><label>Hari <span>*</span></label>
      <select class="fc" id="dHari">
        <option value="BIASA"  ${d&&d.hari_type==='BIASA'?'selected':''}>BIASA (Isnin-Khamis)</option>
        <option value="JUMAAT" ${d&&d.hari_type==='JUMAAT'?'selected':''}>JUMAAT</option>
        <option value="SEMUA"  ${d&&d.hari_type==='SEMUA'?'selected':''}>SEMUA HARI</option>
        ${['ISNIN','SELASA','RABU','KHAMIS'].map(h=>`<option value="${h}" ${d&&d.hari_type===h?'selected':''}>${h}</option>`).join('')}
      </select></div>
    <div class="fg"><label>Masa <span>*</span></label>
      <input class="fc" id="dMasa" value="${escapeHtml(d?.masa||'')}" placeholder="cth: 10:40-11:30" required/></div>
    <div class="fg"><label>Keterangan</label>
      <input class="fc" id="dKet" value="${escapeHtml(d?.keterangan||'')}" placeholder="cth: Waktu Rehat & Solat"/></div>
    <div class="fg">
      <label><input type="checkbox" id="dAktif" ${(!d||d.aktif)?'checked':''}/> Aktif</label>
    </div>
    <div class="btn-row">
      <button class="btn btn-ghost" onclick="closeAdminModal()">Batal</button>
      <button class="btn btn-hijau" onclick="saveDisabled(${d?.id||'null'})">Simpan</button>
    </div>
  `);
}
function editDisabled(d){ openDisabledModal(d); }
async function saveDisabled(id) {
  const body = {
    jenis:      document.getElementById('dJenis').value,
    hari_type:  document.getElementById('dHari').value,
    masa:       document.getElementById('dMasa').value.trim(),
    keterangan: document.getElementById('dKet').value.trim() || null,
    aktif:      document.getElementById('dAktif').checked,
  };
  if (!body.masa) { showToast('Masa wajib','err'); return; }
  const r = id ? await API.put(`/disabled-slots/${id}`, body) : await API.post('/disabled-slots', body);
  showToast(r.ok ? '✅ Berjaya' : ('⚠️ '+r.error), r.ok?'ok':'err');
  if (r.ok) { closeAdminModal(); loadDisabled(); }
}
async function deleteDisabled(id) {
  if (!confirm('Padam slot ini?')) return;
  const r = await API.del('/disabled-slots/' + id);
  showToast(r.ok ? '✅ Berjaya' : ('⚠️ '+r.error), r.ok?'ok':'err');
  if (r.ok) loadDisabled();
}

// ═══════════════════════════════════════════════════════════
// HOLIDAYS
// ═══════════════════════════════════════════════════════════
async function loadHolidays() {
  const r = await API.get('/holidays');
  const el = document.getElementById('holidaysTable');
  if (!r.ok) { el.innerHTML = `<div class="warn-box">${escapeHtml(r.error)}</div>`; return; }
  if (!r.data.length) { el.innerHTML = '<div class="empty"><div class="ei">🎉</div><p>Tiada cuti direkodkan</p></div>'; return; }

  const rows = r.data.map(h => `<tr>
    <td>${escapeHtml(h.tarikh)}</td>
    <td>${escapeHtml(h.label||'')}</td>
    <td class="actions">
      <button class="action-btn action-del" onclick="deleteHoliday(${h.id})">Padam</button>
    </td>
  </tr>`).join('');
  el.innerHTML = `
    <div class="atable-wrap"><table class="atable">
      <thead><tr><th>Tarikh</th><th>Keterangan</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}
function openHolidayModal() {
  showAdminModal('Tambah Cuti', `
    <div class="fg"><label>Tarikh <span>*</span></label>
      <input class="fc" id="hTarikh" type="date" required/></div>
    <div class="fg"><label>Keterangan <span>*</span></label>
      <input class="fc" id="hLabel" placeholder="cth: Hari Raya Aidilfitri" required/></div>
    <div class="btn-row">
      <button class="btn btn-ghost" onclick="closeAdminModal()">Batal</button>
      <button class="btn btn-hijau" onclick="saveHoliday()">Simpan</button>
    </div>
  `);
}
async function saveHoliday() {
  const body = {
    tarikh: document.getElementById('hTarikh').value,
    label:  document.getElementById('hLabel').value.trim(),
  };
  if (!body.tarikh || !body.label) { showToast('Tarikh & keterangan wajib','err'); return; }
  const r = await API.post('/holidays', body);
  showToast(r.ok ? '✅ Berjaya' : ('⚠️ '+r.error), r.ok?'ok':'err');
  if (r.ok) { closeAdminModal(); loadHolidays(); }
}
async function deleteHoliday(id) {
  if (!confirm('Padam cuti ini?')) return;
  const r = await API.del('/holidays/' + id);
  showToast(r.ok ? '✅ Berjaya' : ('⚠️ '+r.error), r.ok?'ok':'err');
  if (r.ok) loadHolidays();
}

// ═══════════════════════════════════════════════════════════
// MODAL HELPERS
// ═══════════════════════════════════════════════════════════
function showAdminModal(title, bodyHtml) {
  document.getElementById('adminModalTitle').textContent = title;
  document.getElementById('adminModalBody').innerHTML = bodyHtml;
  document.getElementById('adminModal').classList.add('open');
}
function closeAdminModal() {
  document.getElementById('adminModal').classList.remove('open');
}

// ═══════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════
function showToast(msg, type) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast ${type||''} show`;
  setTimeout(()=>{ t.className = 'toast'; }, 3800);
}
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Close modal on overlay click
document.addEventListener('DOMContentLoaded', () => {
  const ov = document.getElementById('adminModal');
  if (ov) ov.addEventListener('click', e => { if (e.target === ov) closeAdminModal(); });
});
