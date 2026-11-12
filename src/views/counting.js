import * as XLSX from 'xlsx';
import { supabase } from '../supabase.js';
import {
  store, canWrite, isAdmin, onStore, lineById, styleById, stylesOfLine, buyerById, employeeByNik, employeesOfLine
} from '../store.js';
import {
  $, $$, esc, num, disp, raw, parseNum, nf1, todayStr, sanitizeFile, setSaveState, toast, norm
} from '../utils.js';

/* ---------- Konfigurasi modul ---------- */
const DEFAULT_WH = 10, DEFAULT_TARGET = 30;
const MODULES = [
  { key: 'PART', label: 'PART', n: 3 },
  { key: 'HOOD', label: 'HOOD', n: 8 },
  { key: 'FRONT', label: 'FRONT', n: 16 },
  { key: 'BACKSLEEVE', label: 'BACKSLEEVE', n: 5 },
  { key: 'JOIN', label: 'JOIN', n: 12 },
  { key: 'QCHALF', label: 'QC HALFLINE', n: 1, single: true, target: null },
  { key: 'ASSEMBLY', label: 'ASSEMBLY', n: 4 },
  { key: 'RND', label: 'RND ASSEMBLY', n: 4 },
  { key: 'QCRND', label: 'QC RND', n: 1, single: true },
  { key: 'GOSOK', label: 'GOSOK', n: 1, single: true },
  { key: 'QCEND', label: 'QC ENDLINE', n: 1, single: true }
];
const MOD = Object.fromEntries(MODULES.map((m) => [m.key, m]));
const OUT = ['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7', 'o8', 'o9'];
const NUM = ['pqty', 'st', 'target', ...OUT, 'wh'];
const TXT = ['nik', 'operator', 'proses', 'sched', 'tc1', 'tc2'];
const LABEL = { nik: 'NIK', operator: 'Operator', proses: 'Proses', sched: 'First output', pqty: 'P.Qty', st: 'Target jadwal', target: 'Target', tc1: 'TC 1', tc2: 'TC 2', wh: 'W/H' };
OUT.forEach((f, i) => { LABEL[f] = 'Output jam ke-' + (i + 1); });

const LEGEND = {
  hourly: 'Isi output tiap jam dengan jumlah hasil jam itu saja. Pcs/jam di samping tiap output adalah rata-rata sejak jam pertama. Output/hari adalah total semua jam, dan pcs/jam harian adalah output/hari dibagi W/H.',
  cumulative: 'Isi output tiap jam dengan jumlah kumulatif sejak awal shift. Pcs/jam di samping tiap output adalah output dibagi jumlah jam. Output/hari adalah nilai tertinggi, dan pcs/jam harian adalah output/hari dibagi W/H.'
};
const LEGEND_COLOR = ' Hijau: mencapai target. Kuning: 80–99% target. Merah: di bawah 80%. Isi W/H dengan jam kerja yang sudah berjalan jika shift belum selesai.';

/* ---------- State ---------- */
let S, root, unsubStore, channel, queues, profiles;

function freshState() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('hoga.sel') || '{}'); } catch { /* abaikan */ }
  return {
    lineId: saved.lineId || null,
    styleId: saved.styleId || null,
    date: todayStr(),
    day: null,          // record counting_days untuk style+tanggal terpilih
    days: [],           // daftar tanggal yang sudah ada data
    rows: {},           // row_key -> data
    rowMeta: {},        // row_key -> {by, at}
    pending: 0,
    built: '',
    loadToken: 0
  };
}

const getMode = () => (S.day?.mode === 'cumulative' ? 'cumulative' : 'hourly');
const defaultWh = () => num(S.day?.wh) ?? DEFAULT_WH;
const rowCounts = () => S.day?.counts || {};
const writable = () => canWrite();

