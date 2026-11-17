import { supabase } from '../supabase.js';
import { store, canWrite, onStore, lineById, styleById, stylesOfLine, buyerById } from '../store.js';
import { $, $$, esc, num, disp, raw, parseNum, nf1, toast, setSaveState, copyRich } from '../utils.js';
import { MODULES } from '../modules.js';
import { computePlan, summarize, DEFAULT_AP_MODULES, orderModules } from '../lib/actionplan.js';
import { buildEmail, summaryRows, fmtDay } from '../lib/email.js';

const LABEL = Object.fromEntries(MODULES.map((m) => [m.key, m.label]));
// Kolom yang bisa ditimpa manual: key di data override -> nama kolom di sel hasil hitung
const EDIT = ['target', 'out', 'input', 'wh', 'stock', 'operators'];

let S, root, unsubStore, channel, queues, reloadTimer;

function fresh() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('hoga.sel') || '{}'); } catch { /* abaikan */ }
  return {
    lineId: saved.lineId || null, styleId: saved.styleId || null,
    plan: null, daily: new Map(), overrides: new Map(), notes: new Map(),
    days: [], dayIds: new Set(), reportDay: null, result: null,
    token: 0, pending: 0, missing: false, built: ''
  };
}
const writable = () => canWrite();
const planModules = () => {
  if (S.plan?.modules?.length) return S.plan.modules;
  const hidden = styleById(S.styleId)?.hidden_modules || [];
  return DEFAULT_AP_MODULES.filter((k) => !hidden.includes(k));
};

