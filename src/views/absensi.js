import * as XLSX from 'xlsx';
import { supabase } from '../supabase.js';
import { store, isAdmin, onStore, reloadStore } from '../store.js';
import { $, esc, toast, confirmDialog, norm, natural, debounce } from '../utils.js';

let root, unsub, preview = null, q = '', lineFilter = '';
const LS_KEY = 'hoga.absensi.url';

export function mount(el) {
  root = el; preview = null; q = ''; lineFilter = '';
  const admin = isAdmin();
  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <h2>Absensi karyawan</h2>
        <p>Data NIK, nama, dan line dipakai untuk pengisian otomatis di halaman Counting. Kolom yang dibaca: <strong>NIK</strong>, <strong>Nama</strong>, <strong>Line</strong>.</p>
      </div>
      ${admin ? `
      <section class="card">
        <h3>Ambil data dari spreadsheet</h3>
        <div class="m-grid">
          <div>
            <div class="drop" id="drop">
              <p style="margin:0 0 10px">Tarik file Excel / CSV ke sini</p>
              <button class="btn ghost" type="button" id="btn-pick">Pilih file…</button>
              <input type="file" id="file" accept=".xlsx,.xls,.csv">
            </div>
          </div>
          <div>
            <label class="field"><span>Atau tempel link Google Sheets</span>
              <input type="text" id="in-url" placeholder="https://docs.google.com/spreadsheets/d/…"></label>
            <p class="muted" style="margin:6px 0 10px;font-size:12px">Sheet harus dibagikan dengan akses "Siapa saja yang memiliki link: Pelihat". Jika link berisi <code>gid=</code>, tab itu yang dibaca.</p>
            <button class="btn" type="button" id="btn-fetch">Ambil dari link</button>
          </div>
        </div>
      </section>
      <section class="card" id="preview-card" hidden></section>` : `
      <div class="banner info">Hanya admin yang dapat mengimpor data absensi. Anda dapat melihat daftarnya.</div>`}

      <section class="card">
        <h3>Daftar karyawan <span class="muted" id="emp-count" style="font-weight:400"></span></h3>
        <div class="toolbar">
          <select id="flt-line" style="max-width:200px" aria-label="Filter line"></select>
          <input id="flt-q" type="search" placeholder="Cari NIK atau nama…" aria-label="Cari karyawan">
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>NIK</th><th>Nama</th><th>Line</th><th></th></tr></thead>
            <tbody id="b-emp"></tbody>
          </table>
        </div>
      </section>
    </div>`;

  $('#flt-q').addEventListener('input', debounce((e) => { q = e.target.value; renderList(); }, 150));
  $('#flt-line').addEventListener('change', (e) => { lineFilter = e.target.value; renderList(); });
  unsub = onStore((w) => { if (w === 'employees' || w === 'all') renderList(); });

  if (admin) {
    const drop = $('#drop'), file = $('#file');
    $('#btn-pick').addEventListener('click', () => file.click());
    file.addEventListener('change', () => { if (file.files[0]) readFile(file.files[0]); file.value = ''; });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });
    try { $('#in-url').value = localStorage.getItem(LS_KEY) || ''; } catch { /* abaikan */ }
    $('#btn-fetch').addEventListener('click', fetchFromLink);
  }
  renderList();
}

export function unmount() { if (unsub) unsub(); root = null; preview = null; }

/* ---------- Membaca spreadsheet ---------- */
const HEAD = {
  nik: ['nik', 'no nik', 'nomor induk', 'nomor induk karyawan', 'id', 'id karyawan', 'employee id', 'nip'],
  name: ['nama', 'name', 'nama karyawan', 'nama operator', 'karyawan', 'operator', 'employee name'],
  line: ['line', 'lini', 'nama line', 'line kerja', 'dept line']
};

function parseSheet(wb) {
  // Pakai sheet pertama yang memiliki kolom NIK dan Nama.
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, defval: '', blankrows: false });
    for (let h = 0; h < Math.min(rows.length, 15); h++) {
      const cells = rows[h].map((c) => norm(c).toLowerCase().replace(/\s+/g, ' '));
      const find = (names) => cells.findIndex((c) => names.includes(c.toLowerCase()));
      const iN = find(HEAD.nik), iM = find(HEAD.name);
      if (iN < 0 || iM < 0) continue;
      const iL = find(HEAD.line);
      const out = [];
      for (let r = h + 1; r < rows.length; r++) {
        const nik = String(rows[r][iN] ?? '').trim();
        const name = String(rows[r][iM] ?? '').trim();
        const line = iL >= 0 ? String(rows[r][iL] ?? '').trim() : '';
        if (!nik && !name && !line) continue;
        out.push({ nik, name, line, row: r + 1 });
      }
      return { sheet: sn, rows: out, hasLine: iL >= 0 };
    }
  }
  return null;
}

async function readFile(f) {
  try {
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: false });
    showPreview(parseSheet(wb), f.name);
  } catch (e) {
    console.error(e); toast('File tidak bisa dibaca. Pastikan formatnya xlsx, xls, atau csv.', 'bad');
  }
}

function sheetLinkToParams(url) {
  const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) return null;
  const g = String(url).match(/[#&?]gid=(\d+)/);
  return { id: m[1], gid: g ? g[1] : '' };
}

async function fetchFromLink() {
  const url = $('#in-url').value.trim();
  const p = sheetLinkToParams(url);
  if (!p) { toast('Link Google Sheets tidak valid', 'warn'); return; }
  const btn = $('#btn-fetch'); btn.disabled = true; btn.textContent = 'Mengambil…';
  try {
    const { data: s } = await supabase.auth.getSession();
    const res = await fetch(`/api/sheet-proxy?id=${encodeURIComponent(p.id)}${p.gid ? '&gid=' + p.gid : ''}`, {
      headers: { Authorization: 'Bearer ' + (s.session?.access_token || '') }
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `HTTP ${res.status}`);
    }
    const text = await res.text();
    const wb = XLSX.read(text, { type: 'string' });
    try { localStorage.setItem(LS_KEY, url); } catch { /* abaikan */ }
    showPreview(parseSheet(wb), 'Google Sheets');
  } catch (e) {
    console.error(e);
    toast('Gagal mengambil sheet: ' + e.message, 'bad');
  } finally {
    btn.disabled = false; btn.textContent = 'Ambil dari link';
  }
}

/* ---------- Pratinjau & simpan ---------- */
function showPreview(parsed, source) {
  const card = $('#preview-card');
  if (!parsed) {
    card.hidden = false;
    card.innerHTML = `<h3>Pratinjau impor</h3><div class="form-error">Kolom NIK dan Nama tidak ditemukan. Pastikan baris judul memuat "NIK", "Nama", dan (opsional) "Line".</div>`;
    preview = null; return;
  }
  const existing = new Map(store.employees.map((e) => [norm(e.nik), e]));
  const seen = new Set();
  const items = parsed.rows.map((r) => {
    const nik = r.nik.toUpperCase(), key = norm(nik);
    let status = 'new', msg = '';
    if (!nik || !r.name) { status = 'err'; msg = !nik ? 'NIK kosong' : 'Nama kosong'; }
    else if (seen.has(key)) { status = 'err'; msg = 'NIK dobel di file'; }
    else {
      seen.add(key);
      const ex = existing.get(key);
      if (ex) status = (norm(ex.name) === norm(r.name) && norm(ex.line_name) === norm(r.line)) ? 'same' : 'upd';
    }
    return { ...r, nik, status, msg };
  });
  preview = items;
  const c = (s) => items.filter((i) => i.status === s).length;
  const todo = c('new') + c('upd');
  card.hidden = false;
  card.innerHTML = `
    <h3>Pratinjau impor <span class="muted" style="font-weight:400">— ${esc(source)}, tab ${esc(parsed.sheet)}</span></h3>
    <p style="margin:0 0 8px">
      <span class="pill new">${c('new')} baru</span>
      <span class="pill upd">${c('upd')} berubah</span>
      <span class="pill same">${c('same')} sama</span>
      <span class="pill err">${c('err')} bermasalah</span>
      ${parsed.hasLine ? '' : '<span class="muted"> · kolom Line tidak ditemukan, line dikosongkan</span>'}
    </p>
    <div class="table-wrap" style="max-height:300px">
      <table class="data"><thead><tr><th>Baris</th><th>NIK</th><th>Nama</th><th>Line</th><th>Status</th></tr></thead>
      <tbody>${items.slice(0, 300).map((i) => `<tr class="${i.status === 'same' ? 'dim' : ''}">
        <td>${i.row}</td><td>${esc(i.nik)}</td><td>${esc(i.name)}</td><td>${esc(i.line)}</td>
        <td><span class="pill ${i.status === 'new' ? 'new' : i.status === 'upd' ? 'upd' : i.status === 'same' ? 'same' : 'err'}">${
          { new: 'Baru', upd: 'Ubah', same: 'Sama', err: i.msg }[i.status]}</span></td></tr>`).join('')}</tbody></table>
    </div>
    ${items.length > 300 ? `<p class="muted" style="margin:6px 0 0">Menampilkan 300 baris pertama dari ${items.length}.</p>` : ''}
    <div class="toolbar">
      <button class="btn" type="button" id="btn-save" ${todo ? '' : 'disabled'}>Simpan ${todo} data</button>
      <button class="btn ghost" type="button" id="btn-cancel">Batal</button>
      <span class="muted">Baris bermasalah dilewati. NIK yang sudah ada diperbarui, tidak dihapus.</span>
    </div>`;
  $('#btn-cancel').addEventListener('click', () => { preview = null; card.hidden = true; card.innerHTML = ''; });
  $('#btn-save').addEventListener('click', saveImport);
}

async function saveImport() {
  if (!preview) return;
  const rows = preview.filter((i) => i.status === 'new' || i.status === 'upd')
    .map((i) => ({ nik: i.nik, name: i.name, line_name: i.line || null, updated_at: new Date().toISOString() }));
  if (!rows.length) return;
  const btn = $('#btn-save'); btn.disabled = true; btn.textContent = 'Menyimpan…';
  try {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from('employees').upsert(rows.slice(i, i + 500), { onConflict: 'nik' });
      if (error) throw error;
    }
    await reloadStore();
    toast(`${rows.length} data absensi tersimpan`);
    preview = null; const card = $('#preview-card'); card.hidden = true; card.innerHTML = '';
  } catch (e) {
    console.error(e);
    toast('Gagal menyimpan: ' + (e.message || e), 'bad');
    btn.disabled = false; btn.textContent = `Simpan ${rows.length} data`;
  }
}

/* ---------- Daftar ---------- */
function renderList() {
  if (!root) return;
  const lines = [...new Set(store.employees.map((e) => e.line_name || ''))].sort(natural);
  const fl = $('#flt-line'), cur = lineFilter;
  fl.innerHTML = '<option value="">Semua line</option>' + lines.map((l) => `<option value="${esc(l)}">${esc(l || '(tanpa line)')}</option>`).join('');
  fl.value = lines.includes(cur) ? cur : ''; lineFilter = fl.value;

  const s = norm(q);
  const list = store.employees.filter((e) => (!lineFilter || (e.line_name || '') === lineFilter)
    && (!s || norm(e.nik).includes(s) || norm(e.name).includes(s)));
  $('#emp-count').textContent = `(${list.length} dari ${store.employees.length})`;
  const tb = $('#b-emp'), admin = isAdmin();
  tb.textContent = '';
  if (!list.length) {
    tb.innerHTML = `<tr><td colspan="4" class="muted">${store.employees.length ? 'Tidak ada yang cocok.' : 'Belum ada data absensi. Impor dari spreadsheet di atas.'}</td></tr>`;
    return;
  }
  list.slice(0, 300).forEach((e) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${esc(e.nik)}</td><td>${esc(e.name)}</td><td>${esc(e.line_name || '')}</td><td></td>`;
    if (admin) {
      const del = document.createElement('button'); del.type = 'button'; del.className = 'link-danger'; del.textContent = 'Hapus';
      del.addEventListener('click', async () => {
        if (!(await confirmDialog(`Hapus ${e.name} (${e.nik}) dari data absensi?`))) return;
        const { error } = await supabase.from('employees').delete().eq('nik', e.nik);
        if (error) toast('Gagal menghapus: ' + error.message, 'bad'); else toast('Karyawan dihapus');
      });
      const wrap = document.createElement('div'); wrap.className = 'row-actions'; wrap.appendChild(del);
      tr.lastElementChild.appendChild(wrap);
    }
    tb.appendChild(tr);
  });
  if (list.length > 300) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="4" class="muted">Menampilkan 300 pertama. Persempit dengan pencarian atau filter line.</td>`;
    tb.appendChild(tr);
  }
}