/* ---------- Kerangka halaman ---------- */
export function mount(el) {
  root = el; S = freshState(); queues = new Map(); profiles = {};
  root.innerHTML = `
    <div class="page">
      <div class="bar">
        <label class="field"><span>Line</span><select id="sel-line"></select></label>
        <label class="field"><span>Style</span><select id="sel-style"></select></label>
        <div class="ro"><span class="lbl">Buyer</span><strong id="buyer">–</strong></div>
        <label class="field"><span>Tanggal</span><input type="date" id="sel-date"></label>
        <div class="actions">
          <button class="btn ghost" id="btn-copy" type="button" title="Isi NIK, operator, dan proses dari tanggal terakhir yang ada datanya">Salin dari hari sebelumnya</button>
          <button class="btn" id="btn-export" type="button">Export Excel</button>
        </div>
      </div>
      <div id="banner" class="banner" hidden></div>
      <div class="chips" id="chips" hidden></div>
      <div class="stats" id="summary">
        <div class="stat"><div class="k">Operator input</div><div class="v" id="s-in">0</div></div>
        <div class="stat"><div class="k">Operator output</div><div class="v" id="s-out">0</div></div>
        <div class="stat"><div class="k">Operator line</div><input id="s-line" class="n" inputmode="numeric" aria-label="Jumlah operator line"></div>
        <div class="stat"><div class="k">Jam kerja (W/H)</div><input id="s-wh" class="n" inputmode="decimal" aria-label="Jam kerja standar"></div>
        <div class="stat"><div class="k">Isi output</div>
          <select id="s-mode" aria-label="Cara pengisian output"><option value="hourly">Per jam</option><option value="cumulative">Kumulatif</option></select></div>
        <div class="stat"><div class="k">Total output</div><div class="v" id="s-total">0</div></div>
        <div class="stat"><div class="k">Rata-rata pcs/jam</div><div class="v" id="s-avg">–</div></div>
        <div class="stat"><div class="k">Di bawah target</div><div class="v" id="s-low">0</div></div>
      </div>
      <div id="empty" class="empty" hidden>
        <strong>Belum ada line dan style</strong>
        <span>Tambahkan line dan style di halaman <a href="#master">Master data</a>.</span>
      </div>
      <div class="sheetwrap" id="sheetwrap">${tableShell()}</div>
      <p class="legend" id="legend"></p>
      <datalist id="dl-nik"></datalist>
      <datalist id="dl-name"></datalist>
    </div>`;

  wire();
  unsubStore = onStore((what) => { if (['lines', 'styles', 'buyers', 'employees', 'all'].includes(what)) { if (what === 'employees') fillDatalists(); else renderSelectors(); } });
  $('#sel-date').value = S.date;
  buildTable(); applyMeta(); applyRows();
  loadProfiles();
  renderSelectors();
  fillDatalists();
  setSaveState('');
}

export function unmount() {
  if (unsubStore) unsubStore();
  closeChannel();
  setSaveState('');
  root = null;
}

function tableShell() {
  const cols = [92, 36, 96, 120, 150, 72, 64, 72, 72, 56, 52, 52, ...Array(18).fill(58), 72, 48, 68];
  const outHead = Array.from({ length: 9 }, (_, i) => `<th class="gb">Output ${i + 1}</th><th>Pcs/jam</th>`).join('');
  return `<table class="sheet" id="sheet" aria-label="Counting sewing harian">
    <colgroup>${cols.map((w) => `<col style="width:${w}px">`).join('')}</colgroup>
    <thead>
      <tr class="g1">
        <th colspan="2" class="stick1">Posisi</th><th colspan="3">Operator &amp; proses</th>
        <th colspan="5">Jadwal &amp; target</th><th colspan="2">TC</th>
        <th colspan="18" id="th-date">Output per jam</th><th colspan="3">Harian</th>
      </tr>
      <tr class="g2">
        <th class="stick1">Modul</th><th class="stick2">No</th>
        <th>NIK</th><th>Operator</th><th>Proses</th>
        <th>First output</th><th>P.Qty</th><th>Target jadwal</th><th>Jadwal/jam</th><th>Target</th>
        <th>TC 1</th><th>TC 2</th>${outHead}
        <th>Output/hari</th><th>W/H</th><th>Pcs/jam</th>
      </tr>
    </thead>
    <tbody id="tbody"></tbody>
  </table>`;
}

