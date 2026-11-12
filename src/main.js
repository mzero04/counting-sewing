import './style.css';
import { supabase, configured } from './supabase.js';
import { store, startStore, stopStore, role, isAdmin, onStore } from './store.js';
import { $, esc, toast } from './utils.js';
import { renderLogin } from './views/login.js';
import * as counting from './views/counting.js';
import * as master from './views/master.js';
import * as absensi from './views/absensi.js';
import * as users from './views/users.js';

const app = document.getElementById('app');

const ROUTES = {
  counting: { label: 'Counting', view: counting },
  master: { label: 'Master data', view: master },
  absensi: { label: 'Absensi', view: absensi },
  users: { label: 'User', view: users, adminOnly: true }
};

let current = null;

function routeName() {
  const h = location.hash.replace('#', '');
  const r = ROUTES[h];
  return r && !(r.adminOnly && !isAdmin()) ? h : 'counting';
}

function renderShell() {
  const items = Object.entries(ROUTES).filter(([, r]) => !r.adminOnly || isAdmin());
  app.innerHTML = `
    <header class="topbar">
      <div class="logo">HOGA<small>Counting Sewing</small></div>
      <nav class="tabs" aria-label="Halaman">
        ${items.map(([k, r]) => `<a href="#${k}" data-r="${k}">${r.label}</a>`).join('')}
      </nav>
      <div class="who">
        <span class="save-state" id="save-state" role="status" aria-live="polite"></span>
        <span class="name"><strong>${esc(store.profile?.name || store.profile?.email || '')}</strong></span>
        <span class="badge">${esc(role())}</span>
        <button class="btn ghost sm" id="btn-logout" type="button">Keluar</button>
      </div>
    </header>
    <main id="view"></main>`;
  $('#btn-logout').addEventListener('click', async () => {
    await supabase.auth.signOut();
  });
}

function route() {
  if (!store.session) return;
  const name = routeName();
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.r === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  if (current && current.unmount) current.unmount();
  const view = $('#view');
  view.innerHTML = '';
  current = ROUTES[name].view;
  current.mount(view);
}

async function enter(session) {
  try {
    await startStore(session);
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="login-wrap"><div class="login-card"><h2>Gagal memuat data</h2>
      <p class="muted">Pastikan skema database sudah dijalankan (supabase/schema.sql).<br><small>${esc(e.message || e)}</small></p>
      <button class="btn" id="retry" type="button">Coba lagi</button></div></div>`;
    $('#retry').addEventListener('click', () => enter(session));
    return;
  }
  document.body.classList.toggle('can-admin', isAdmin());
  renderShell();
  route();
}

async function leave() {
  if (current && current.unmount) current.unmount();
  current = null;
  await stopStore();
  document.body.classList.remove('can-admin');
  renderLogin(app);
}

window.addEventListener('hashchange', route);

// Perubahan role (mis. admin mengubah role Anda) ikut memperbarui tampilan.
onStore((what) => {
  if (what === 'profile') { document.body.classList.toggle('can-admin', isAdmin()); renderShell(); route(); }
});

async function boot() {
  if (!configured) {
    app.innerHTML = `<div class="login-wrap"><div class="login-card">
      <h2>Supabase belum diatur</h2>
      <p class="muted">Salin <code>.env.example</code> menjadi <code>.env</code>, isi <code>VITE_SUPABASE_URL</code> dan
      <code>VITE_SUPABASE_ANON_KEY</code>, lalu jalankan ulang <code>npm run dev</code>.</p></div></div>`;
    return;
  }
  const { data } = await supabase.auth.getSession();
  if (data.session) await enter(data.session); else renderLogin(app);

  let lastId = data.session?.user?.id || null;
  supabase.auth.onAuthStateChange((event, session) => {
    // dijalankan di luar callback agar tidak memblokir klien auth
    setTimeout(async () => {
      if (event === 'SIGNED_OUT' || !session) { lastId = null; await leave(); return; }
      if (event === 'SIGNED_IN' && session.user.id !== lastId) { lastId = session.user.id; await enter(session); }
    }, 0);
  });
}

boot().catch((e) => { console.error(e); toast('Aplikasi gagal dimulai', 'bad'); });