/* ---------- Kerangka ---------- */
export function mount(el) {
  root = el; S = fresh(); queues = new Map();
  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <h2>Action Plan Report</h2>
        <p>Output, operator, dan input otomatis diambil dari Counting. Setiap angka di tabel harian bisa diubah manual; kosongkan sel untuk kembali ke angka otomatis.</p>
      </div>
      <div class="bar">
        <label class="field"><span>Line</span><select id="ap-line"></select></label>
        <label class="field"><span>Style</span><select id="ap-style"></select></label>
        <div class="ro"><span class="lbl">Buyer</span><strong id="ap-buyer">–</strong></div>
        <label class="field"><span>Tanggal laporan</span><select id="ap-day"></select></label>
        <div class="actions">
          <button class="btn ghost" id="ap-counting" type="button">Buka di Counting</button>
        </div>
      </div>
      <div id="ap-banner" class="banner" hidden></div>
      <div id="ap-empty" class="empty" hidden>
        <strong>Belum ada line dan style</strong>
        <span>Tambahkan di halaman <a href="#master">Master data</a>.</span>
      </div>

      <div id="ap-main">
        <details class="card" id="ap-settings">
          <summary class="summary-title">Pengaturan style <span class="muted">(P.Qty, target, W/H, modul yang dipakai)</span></summary>
          <form id="ap-form" class="ap-form">
            <label class="field"><span>Item</span><input id="f-item" type="text" maxlength="120" placeholder="mis. M Galesburg Sftshll Jkt"></label>
            <label class="field"><span>P.Qty</span><input id="f-pqty" type="text" inputmode="decimal" placeholder="mis. 5.904"></label>
            <label class="field"><span>Target (pcs/jam)</span><input id="f-target" type="text" inputmode="decimal"></label>
            <label class="field"><span>W/H standar</span><input id="f-wh" type="text" inputmode="decimal"></label>
            <label class="field"><span>Target jadwal/hari</span><input id="f-st" type="text" inputmode="decimal" placeholder="mis. 328"></label>
            <label class="field"><span>Target jadwal/jam (opsional)</span><input id="f-sth" type="text" inputmode="decimal" placeholder="otomatis"></label>
            <fieldset class="ap-mods"><legend>Modul yang tampil &amp; jadwal first output</legend>
              <div id="f-mods"></div>
            </fieldset>
            <div class="ap-form-actions"><button class="btn" type="submit" id="f-save">Simpan pengaturan</button></div>
          </form>
        </details>

        <section class="card" id="ap-report">
          <div class="report-head">
            <h3>Laporan</h3>
            <div class="report-actions">
              <label class="check"><input type="checkbox" id="ap-daily"> Sertakan tabel harian</label>
              <button class="btn ghost sm" id="ap-subject" type="button">Salin judul email</button>
              <button class="btn sm" id="ap-copy" type="button">Salin untuk email</button>
            </div>
          </div>
          <div id="ap-sum"></div>
          <label class="field" style="margin-top:12px"><span>Action plan / catatan (ikut tersalin ke email)</span>
            <textarea id="ap-note" rows="3" placeholder="mis. FRONT kurang operator, minta tambahan 2 orang dari line B21."></textarea></label>
        </section>

        <section class="card">
          <h3>Detail harian <span class="muted" style="font-weight:400">— sel biru = diubah manual</span></h3>
          <div class="sheetwrap" style="max-height:60vh"><table class="sheet ap-table" id="ap-table"></table></div>
        </section>
      </div>
    </div>`;

  wire();
  unsubStore = onStore((w) => { if (['lines', 'styles', 'buyers', 'all'].includes(w)) renderSelectors(); });
  renderSelectors();
}

export function unmount() {
  if (unsubStore) unsubStore();
  closeChannel(); clearTimeout(reloadTimer); setSaveState('');
  root = null;
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
  const lines = store.lines, empty = !lines.length;
  $('#ap-empty').hidden = !empty; $('#ap-main').hidden = empty;
  if (!lines.some((l) => l.id === S.lineId)) S.lineId = lines[0]?.id || null;
  fillSelect($('#ap-line'), lines.map((l) => [l.id, l.name]), S.lineId);
  const styles = stylesOfLine(S.lineId);
  if (!styles.some((s) => s.id === S.styleId)) S.styleId = styles[0]?.id || null;
  fillSelect($('#ap-style'), styles.map((s) => [s.id, s.code]), S.styleId);
  const st = styleById(S.styleId);
  $('#ap-buyer').textContent = (st && buyerById(st.buyer_id)?.name) || '–';
  try { localStorage.setItem('hoga.sel', JSON.stringify({ lineId: S.lineId, styleId: S.styleId })); } catch { /* abaikan */ }
  const key = S.styleId || '';
  if (key !== loadedKey) { loadedKey = key; load(); } else if (S.result) recompute();
}

/* ---------- Muat data ---------- */
function closeChannel() { if (channel) { supabase.removeChannel(channel); channel = null; } }
const isMissing = (e) => e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST200' || /does not exist|schema cache/i.test(e.message || ''));

async function load(keepDay) {
  const token = ++S.token, sid = S.styleId;
  if (!keepDay) closeChannel();
  if (!sid) { S.plan = null; S.daily = new Map(); S.overrides = new Map(); S.notes = new Map(); recompute(); return; }
  const [pl, dy, ov, nt] = await Promise.all([
    supabase.from('action_plans').select('*').eq('style_id', sid).maybeSingle(),
    supabase.from('counting_module_daily').select('*').eq('style_id', sid).limit(1000),
    supabase.from('action_plan_overrides').select('*').eq('style_id', sid).limit(1000),
    supabase.from('action_plan_notes').select('*').eq('style_id', sid).limit(1000)
  ]);
  if (token !== S.token) return;
  const err = pl.error || dy.error || ov.error || nt.error;
  S.missing = isMissing(err);
  if (err) {
    showBanner(S.missing ? 'Tabel Action Plan belum ada di database. Jalankan supabase/schema.sql terbaru di Supabase SQL Editor, lalu muat ulang halaman.' : 'Gagal memuat data: ' + err.message);
    return;
  }
  showBanner('');
  S.plan = pl.data || null;
  S.daily = new Map(); S.dayIds = new Set();
  (dy.data || []).forEach((r) => { S.daily.set(r.day + '|' + r.module, { output: Number(r.output) || 0, operators: Number(r.operators) || 0 }); S.dayIds.add(r.day_id); });
  S.overrides = new Map((ov.data || []).map((r) => [r.day + '|' + r.module, r.data || {}]));
  S.notes = new Map((nt.data || []).map((r) => [r.day, r.note || '']));
  recompute();
  if (!keepDay) subscribe(sid);
}

function showBanner(t) { const b = $('#ap-banner'); if (b) { b.hidden = !t; b.textContent = t || ''; } }

// Muat ulang otomatis saat counting atau pengguna lain mengubah data (ditunda jika sedang menyimpan).
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => { if (S.pending > 0 || (root && root.contains(document.activeElement) && document.activeElement.matches('input,textarea'))) scheduleReload(); else load(true); }, 900);
}
function subscribe(sid) {
  channel = supabase.channel('ap-' + sid)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'counting_days', filter: 'style_id=eq.' + sid }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'counting_rows' }, (p) => {
      const id = (p.new && p.new.day_id) || (p.old && p.old.day_id);
      if (!id || S.dayIds.has(id)) scheduleReload();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'action_plans', filter: 'style_id=eq.' + sid }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'action_plan_overrides', filter: 'style_id=eq.' + sid }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'action_plan_notes', filter: 'style_id=eq.' + sid }, scheduleReload)
    .subscribe();
}

/* ---------- Hitung & tampilkan ---------- */
function recompute() {
  if (!root) return;
  const mods = planModules();
  const set = new Set();
  S.daily.forEach((_, k) => { const [d, m] = k.split('|'); if (mods.includes(m)) set.add(d); });
  S.overrides.forEach((_, k) => set.add(k.split('|')[0]));
  S.days = [...set].sort();
  if (!S.days.includes(S.reportDay)) S.reportDay = S.days[S.days.length - 1] || null;
  S.result = computePlan({ plan: S.plan, modules: mods, days: S.days, daily: S.daily, overrides: S.overrides });
  renderDaySelect(); renderSettings(); renderTable(); fill(); renderReport();
}

function renderDaySelect() {
  const sel = $('#ap-day');
  fillSelect(sel, [...S.days].reverse().map((d) => [d, fmtDay(d, true)]), S.reportDay);
  if (!S.days.length) { sel.innerHTML = '<option value="">Belum ada data</option>'; }
}

function prevOf(day) { const i = S.days.indexOf(day); return i > 0 ? S.days[i - 1] : null; }

function reportModel(includeDaily) {
  const st = styleById(S.styleId) || {};
  const day = S.reportDay, prev = prevOf(day);
  return {
    line: lineById(S.lineId)?.name || '', buyer: buyerById(st.buyer_id)?.name || '', style: st.code || '',
    item: S.plan?.item || '', day, prevDay: prev, mods: S.result.mods,
    cols: summarize(S.result, day, prev), note: S.notes.get(day) || '',
    result: S.result, days: S.days, includeDaily
  };
}

function renderReport() {
  const box = $('#ap-sum');
  if (!S.reportDay || !S.result.mods.length) {
    box.innerHTML = '<div class="empty" style="margin:0"><strong>Belum ada data</strong>Isi counting untuk style ini, atau tambahkan angka manual di tabel harian.</div>';
    $('#ap-note').value = ''; return;
  }
  const m = reportModel(false), rows = summaryRows(m.cols, m.day, m.prevDay);
  box.innerHTML = `
    <dl class="rep-head">
      <div><dt>LINE</dt><dd>${esc(m.line)}</dd></div><div><dt>BUYER</dt><dd>${esc(m.buyer || '–')}</dd></div>
      <div><dt>STYLE</dt><dd>${esc(m.style)}</dd></div><div><dt>ITEM</dt><dd>${esc(m.item || '–')}</dd></div>
      <div><dt>DATE</dt><dd>${esc(fmtDay(m.day, true))}</dd></div>
    </dl>
    <div class="table-wrap"><table class="data rep">
      <thead><tr><th>Module</th>${m.mods.map((k) => `<th>${esc(LABEL[k] || k)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr><th scope="row">${esc(r[0])}</th>${r.slice(1).map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  if (document.activeElement !== $('#ap-note')) $('#ap-note').value = m.note;
  $('#ap-note').readOnly = !writable();
}

/* ---------- Tabel harian ---------- */
function renderTable() {
  const t = $('#ap-table');
  const key = S.days.join(',') + '|' + (S.result?.mods || []).join(',');
  if (key === S.built) return;
  S.built = key;
  const mods = S.result.mods;
  const head = `<thead>
    <tr class="g1"><th colspan="2" class="stick1">Posisi</th><th colspan="4">Jadwal</th><th colspan="7">Produksi</th><th colspan="2">Stok</th><th colspan="3">Estimasi</th><th>Tim</th></tr>
    <tr class="g2"><th class="stick1">Tanggal</th><th class="stick2">Modul</th>
      <th>Sched. Output</th><th>P.Qty</th><th>Sched. Target</th><th>Sched. Target/H</th>
      <th>Target</th><th>Output/Day</th><th>Total Output</th><th>Total Input</th><th>Balance</th><th>W/H</th><th>Pcs/Jam</th>
      <th>Stock Qty</th><th>Stock Days</th><th>Working Days</th><th>Balance Days</th><th>Expected Finish</th><th>Operator</th></tr></thead>`;
  const widths = [100, 112, 100, 70, 104, 120, 70, 90, 92, 90, 84, 60, 74, 88, 84, 100, 96, 116, 82];
  let body = '';
  [...S.days].reverse().forEach((day) => {
    mods.forEach((k, i) => {
      const input = (f) => `<td class="ed" data-f="${f}"><input class="n" data-f="${f}" inputmode="decimal" autocomplete="off" aria-label="${f} ${LABEL[k] || k} ${day}"></td>`;
      const calc = (f) => `<td class="calc" data-c="${f}"></td>`;
      body += `<tr data-day="${day}" data-m="${k}">` +
        (i === 0 ? `<td class="stick1 mod" rowspan="${mods.length}"><span>${esc(fmtDay(day, true))}</span><div class="minis"><button type="button" class="mini wide" data-act="counting" data-day="${day}" title="Buka counting tanggal ini">Counting</button></div></td>` : '') +
        `<td class="stick2 modname">${esc(LABEL[k] || k)}</td>` +
        calc('sched') + calc('pqty') + calc('schedTarget') + calc('schedTargetH') +
        input('target') + input('out') + calc('cumOut') + input('input') + calc('balance') + input('wh') + calc('pcsH') +
        input('stock') + calc('stockDays') + calc('workDays') + calc('balDays') + calc('finish') + input('operators') + '</tr>';
    });
  });
  t.innerHTML = `<colgroup>${widths.map((w) => `<col style="width:${w}px">`).join('')}</colgroup>${head}<tbody>${body || `<tr><td colspan="19" class="muted" style="padding:16px">Belum ada data counting untuk style ini.</td></tr>`}</tbody>`;
  t.style.width = widths.reduce((a, b) => a + b, 0) + 'px';
  $$('#ap-table input').forEach((i) => { i.readOnly = !writable(); });
}

const n0 = (v) => (v == null ? '' : disp(v));
const n1 = (v) => (v == null ? '' : nf1.format(v));
function fill() {
  if (!S.result) return;
  $$('#ap-table tbody tr[data-day]').forEach((tr) => {
    const c = S.result.rows[tr.dataset.day]?.[tr.dataset.m]; if (!c) return;
    const txt = { sched: c.sched ? fmtDay(c.sched) : '–', pqty: n0(c.pqty), schedTarget: n0(c.schedTarget), schedTargetH: n1(c.schedTargetH), cumOut: n0(c.cumOut), balance: n0(c.balance), pcsH: n1(c.pcsH), stockDays: n1(c.stockDays), workDays: String(c.workDays), balDays: n1(c.balDays), finish: c.finish ? fmtDay(c.finish, true) : '' };
    Object.entries(txt).forEach(([k, v]) => { const td = tr.querySelector(`[data-c="${k}"]`); if (td) td.textContent = v; });
    EDIT.forEach((f) => {
      const inp = tr.querySelector(`input[data-f="${f}"]`); if (!inp) return;
      const cell = c[f], td = inp.parentElement;
      td.classList.toggle('manual', cell.manual);
      inp.title = cell.manual ? `Manual. Otomatis: ${n0(cell.auto) || '–'}. Kosongkan untuk kembali ke otomatis.` : 'Otomatis dari Counting. Ketik angka untuk mengubah manual.';
      if (document.activeElement !== inp) inp.value = n0(cell.value);
    });
  });
}

/* ---------- Simpan ---------- */
function enqueue(key, fn) { const prev = queues.get(key) || Promise.resolve(); const next = prev.catch(() => {}).then(fn); queues.set(key, next); return next; }
function track(p) {
  S.pending++; setSaveState('Menyimpan…');
  return p.then(() => { S.pending--; if (!S.pending) setSaveState('Tersimpan ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }), 'ok'); })
    .catch((e) => {
      S.pending--; console.error(e);
      const denied = e && (e.code === '42501' || /row-level security/i.test(e.message || ''));
      setSaveState(denied ? 'Tidak ada izin menyimpan' : 'Gagal menyimpan', 'bad');
      if (isMissing(e)) showBanner('Tabel Action Plan belum ada. Jalankan supabase/schema.sql terbaru.');
    });
}

function saveOverride(day, mod) {
  const key = day + '|' + mod, sid = S.styleId, uid = store.session?.user.id;
  const data = { ...(S.overrides.get(key) || {}) };
  track(enqueue('ov/' + sid + key, async () => {
    if (!Object.keys(data).length) {
      const { error } = await supabase.from('action_plan_overrides').delete().eq('style_id', sid).eq('day', day).eq('module', mod);
      if (error) throw error; return;
    }
    const { error } = await supabase.from('action_plan_overrides').upsert(
      { style_id: sid, day, module: mod, data, updated_by: uid, updated_at: new Date().toISOString() }, { onConflict: 'style_id,day,module' });
    if (error) throw error;
  }));
}

function commit(inp) {
  if (!writable()) { fill(); return; }
  const tr = inp.closest('tr'), day = tr.dataset.day, mod = tr.dataset.m, f = inp.dataset.f, key = day + '|' + mod;
  const cell = S.result.rows[day][mod][f];
  const val = parseNum(inp.value);
  inp._dirty = false;
  if (Number.isNaN(val)) { toast('Angka tidak valid', 'warn'); inp.value = n0(cell.value); return; }
  const cur = { ...(S.overrides.get(key) || {}) };
  if (val == null || (cell.auto != null && Math.abs(val - cell.auto) < 1e-9)) delete cur[f]; else cur[f] = val;
  if ((cur[f] ?? null) === (S.overrides.get(key)?.[f] ?? null)) { fill(); return; }
  if (Object.keys(cur).length) S.overrides.set(key, cur); else S.overrides.delete(key);
  saveOverride(day, mod);
  S.result = computePlan({ plan: S.plan, modules: planModules(), days: S.days, daily: S.daily, overrides: S.overrides });
  fill(); renderReport();
}

async function saveNote() {
  if (!writable() || !S.reportDay) return;
  const day = S.reportDay, sid = S.styleId, note = $('#ap-note').value.trim(), uid = store.session?.user.id;
  if ((S.notes.get(day) || '') === note) return;
  if (note) S.notes.set(day, note); else S.notes.delete(day);
  track(enqueue('note/' + sid + day, async () => {
    if (!note) { const { error } = await supabase.from('action_plan_notes').delete().eq('style_id', sid).eq('day', day); if (error) throw error; return; }
    const { error } = await supabase.from('action_plan_notes').upsert({ style_id: sid, day, note, updated_by: uid, updated_at: new Date().toISOString() }, { onConflict: 'style_id,day' });
    if (error) throw error;
  }));
}

/* ---------- Pengaturan style ---------- */
function renderSettings() {
  const form = $('#ap-form'); if (!form || form.contains(document.activeElement)) return;
  const p = S.plan || {};
  $('#f-item').value = p.item || '';
  $('#f-pqty').value = p.pqty != null ? raw(p.pqty) : '';
  $('#f-target').value = raw(p.target ?? 45);
  $('#f-wh').value = raw(p.wh ?? 8);
  $('#f-st').value = p.sched_target != null ? raw(p.sched_target) : '';
  $('#f-sth').value = p.sched_target_h != null ? raw(p.sched_target_h) : '';
  const active = new Set(planModules()), sched = p.module_sched || {};
  $('#f-mods').innerHTML = MODULES.map((m) => `
    <div class="mod-row"><label><input type="checkbox" data-mod="${m.key}" ${active.has(m.key) ? 'checked' : ''}> ${esc(m.label)}</label>
      <input type="date" data-sched="${m.key}" value="${esc(sched[m.key] || '')}" aria-label="First output ${esc(m.label)}"></div>`).join('');
  $$('#ap-form input, #ap-form button').forEach((el) => { el.disabled = !writable(); });
  $('#f-save').hidden = !writable();
}

async function savePlan(e) {
  e.preventDefault();
  if (!writable() || !S.styleId) return;
  const val = (sel, d) => { const v = parseNum($(sel).value); return Number.isNaN(v) ? d : v; };
  const modules = orderModules($$('#f-mods input[data-mod]').filter((i) => i.checked).map((i) => i.dataset.mod));
  if (!modules.length) { toast('Pilih minimal satu modul', 'warn'); return; }
  const module_sched = {};
  $$('#f-mods input[data-sched]').forEach((i) => { if (i.value) module_sched[i.dataset.sched] = i.value; });
  const row = {
    style_id: S.styleId, item: $('#f-item').value.trim() || null,
    pqty: val('#f-pqty', null), target: val('#f-target', 45) ?? 45, wh: val('#f-wh', 8) ?? 8,
    sched_target: val('#f-st', null), sched_target_h: val('#f-sth', null),
    modules, module_sched, updated_by: store.session?.user.id, updated_at: new Date().toISOString()
  };
  const btn = $('#f-save'); btn.disabled = true;
  const { error } = await supabase.from('action_plans').upsert(row, { onConflict: 'style_id' });
  btn.disabled = false;
  if (error) { toast(isMissing(error) ? 'Tabel belum ada. Jalankan supabase/schema.sql terbaru.' : 'Gagal menyimpan: ' + error.message, 'bad'); return; }
  S.plan = row; recompute(); toast('Pengaturan disimpan');
}

/* ---------- Event ---------- */
function wire() {
  $('#ap-line').addEventListener('change', (e) => { S.lineId = e.target.value; S.styleId = null; renderSelectors(); });
  $('#ap-style').addEventListener('change', (e) => { S.styleId = e.target.value; renderSelectors(); });
  $('#ap-day').addEventListener('change', (e) => { S.reportDay = e.target.value; renderReport(); });
  $('#ap-form').addEventListener('submit', savePlan);
  $('#ap-note').addEventListener('change', saveNote);
  $('#ap-counting').addEventListener('click', () => openCounting(S.reportDay));

  const tbl = $('#ap-table');
  tbl.addEventListener('focusin', (e) => { const t = e.target; if (!t.dataset?.f) return; const tr = t.closest('tr'); const c = S.result.rows[tr.dataset.day]?.[tr.dataset.m]; if (c) t.value = raw(c[t.dataset.f].value); t._dirty = false; setTimeout(() => { try { t.select(); } catch { /* abaikan */ } }); });
  tbl.addEventListener('input', (e) => { if (e.target.dataset?.f) e.target._dirty = true; });
  tbl.addEventListener('change', (e) => { if (e.target.dataset?.f) commit(e.target); });
  tbl.addEventListener('focusout', (e) => { if (e.target.dataset?.f && !e.target._dirty) fill(); });
  tbl.addEventListener('keydown', (e) => {
    const t = e.target; if (!t.dataset?.f) return;
    if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const down = !(e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey));
      const tr = t.closest('tr'), nx = down ? tr.nextElementSibling : tr.previousElementSibling;
      const ni = nx && nx.querySelector(`input[data-f="${t.dataset.f}"]`);
      if (ni) ni.focus(); else t.blur();
    } else if (e.key === 'Escape') { t._dirty = false; fill(); t.blur(); }
  });
  tbl.addEventListener('click', (e) => { const b = e.target.closest('button[data-act="counting"]'); if (b) openCounting(b.dataset.day); });

  $('#ap-copy').addEventListener('click', async () => {
    if (!S.reportDay || !S.result.mods.length) { toast('Belum ada data untuk disalin', 'warn'); return; }
    await saveNote();
    const { html, text } = buildEmail(reportModel($('#ap-daily').checked));
    const ok = await copyRich(html, text);
    toast(ok ? 'Laporan tersalin. Tinggal paste di email.' : 'Gagal menyalin. Izinkan akses clipboard di browser.', ok ? 'ok' : 'bad');
  });
  $('#ap-subject').addEventListener('click', async () => {
    if (!S.reportDay) { toast('Belum ada data', 'warn'); return; }
    const { subject } = buildEmail(reportModel(false));
    try { await navigator.clipboard.writeText(subject); toast('Judul email tersalin'); } catch { toast(subject, 'warn'); }
  });
}

function openCounting(day) {
  try { localStorage.setItem('hoga.sel', JSON.stringify({ lineId: S.lineId, styleId: S.styleId, date: day || undefined })); } catch { /* abaikan */ }
  location.hash = '#counting';
}