/* ---------- Tabel ---------- */
function buildTable() {
  const counts = rowCounts();
  S.built = JSON.stringify(counts);
  const parts = [];
  MODULES.forEach((m) => {
    const n = Math.max(1, Number(counts[m.key]) || m.n);
    for (let i = 1; i <= n; i++) {
      const id = `${m.key}_${i}`, no = m.single ? '' : i, lab = m.label + (m.single ? '' : ' ' + i);
      let h = `<tr data-id="${id}" data-m="${m.key}" data-no="${m.single ? 0 : i}">`;
      if (i === 1) {
        h += `<td class="stick1 mod" rowspan="${n}"><span>${m.label}</span>${m.single ? '' :
          `<div class="minis"><button type="button" class="mini" data-act="add" data-m="${m.key}" aria-label="Tambah baris ${m.label}">+</button><button type="button" class="mini" data-act="del" data-m="${m.key}" aria-label="Hapus baris kosong terakhir ${m.label}">−</button></div>`}</td>`;
      }
      h += `<td class="stick2 no">${no}</td>`;
      const t = (f, list) => `<td><input data-f="${f}" ${list ? `list="${list}"` : ''} autocomplete="off" spellcheck="false" aria-label="${LABEL[f]} ${lab}"></td>`;
      const nn = (f) => `<td><input class="n" data-f="${f}" inputmode="decimal" autocomplete="off" aria-label="${LABEL[f]} ${lab}"></td>`;
      const c = (k, cls) => `<td class="calc ${cls || ''}" data-c="${k}"></td>`;
      h += t('nik', 'dl-nik') + t('operator', 'dl-name') + t('proses') + t('sched') + nn('pqty') + nn('st') + c('stH') + nn('target') + t('tc1') + t('tc2');
      for (let k = 1; k <= 9; k++) h += nn('o' + k) + c('p' + k);
      h += c('day', 'strong') + nn('wh') + c('final', 'strong') + '</tr>';
      parts.push(h);
    }
  });
  $('#tbody').innerHTML = parts.join('');
  applyReadonly();
}

function applyReadonly() {
  const ro = !writable();
  $$('#sheet input, #summary input').forEach((i) => { i.readOnly = ro; });
  $('#s-mode').disabled = ro;
  $('#btn-copy').hidden = ro;
}

const effTarget = (d, m) => ('target' in d ? num(d.target) : (m.target === null ? null : DEFAULT_TARGET));
const effWh = (d) => num(d.wh) ?? defaultWh();

function calc(id, mkey) {
  const d = S.rows[id] || {}, m = MOD[mkey], wh = effWh(d), mode = getMode();
  const o = OUT.map((k) => num(d[k]));
  let run = 0;
  const pcs = o.map((v, k) => {
    if (mode === 'hourly') { run += v == null ? 0 : v; return v == null ? null : run / (k + 1); }
    return v == null ? null : v / (k + 1);
  });
  const vals = o.filter((v) => v != null);
  const day = !vals.length ? null : (mode === 'hourly' ? vals.reduce((a, b) => a + b, 0) : Math.max(...vals));
  const fin = day != null && wh > 0 ? day / wh : null;
  const st = num(d.st), stH = st != null && wh > 0 ? st / wh : null;
  const target = effTarget(d, m);
  let status = null;
  if (fin != null && target > 0) { const r = fin / target; status = r >= 1 ? 'ok' : (r >= 0.8 ? 'warn' : 'bad'); }
  return { d, o, pcs, day, fin, stH, target, wh, status, operator: String(d.operator || '').trim() };
}

