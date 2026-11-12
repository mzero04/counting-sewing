import { supabase } from '../supabase.js';
import { store, isAdmin, onStore, lineById, buyerById } from '../store.js';
import { $, $$, esc, toast, confirmDialog, norm, natural, debounce } from '../utils.js';

let root, unsub, filter = { line: '', q: '' };

export function mount(el) {
  root = el;
  filter = { line: '', q: '' };
  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <h2>Master data</h2>
        <p>Kelola buyer, line, dan style. Perubahan langsung terlihat oleh semua pengguna.</p>
      </div>
      <div id="m-note" class="banner info" hidden>Hanya admin yang dapat mengubah master data. Anda dapat melihat daftarnya.</div>

      <div class="m-grid">
        <section class="card">
          <h3>Buyer</h3>
          <form id="f-buyer" class="m-form">
            <label class="field"><span>Nama buyer</span><input id="in-buyer" type="text" maxlength="60" placeholder="mis. CARHARTT" required></label>
            <button class="btn" type="submit">Tambah</button>
          </form>
          <ul class="list" id="l-buyer"></ul>
        </section>
        <section class="card">
          <h3>Line</h3>
          <form id="f-line" class="m-form">
            <label class="field"><span>Nama line</span><input id="in-line" type="text" maxlength="40" placeholder="mis. B2" required></label>
            <button class="btn" type="submit">Tambah</button>
          </form>
          <ul class="list" id="l-line"></ul>
        </section>
      </div>

      <section class="card">
        <h3>Style</h3>
        <form id="f-style" class="m-form">
          <label class="field" style="max-width:180px"><span>Line</span><select id="in-sline" required></select></label>
          <label class="field" style="flex:2 1 220px"><span>Kode style (pisahkan dengan koma untuk banyak sekaligus)</span>
            <input id="in-style" type="text" maxlength="400" placeholder="mis. 108257, 108258" required></label>
          <label class="field" style="max-width:220px"><span>Buyer (ketik baru untuk membuat)</span>
            <input id="in-sbuyer" type="text" list="dl-buyers" maxlength="60" placeholder="Tanpa buyer"></label>
          <datalist id="dl-buyers"></datalist>
          <button class="btn" type="submit">Tambah style</button>
        </form>
        <div class="toolbar">
          <select id="flt-line" style="max-width:180px" aria-label="Filter line"></select>
          <input id="flt-q" type="search" placeholder="Cari style atau buyer…" aria-label="Cari style">
          <span class="muted" id="style-count"></span>
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Line</th><th>Style</th><th>Buyer</th><th></th></tr></thead>
            <tbody id="b-style"></tbody>
          </table>
        </div>
      </section>
    </div>`;

  $('#f-buyer').addEventListener('submit', addBuyer);
  $('#f-line').addEventListener('submit', addLine);
  $('#f-style').addEventListener('submit', addStyle);
  $('#flt-line').addEventListener('change', (e) => { filter.line = e.target.value; renderStyles(); });
  $('#flt-q').addEventListener('input', debounce((e) => { filter.q = e.target.value; renderStyles(); }, 150));
  unsub = onStore((w) => { if (['buyers', 'lines', 'styles', 'all'].includes(w)) render(); });
  render();
}

export function unmount() { if (unsub) unsub(); root = null; }

/* ---------- Util ---------- */
function dbError(e, what) {
  if (e && e.code === '23505') return `${what} sudah ada.`;
  if (e && e.code === '23503') return `${what} masih dipakai data lain dan tidak bisa dihapus.`;
  if (e && (e.code === '42501' || /row-level security/i.test(e.message || ''))) return 'Tidak ada izin. Hanya admin yang boleh mengubah master data.';
  return 'Gagal menyimpan: ' + (e?.message || e);
}
const styleCount = (pred) => store.styles.filter(pred).length;

function setBusy(form, busy) { $$('button,input,select', form).forEach((el) => { el.disabled = busy || !isAdmin(); }); }

/* ---------- Render ---------- */
function render() {
  if (!root) return;
  const admin = isAdmin();
  $('#m-note').hidden = admin;
  renderBuyers(admin); renderLines(admin); renderStyleForm(admin); renderStyles();
  ['f-buyer', 'f-line', 'f-style'].forEach((id) => $$('input,select,button', $('#' + id)).forEach((el) => { el.disabled = !admin; }));
}

function rowItem({ name, note, onRename, onDelete, admin }) {
  const li = document.createElement('li');
  const grow = document.createElement('span'); grow.className = 'grow'; grow.textContent = name;
  const meta = document.createElement('span'); meta.className = 'muted'; meta.textContent = note;
  li.append(grow, meta);
  if (admin) {
    const ed = document.createElement('button'); ed.type = 'button'; ed.className = 'link-btn'; ed.textContent = 'Ubah';
    ed.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'text'; input.className = 'edit'; input.value = name; input.maxLength = 60;
      grow.replaceChildren(input); input.focus(); input.select();
      let done = false;
      const finish = async (save) => {
        if (done) return; done = true;
        const v = input.value.trim();
        if (save && v && v !== name) await onRename(v); else grow.textContent = name;
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
      input.addEventListener('blur', () => finish(true));
    });
    const del = document.createElement('button'); del.type = 'button'; del.className = 'link-danger'; del.textContent = 'Hapus';
    del.addEventListener('click', onDelete);
    li.append(ed, del);
  }
  return li;
}

function renderBuyers(admin) {
  const ul = $('#l-buyer'); ul.textContent = '';
  if (!store.buyers.length) { const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'Belum ada buyer.'; ul.appendChild(li); return; }
  store.buyers.forEach((b) => {
    const n = styleCount((s) => s.buyer_id === b.id);
    ul.appendChild(rowItem({
      name: b.name, note: n + ' style', admin,
      onRename: async (v) => {
        const { error } = await supabase.from('buyers').update({ name: v.toUpperCase() }).eq('id', b.id);
        if (error) { toast(dbError(error, `Buyer ${v}`), 'bad'); render(); } else toast('Buyer diperbarui');
      },
      onDelete: async () => {
        const msg = n ? `Hapus buyer ${b.name}? ${n} style akan menjadi "tanpa buyer".` : `Hapus buyer ${b.name}?`;
        if (!(await confirmDialog(msg))) return;
        const { error } = await supabase.from('buyers').delete().eq('id', b.id);
        if (error) toast(dbError(error, 'Buyer'), 'bad'); else toast('Buyer dihapus');
      }
    }));
  });
}

function renderLines(admin) {
  const ul = $('#l-line'); ul.textContent = '';
  if (!store.lines.length) { const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'Belum ada line.'; ul.appendChild(li); return; }
  store.lines.forEach((l) => {
    const n = styleCount((s) => s.line_id === l.id);
    ul.appendChild(rowItem({
      name: l.name, note: n + ' style', admin,
      onRename: async (v) => {
        const { error } = await supabase.from('lines').update({ name: v }).eq('id', l.id);
        if (error) { toast(dbError(error, `Line ${v}`), 'bad'); render(); } else toast('Line diperbarui');
      },
      onDelete: async () => {
        if (n) { toast(`Line ${l.name} masih punya ${n} style. Hapus atau pindahkan style-nya dulu.`, 'warn'); return; }
        if (!(await confirmDialog(`Hapus line ${l.name}?`))) return;
        const { error } = await supabase.from('lines').delete().eq('id', l.id);
        if (error) toast(dbError(error, 'Line'), 'bad'); else toast('Line dihapus');
      }
    }));
  });
}

function renderStyleForm() {
  const sl = $('#in-sline'), cur = sl.value, fl = $('#flt-line'), curF = filter.line;
  sl.innerHTML = store.lines.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  if (cur && store.lines.some((l) => l.id === cur)) sl.value = cur;
  fl.innerHTML = '<option value="">Semua line</option>' + store.lines.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  fl.value = store.lines.some((l) => l.id === curF) ? curF : '';
  filter.line = fl.value;
  $('#dl-buyers').innerHTML = store.buyers.map((b) => `<option value="${esc(b.name)}"></option>`).join('');
}

function renderStyles() {
  if (!root) return;
  const admin = isAdmin(), tb = $('#b-style');
  const q = norm(filter.q);
  const list = store.styles.filter((s) => {
    if (filter.line && s.line_id !== filter.line) return false;
    if (!q) return true;
    return norm(s.code).includes(q) || norm(buyerById(s.buyer_id)?.name).includes(q);
  }).sort((a, b) => natural(lineById(a.line_id)?.name || '', lineById(b.line_id)?.name || '') || natural(a.code, b.code));
  $('#style-count').textContent = `${list.length} dari ${store.styles.length} style`;
  tb.textContent = '';
  if (!list.length) {
    const tr = document.createElement('tr'); const td = document.createElement('td');
    td.colSpan = 4; td.className = 'muted'; td.textContent = store.styles.length ? 'Tidak ada style yang cocok.' : 'Belum ada style.';
    tr.appendChild(td); tb.appendChild(tr); return;
  }
  list.forEach((s) => {
    const tr = document.createElement('tr');
    const tdL = document.createElement('td'), tdC = document.createElement('td'), tdB = document.createElement('td'), tdA = document.createElement('td');
    if (admin) {
      const sl = document.createElement('select'); sl.setAttribute('aria-label', 'Line untuk style ' + s.code);
      sl.innerHTML = store.lines.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join(''); sl.value = s.line_id;
      sl.addEventListener('change', () => updateStyle(s, { line_id: sl.value }, sl));
      tdL.appendChild(sl);
      const ci = document.createElement('input'); ci.type = 'text'; ci.value = s.code; ci.maxLength = 60; ci.setAttribute('aria-label', 'Kode style');
      ci.addEventListener('change', () => { const v = ci.value.trim(); if (!v) { ci.value = s.code; return; } updateStyle(s, { code: v }, ci); });
      tdC.appendChild(ci);
      const bs = document.createElement('select'); bs.setAttribute('aria-label', 'Buyer untuk style ' + s.code);
      bs.innerHTML = '<option value="">Tanpa buyer</option>' + store.buyers.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join(''); bs.value = s.buyer_id || '';
      bs.addEventListener('change', () => updateStyle(s, { buyer_id: bs.value || null }, bs));
      tdB.appendChild(bs);
      const del = document.createElement('button'); del.type = 'button'; del.className = 'link-danger'; del.textContent = 'Hapus';
      del.addEventListener('click', () => deleteStyle(s));
      const wrap = document.createElement('div'); wrap.className = 'row-actions'; wrap.appendChild(del); tdA.appendChild(wrap);
    } else {
      tdL.textContent = lineById(s.line_id)?.name || ''; tdC.textContent = s.code; tdB.textContent = buyerById(s.buyer_id)?.name || '–';
    }
    tr.append(tdL, tdC, tdB, tdA); tb.appendChild(tr);
  });
}

/* ---------- Aksi ---------- */
async function addBuyer(e) {
  e.preventDefault(); if (!isAdmin()) return;
  const form = e.currentTarget, name = $('#in-buyer').value.trim().toUpperCase();
  if (!name) return;
  if (store.buyers.some((b) => norm(b.name) === name)) { toast(`Buyer ${name} sudah ada`, 'warn'); return; }
  setBusy(form, true);
  const { error } = await supabase.from('buyers').insert({ name });
  setBusy(form, false);
  if (error) { toast(dbError(error, `Buyer ${name}`), 'bad'); return; }
  $('#in-buyer').value = ''; $('#in-buyer').focus(); toast(`Buyer ${name} ditambahkan`);
}

async function addLine(e) {
  e.preventDefault(); if (!isAdmin()) return;
  const form = e.currentTarget, name = $('#in-line').value.trim();
  if (!name) return;
  if (store.lines.some((l) => norm(l.name) === norm(name))) { toast(`Line ${name} sudah ada`, 'warn'); return; }
  setBusy(form, true);
  const { error } = await supabase.from('lines').insert({ name });
  setBusy(form, false);
  if (error) { toast(dbError(error, `Line ${name}`), 'bad'); return; }
  $('#in-line').value = ''; $('#in-line').focus(); toast(`Line ${name} ditambahkan`);
}

async function addStyle(e) {
  e.preventDefault(); if (!isAdmin()) return;
  const form = e.currentTarget;
  const lineId = $('#in-sline').value;
  if (!lineId) { toast('Tambahkan line dulu', 'warn'); return; }
  const codes = [...new Set($('#in-style').value.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean))];
  if (!codes.length) return;
  const buyerName = $('#in-sbuyer').value.trim().toUpperCase();

  setBusy(form, true);
  try {
    let buyerId = null;
    if (buyerName) {
      const found = store.buyers.find((b) => norm(b.name) === buyerName);
      if (found) buyerId = found.id;
      else {
        const { data, error } = await supabase.from('buyers').insert({ name: buyerName }).select().single();
        if (error) throw error;
        buyerId = data.id;
      }
    }
    const fresh = codes.filter((c) => !store.styles.some((s) => s.line_id === lineId && norm(s.code) === norm(c)));
    const skipped = codes.length - fresh.length;
    if (!fresh.length) { toast('Semua style itu sudah ada di line ini', 'warn'); return; }
    const { error } = await supabase.from('styles').insert(fresh.map((code) => ({ line_id: lineId, code, buyer_id: buyerId })));
    if (error) throw error;
    $('#in-style').value = '';
    toast(`${fresh.length} style ditambahkan${skipped ? `, ${skipped} dilewati karena sudah ada` : ''}`);
  } catch (err) {
    toast(dbError(err, 'Style'), 'bad');
  } finally {
    setBusy(form, false);
  }
}

async function updateStyle(s, patch, control) {
  const lineId = patch.line_id ?? s.line_id, code = patch.code ?? s.code;
  if (store.styles.some((x) => x.id !== s.id && x.line_id === lineId && norm(x.code) === norm(code))) {
    toast(`Style ${code} sudah ada di line itu`, 'warn'); render(); return;
  }
  control.disabled = true;
  const { error } = await supabase.from('styles').update(patch).eq('id', s.id);
  control.disabled = false;
  if (error) { toast(dbError(error, `Style ${code}`), 'bad'); render(); return; }
  toast('Style diperbarui');
}

async function deleteStyle(s) {
  const ok = await confirmDialog(`Hapus style ${s.code}? Semua data counting harian style ini ikut terhapus dan tidak bisa dikembalikan.`);
  if (!ok) return;
  const { error } = await supabase.from('styles').delete().eq('id', s.id);
  if (error) toast(dbError(error, 'Style'), 'bad'); else toast('Style dihapus');
}
