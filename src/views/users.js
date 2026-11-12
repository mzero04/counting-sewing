import { supabase } from '../supabase.js';
import { store } from '../store.js';
import { $, esc, toast, confirmDialog, natural } from '../utils.js';

let root, users = [];

const ROLES = [
  ['admin', 'Admin — kelola semua'],
  ['contributor', 'Contributor — isi counting'],
  ['viewer', 'Viewer — lihat saja']
];

export function mount(el) {
  root = el;
  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <h2>Pengguna</h2>
        <p>Hanya admin yang dapat menambah dan mengelola user.</p>
      </div>
      <section class="card">
        <h3>Tambah user baru</h3>
        <form id="f-user" class="m-form" autocomplete="off">
          <label class="field"><span>Nama lengkap</span><input id="u-name" type="text" maxlength="80"></label>
          <label class="field"><span>Email *</span><input id="u-email" type="email" required></label>
          <label class="field"><span>Password * (min. 6 karakter)</span><input id="u-pass" type="password" minlength="6" required autocomplete="new-password"></label>
          <label class="field" style="max-width:240px"><span>Role</span>
            <select id="u-role">${ROLES.map(([v, t]) => `<option value="${v}" ${v === 'contributor' ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <button class="btn" type="submit">Tambah user</button>
        </form>
        <p class="muted" style="margin:8px 0 0;font-size:12px">Membuat user dari sini memerlukan fungsi server <code>/api/create-user</code> (aktif di Vercel). Alternatifnya, buat user di Supabase &gt; Authentication &gt; Users.</p>
      </section>
      <section class="card">
        <h3>Daftar user <span class="muted" id="u-count" style="font-weight:400"></span></h3>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Nama</th><th>Email</th><th>Role</th><th></th></tr></thead>
            <tbody id="b-users"></tbody>
          </table>
        </div>
      </section>
    </div>`;
  $('#f-user').addEventListener('submit', addUser);
  load();
}

export function unmount() { root = null; }

async function load() {
  const { data, error } = await supabase.from('profiles').select('*');
  if (error) { toast('Gagal memuat user: ' + error.message, 'bad'); return; }
  users = data.sort((a, b) => natural(a.name || a.email || '', b.name || b.email || ''));
  render();
}

function render() {
  if (!root) return;
  const me = store.session.user.id;
  $('#u-count').textContent = `(${users.length})`;
  const tb = $('#b-users'); tb.textContent = '';
  users.forEach((u) => {
    const tr = document.createElement('tr');
    const isMe = u.id === me;
    tr.innerHTML = `<td>${esc(u.name || '')}${isMe ? ' <span class="muted">(Anda)</span>' : ''}</td><td>${esc(u.email || '')}</td><td></td><td></td>`;
    const sel = document.createElement('select');
    sel.innerHTML = ROLES.map(([v, t]) => `<option value="${v}">${t.split(' — ')[0]}</option>`).join('');
    sel.value = u.role; sel.disabled = isMe; sel.setAttribute('aria-label', 'Role ' + (u.email || ''));
    sel.addEventListener('change', async () => {
      const { error } = await supabase.from('profiles').update({ role: sel.value }).eq('id', u.id);
      if (error) { toast('Gagal mengubah role: ' + error.message, 'bad'); sel.value = u.role; } else { u.role = sel.value; toast('Role diperbarui'); }
    });
    tr.children[2].appendChild(sel);
    if (!isMe) {
      const del = document.createElement('button'); del.type = 'button'; del.className = 'link-danger'; del.textContent = 'Hapus';
      del.addEventListener('click', () => removeUser(u));
      const wrap = document.createElement('div'); wrap.className = 'row-actions'; wrap.appendChild(del);
      tr.children[3].appendChild(wrap);
    }
    tb.appendChild(tr);
  });
}

async function callApi(path, body) {
  const { data: s } = await supabase.auth.getSession();
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (s.session?.access_token || '') },
    body: JSON.stringify(body)
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}

async function addUser(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const body = {
    name: $('#u-name').value.trim(), email: $('#u-email').value.trim(),
    password: $('#u-pass').value, role: $('#u-role').value
  };
  if (body.password.length < 6) { toast('Password minimal 6 karakter', 'warn'); return; }
  const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
  try {
    await callApi('/api/create-user', body);
    form.reset(); toast('User ditambahkan');
    await load();
  } catch (err) {
    toast('Gagal menambah user: ' + err.message, 'bad');
  } finally { btn.disabled = false; }
}

async function removeUser(u) {
  if (!(await confirmDialog(`Hapus user ${u.email}? Akun ini tidak bisa masuk lagi.`))) return;
  try {
    await callApi('/api/delete-user', { id: u.id });
    toast('User dihapus'); await load();
  } catch (err) { toast('Gagal menghapus user: ' + err.message, 'bad'); }
}