function setCell(tr, k, text, cls) {
  const td = tr.querySelector(`[data-c="${k}"]`);
  if (!td) return;
  td.textContent = text;
  if (cls !== undefined) { td.classList.remove('ok', 'warn', 'bad'); if (cls) td.classList.add(cls); }
}
function computeRow(tr) {
  const c = calc(tr.dataset.id, tr.dataset.m);
  setCell(tr, 'stH', c.stH == null ? '' : nf1.format(c.stH));
  for (let k = 0; k < 9; k++) setCell(tr, 'p' + (k + 1), c.pcs[k] == null ? '' : nf1.format(c.pcs[k]));
  setCell(tr, 'day', c.day == null ? '' : disp(c.day));
  setCell(tr, 'final', c.fin == null ? '' : nf1.format(c.fin), c.status || '');
  return c;
}
function valueFor(inp) {
  const tr = inp.closest('tr'), f = inp.dataset.f, d = S.rows[tr.dataset.id] || {}, m = MOD[tr.dataset.m];
  if (f === 'target') return effTarget(d, m);
  if (NUM.includes(f)) return num(d[f]);
  return d[f] == null ? '' : String(d[f]);
}
function renderInput(inp) {
  const f = inp.dataset.f, v = valueFor(inp);
  if (f === 'wh') inp.placeholder = disp(defaultWh());
  inp.value = NUM.includes(f) ? disp(v) : v;
}
function applyRows() {
  $$('#tbody input[data-f]').forEach((i) => { if (document.activeElement !== i) renderInput(i); });
  $$('#tbody tr').forEach(computeRow);
  updateSummary();
  labelEditors();
}
function applyMeta() {
  if (JSON.stringify(rowCounts()) !== S.built) buildTable();
  let dl = S.date;
  try { dl = new Date(S.date + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { /* abaikan */ }
  $('#th-date').textContent = dl;
  $('#s-mode').value = getMode();
  $('#legend').textContent = LEGEND[getMode()] + LEGEND_COLOR;
  const wh = $('#s-wh'), ol = $('#s-line');
  if (document.activeElement !== wh) wh.value = disp(defaultWh());
  if (document.activeElement !== ol) ol.value = num(S.day?.operator_line) != null ? String(S.day.operator_line) : '';
}
function updateSummary() {
  let nin = 0, nout = 0, total = 0, sum = 0, cnt = 0, low = 0;
  $$('#tbody tr').forEach((tr) => {
    const c = calc(tr.dataset.id, tr.dataset.m);
    if (c.operator) nin++;
    if (c.day != null && c.day > 0) { nout++; total += c.day; }
    if (c.fin != null) { sum += c.fin; cnt++; }
    if (c.status === 'bad') low++;
  });
  $('#s-in').textContent = nin; $('#s-out').textContent = nout; $('#s-total').textContent = disp(total);
  $('#s-avg').textContent = cnt ? nf1.format(sum / cnt) : '–';
  const l = $('#s-low'); l.textContent = low; l.classList.toggle('bad', low > 0);
}

async function loadProfiles() {
  const { data } = await supabase.from('profiles').select('id,name,email');
  (data || []).forEach((p) => { profiles[p.id] = p.name || p.email; });
  labelEditors();
}
function labelEditors() {
  $$('#tbody tr').forEach((tr) => {
    const m = S.rowMeta[tr.dataset.id];
    if (!m || !m.by) { tr.removeAttribute('title'); return; }
    const who = m.by === store.session?.user.id ? 'Anda' : (profiles[m.by] || 'Seseorang');
    const t = m.at ? new Date(m.at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';
    tr.title = `Terakhir diubah oleh ${who}${t ? ' pukul ' + t : ''}`;
  });
}

/* ---------- Absensi: saran NIK & nama ---------- */
function currentLineName() { return lineById(S.lineId)?.name || ''; }
function fillDatalists() {
  if (!root) return;
  const lineEmp = employeesOfLine(currentLineName());
  const list = lineEmp.length ? lineEmp : store.employees;
  $('#dl-nik').innerHTML = list.map((e) => `<option value="${esc(e.nik)}">${esc(e.name)}</option>`).join('');
  $('#dl-name').innerHTML = list.map((e) => `<option value="${esc(e.name)}">${esc(e.nik)}</option>`).join('');
}

/* ---------- Simpan ke Supabase ---------- */
function enqueue(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(key, next);
  return next;
}
function track(p) {
  S.pending++; setSaveState('Menyimpan…');
  return p.then(() => {
    S.pending--;
    if (!S.pending) setSaveState('Tersimpan ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }), 'ok');
  }).catch((e) => {
    S.pending--;
    console.error(e);
    const denied = e && (e.code === '42501' || /row-level security/i.test(e.message || ''));
    if (denied) { showBanner('Perubahan tidak tersimpan: akun Anda tidak punya izin mengubah data. Minta admin mengubah role Anda menjadi contributor.'); setSaveState('Tidak bisa menyimpan', 'bad'); }
    else setSaveState('Gagal menyimpan, coba lagi', 'bad');
  });
}
function showBanner(text) { const b = $('#banner'); if (b) { b.hidden = !text; b.textContent = text || ''; } }

// Pastikan baris counting_days (style + tanggal) ada, kembalikan id-nya.
let dayPromise = null, dayPromiseKey = '';
function ensureDay() {
  const key = S.styleId + '|' + S.date;
  if (S.day?.id) return Promise.resolve(S.day.id);
  if (dayPromise && dayPromiseKey === key) return dayPromise;
  dayPromiseKey = key;
  const sid = S.styleId, date = S.date;
  dayPromise = (async () => {
    const { error: e1 } = await supabase.from('counting_days')
      .upsert({ style_id: sid, day: date }, { onConflict: 'style_id,day', ignoreDuplicates: true });
    if (e1) throw e1;
    const { data, error } = await supabase.from('counting_days').select('*').eq('style_id', sid).eq('day', date).single();
    if (error) throw error;
    if (sid === S.styleId && date === S.date) { S.day = data; addDayToList(data); }
    return data.id;
  })().finally(() => { dayPromise = null; });
  return dayPromise;
}
function addDayToList(d) {
  if (!S.days.some((x) => x.day === d.day)) { S.days.push(d); S.days.sort((a, b) => (a.day < b.day ? 1 : -1)); renderChips(); }
}

function saveRow(tr, patchFields) {
  const key = tr.dataset.id, uid = store.session?.user.id;
  const merged = { ...(S.rows[key] || {}), ...patchFields };
  S.rows[key] = merged;
  S.rowMeta[key] = { by: uid, at: Date.now() };
  const sid = S.styleId, date = S.date;
  track(enqueue('row/' + sid + '/' + date + '/' + key, async () => {
    if (sid !== S.styleId || date !== S.date) return;
    const dayId = await ensureDay();
    const { error } = await supabase.from('counting_rows').upsert(
      { day_id: dayId, row_key: key, data: S.rows[key], updated_by: uid, updated_at: new Date().toISOString() },
      { onConflict: 'day_id,row_key' }
    );
    if (error) throw error;
  }));
}

function saveMeta(patch) {
  if (!writable() || !S.styleId) return;
  S.day = { ...(S.day || { style_id: S.styleId, day: S.date }), ...patch };
  if (patch.counts) S.day.counts = patch.counts;
  const sid = S.styleId, date = S.date;
  track(enqueue('meta/' + sid + '/' + date, async () => {
    const body = { style_id: sid, day: date, ...patch };
    const { data, error } = await supabase.from('counting_days')
      .upsert(body, { onConflict: 'style_id,day' }).select().single();
    if (error) throw error;
    if (sid === S.styleId && date === S.date) { S.day = { ...S.day, id: data.id }; addDayToList(data); }
  }));
}

function commit(inp) {
  if (!writable()) { renderInput(inp); return; }
  const tr = inp.closest('tr'), f = inp.dataset.f;
  let val;
  if (NUM.includes(f)) {
    val = parseNum(inp.value);
    if (Number.isNaN(val)) { toast('Angka tidak valid', 'warn'); renderInput(inp); inp._dirty = false; return; }
  } else { val = inp.value.trim(); if (val === '') val = null; }
  const cur = valueFor(inp), curN = cur === '' || cur === undefined ? null : cur;
  inp._dirty = false;
  if (val === curN) { renderInput(inp); return; }

  const patch = { [f]: val };
  // Pengisian otomatis dari absensi: NIK -> nama, nama -> NIK
  if (f === 'nik' && val) {
    const emp = employeeByNik(val);
    if (emp) { if (!String((S.rows[tr.dataset.id] || {}).operator || '').trim()) patch.operator = emp.name; }
    else toast(`NIK ${val} tidak ada di data absensi`, 'warn');
  }
  if (f === 'operator' && val && !String((S.rows[tr.dataset.id] || {}).nik || '').trim()) {
    const pool = employeesOfLine(currentLineName());
    const hit = (pool.length ? pool : store.employees).filter((e) => norm(e.name) === norm(val));
    if (hit.length === 1) patch.nik = hit[0].nik;
  }
  saveRow(tr, patch);
  $$('input[data-f]', tr).forEach((i) => { if (document.activeElement !== i || i === inp) renderInput(i); });
  computeRow(tr); updateSummary();
}

/* ---------- Event ---------- */
function wire() {
  const tbody = $('#tbody');
  tbody.addEventListener('focusin', (e) => {
    const t = e.target; if (!t.dataset || !t.dataset.f) return;
    if (NUM.includes(t.dataset.f)) t.value = raw(valueFor(t));
    t._dirty = false; setTimeout(() => { try { t.select(); } catch { /* abaikan */ } });
  });
  tbody.addEventListener('input', (e) => { if (e.target.dataset?.f) e.target._dirty = true; });
  tbody.addEventListener('change', (e) => { if (e.target.dataset?.f) commit(e.target); });
  tbody.addEventListener('focusout', (e) => { const t = e.target; if (t.dataset?.f && !t._dirty) renderInput(t); });
  tbody.addEventListener('keydown', (e) => {
    const t = e.target; if (!t.dataset || !t.dataset.f) return;
    if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const down = !(e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey));
      const tr = t.closest('tr'), nx = down ? tr.nextElementSibling : tr.previousElementSibling;
      if (nx) { const ni = nx.querySelector(`input[data-f="${t.dataset.f}"]`); if (ni) ni.focus(); } else t.blur();
    } else if (e.key === 'Escape') { t._dirty = false; renderInput(t); t.blur(); }
  });
  tbody.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b || !writable() || !S.styleId) return;
    const key = b.dataset.m, m = MOD[key], n = Math.max(1, Number(rowCounts()[key]) || m.n);
    if (b.dataset.act === 'add') {
      saveMeta({ counts: { ...rowCounts(), [key]: n + 1 } }); applyMeta(); applyRows();
    } else if (n > 1) {
      const id = `${key}_${n}`, d = S.rows[id] || {};
      if ([...TXT, ...NUM].some((f) => d[f] != null && d[f] !== '')) { toast('Baris terakhir masih berisi data', 'warn'); return; }
      saveMeta({ counts: { ...rowCounts(), [key]: n - 1 } });
      if (S.rows[id]) {
        delete S.rows[id]; delete S.rowMeta[id];
        if (S.day?.id) supabase.from('counting_rows').delete().eq('day_id', S.day.id).eq('row_key', id).then(() => {});
      }
      applyMeta(); applyRows();
    }
  });

  const metaInput = (sel, fn) => {
    const el = $(sel);
    el.addEventListener('focus', () => setTimeout(() => { try { el.select(); } catch { /* abaikan */ } }));
    el.addEventListener('change', () => fn(el));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); });
  };
  $('#s-mode').addEventListener('change', (e) => { saveMeta({ mode: e.target.value }); applyMeta(); applyRows(); });
  metaInput('#s-wh', (el) => { const v = parseNum(el.value); if (Number.isNaN(v) || v == null || v <= 0) { applyMeta(); return; } saveMeta({ wh: v }); applyMeta(); applyRows(); });
  metaInput('#s-line', (el) => {
    const v = parseNum(el.value);
    if (Number.isNaN(v)) { applyMeta(); return; }
    saveMeta({ operator_line: v == null ? null : Math.round(v) }); applyMeta();
  });

  $('#sel-line').addEventListener('change', (e) => { S.lineId = e.target.value; S.styleId = null; renderSelectors(); });
  $('#sel-style').addEventListener('change', (e) => { S.styleId = e.target.value; renderSelectors(); });
  $('#sel-date').addEventListener('change', (e) => { S.date = e.target.value || todayStr(); e.target.value = S.date; loadSheet(); });
  $('#btn-export').addEventListener('click', doExport);
  $('#btn-copy').addEventListener('click', copyFromPrevious);
}

/* ---------- Pilihan line / style ---------- */
function fillSelect(sel, items, current) {
  sel.textContent = '';
  items.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); });
  if (current && items.some((i) => i[0] === current)) sel.value = current;
}
let loadedKey = '';
function renderSelectors() {
  if (!root) return;
  const lines = store.lines;
  const empty = !lines.length;
  $('#empty').hidden = !empty; $('#sheetwrap').hidden = empty; $('#legend').hidden = empty; $('#summary').hidden = empty;
  if (!lines.some((l) => l.id === S.lineId)) S.lineId = lines[0]?.id || null;
  fillSelect($('#sel-line'), lines.map((l) => [l.id, l.name]), S.lineId);
  const styles = stylesOfLine(S.lineId);
  if (!styles.some((s) => s.id === S.styleId)) S.styleId = styles[0]?.id || null;
  fillSelect($('#sel-style'), styles.map((s) => [s.id, s.code]), S.styleId);
  const st = styleById(S.styleId);
  $('#buyer').textContent = (st && buyerById(st.buyer_id)?.name) || '–';
  try { localStorage.setItem('hoga.sel', JSON.stringify({ lineId: S.lineId, styleId: S.styleId })); } catch { /* abaikan */ }
  fillDatalists();
  if (!styles.length && !empty) showBanner('Line ini belum punya style. Tambahkan di halaman Master data.'); else showBanner('');
  const key = S.styleId || '';
  if (key !== loadedKey) { loadedKey = key; loadSheet(); }
}

/* ---------- Muat data & realtime ---------- */
function closeChannel() { if (channel) { supabase.removeChannel(channel); channel = null; } }

async function loadSheet() {
  const token = ++S.loadToken;
  closeChannel();
  S.day = null; S.rows = {}; S.rowMeta = {};
  if (!S.styleId) { S.days = []; buildTable(); applyMeta(); applyRows(); renderChips(); return; }
  const sid = S.styleId, date = S.date;
  const [{ data: days, error: e1 }, { data: day, error: e2 }] = await Promise.all([
    supabase.from('counting_days').select('id,day').eq('style_id', sid).order('day', { ascending: false }).limit(10),
    supabase.from('counting_days').select('*').eq('style_id', sid).eq('day', date).maybeSingle()
  ]);
  if (token !== S.loadToken) return;
  if (e1 || e2) { setSaveState('Gagal memuat data', 'bad'); return; }
  S.days = days || []; S.day = day || null;
  await loadRows();
  if (token !== S.loadToken) return;
  buildTable(); applyMeta(); applyRows(); renderChips();
  subscribe(sid, date);
}

async function loadRows() {
  S.rows = {}; S.rowMeta = {};
  if (!S.day?.id) return;
  const { data, error } = await supabase.from('counting_rows').select('row_key,data,updated_by,updated_at').eq('day_id', S.day.id);
  if (error) { setSaveState('Gagal memuat baris', 'bad'); return; }
  (data || []).forEach((r) => { S.rows[r.row_key] = r.data || {}; S.rowMeta[r.row_key] = { by: r.updated_by, at: r.updated_at }; });
}

function subscribe(sid, date) {
  const me = store.session?.user.id;
  channel = supabase.channel('counting-' + sid + '-' + date)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'counting_days', filter: 'style_id=eq.' + sid }, (p) => {
      const row = p.new;
      if (!row || !row.id) return;
      addDayToList(row);
      if (row.day === S.date && !(S.pending && p.eventType === 'UPDATE')) {
        const hadId = S.day?.id;
        S.day = row; applyMeta(); applyRows();
        if (!hadId) loadRows().then(applyRows);
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'counting_rows' }, async (p) => {
      if (p.eventType === 'DELETE') { await loadRows(); applyRows(); return; }
      const r = p.new;
      if (!r || !S.day || r.day_id !== S.day.id) return;
      if (r.updated_by === me && S.pending) return;  // gema dari simpanan sendiri yang masih berjalan
      S.rows[r.row_key] = r.data || {}; S.rowMeta[r.row_key] = { by: r.updated_by, at: r.updated_at };
      applyRows();
    })
    .subscribe();
}

function renderChips() {
  const el = $('#chips'); if (!el) return;
  const days = [...S.days].sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 10);
  el.textContent = ''; el.hidden = !days.length; if (!days.length) return;
  const l = document.createElement('span'); l.className = 'lbl'; l.textContent = 'Sudah ada data'; el.appendChild(l);
  days.forEach((d) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.setAttribute('aria-pressed', String(d.day === S.date));
    b.textContent = new Date(d.day + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
    b.addEventListener('click', () => { S.date = d.day; $('#sel-date').value = d.day; loadSheet(); });
    el.appendChild(b);
  });
}

/* ---------- Salin NIK/operator/proses dari hari sebelumnya ---------- */
async function copyFromPrevious() {
  if (!writable() || !S.styleId) return;
  const prev = [...S.days].filter((d) => d.day < S.date).sort((a, b) => (a.day < b.day ? 1 : -1))[0];
  if (!prev) { toast('Belum ada data di tanggal sebelumnya', 'warn'); return; }
  const { data: pd, error: e1 } = await supabase.from('counting_days').select('*').eq('id', prev.id).single();
  const { data: pr, error: e2 } = await supabase.from('counting_rows').select('row_key,data').eq('day_id', prev.id);
  if (e1 || e2) { toast('Gagal membaca data sebelumnya', 'bad'); return; }

  const counts = { ...rowCounts(), ...(pd.counts || {}) };
  const dayId = await ensureDay();
  saveMeta({ counts, wh: S.day?.wh ?? pd.wh, mode: S.day?.mode ?? pd.mode, operator_line: S.day?.operator_line ?? pd.operator_line });

  const uid = store.session?.user.id, batch = [];
  (pr || []).forEach((r) => {
    const cur = S.rows[r.row_key] || {};
    const patch = {};
    ['nik', 'operator', 'proses', 'target'].forEach((f) => {
      if ((cur[f] == null || cur[f] === '') && r.data[f] != null && r.data[f] !== '') patch[f] = r.data[f];
    });
    if (!Object.keys(patch).length) return;
    S.rows[r.row_key] = { ...cur, ...patch };
    batch.push({ day_id: dayId, row_key: r.row_key, data: S.rows[r.row_key], updated_by: uid, updated_at: new Date().toISOString() });
  });
  if (!batch.length) { toast('Tidak ada kolom kosong yang perlu diisi', 'warn'); return; }
  track(supabase.from('counting_rows').upsert(batch, { onConflict: 'day_id,row_key' }).then(({ error }) => { if (error) throw error; }));
  applyMeta(); applyRows();
  toast(`${batch.length} baris diisi dari ${prev.day}`);
}

/* ---------- Export Excel ---------- */
function doExport() {
  if (!S.styleId) { toast('Pilih line dan style dulu', 'warn'); return; }
  const st = styleById(S.styleId) || {}, lineName = currentLineName(), buyer = buyerById(st.buyer_id)?.name || '';
  let nin = 0, nout = 0;
  const body = [];
  $$('#tbody tr').forEach((tr) => {
    const m = MOD[tr.dataset.m], c = calc(tr.dataset.id, tr.dataset.m), d = c.d, no = Number(tr.dataset.no) || '';
    if (c.operator) nin++;
    if (c.day != null && c.day > 0) nout++;
    const r2 = (v) => (v == null ? '' : Math.round(v * 100) / 100);
    const line = [m.label, no, d.nik || '', d.operator || '', d.proses || '', d.sched || '', num(d.pqty) ?? '', num(d.st) ?? '', r2(c.stH), c.target ?? '', d.tc1 || '', d.tc2 || ''];
    for (let k = 0; k < 9; k++) { line.push(c.o[k] ?? ''); line.push(r2(c.pcs[k])); }
    line.push(c.day ?? '', c.wh, r2(c.fin));
    body.push(line);
  });
  const head = [
    ['LINE', lineName], ['BUYER', buyer], ['STYLE', st.code || ''], ['TANGGAL', S.date],
    ['CARA ISI OUTPUT', getMode() === 'hourly' ? 'Per jam' : 'Kumulatif'],
    ['OPERATOR INPUT', nin], ['OPERATOR OUTPUT', nout], ['OPERATOR LINE', num(S.day?.operator_line) ?? ''], []
  ];
  const cols = ['Modul', 'No', 'NIK', 'Operator', 'Proses', 'First output', 'P.Qty', 'Target jadwal', 'Jadwal/jam', 'Target', 'TC 1', 'TC 2'];
  for (let k = 1; k <= 9; k++) cols.push('Output ' + k, 'Pcs/jam');
  cols.push('Output/hari', 'W/H', 'Pcs/jam');

  const ws = XLSX.utils.aoa_to_sheet([...head, cols, ...body]);
  ws['!cols'] = [12, 5, 12, 16, 22, 10, 8, 10, 10, 8, 7, 7, ...Array(18).fill(9), 11, 6, 9].map((w) => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (lineName + ' ' + (st.code || '')).replace(/[[\]:*?/\\]/g, '-').slice(0, 31) || 'Sheet1');
  XLSX.writeFile(wb, `HOGA-COUNTING-${sanitizeFile(lineName)}-${sanitizeFile(st.code || '')}-${S.date}.xlsx`);
  toast('File diekspor');
}
