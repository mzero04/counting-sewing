import { supabase } from '../supabase.js';
import { $ } from '../utils.js';

export function renderLogin(root) {
  root.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="brand">
          <h1>HOGA</h1>
          <p>Counting Sewing</p>
        </div>
        <h2>Login</h2>
        <p class="muted" style="margin:0">Masuk dengan akun yang diberikan oleh admin.</p>
        <form id="f-login" novalidate>
          <div id="login-err" class="form-error" hidden></div>
          <label class="field"><span>Email</span>
            <input type="email" id="in-email" autocomplete="username" required placeholder="nama@perusahaan.com">
          </label>
          <label class="field"><span>Password</span>
            <input type="password" id="in-pass" autocomplete="current-password" required>
          </label>
          <button class="btn" type="submit" id="btn-login">Masuk</button>
        </form>
      </div>
    </div>`;

  const err = $('#login-err');
  const showErr = (t) => { err.hidden = !t; err.textContent = t || ''; };

  $('#f-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    showErr('');
    const email = $('#in-email').value.trim();
    const password = $('#in-pass').value;
    if (!email || !password) { showErr('Email dan password wajib diisi.'); return; }
    const btn = $('#btn-login');
    btn.disabled = true; btn.textContent = 'Memeriksa…';
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    btn.disabled = false; btn.textContent = 'Masuk';
    if (error) {
      showErr(/invalid login/i.test(error.message) ? 'Email atau password salah.' : 'Gagal masuk: ' + error.message);
    }
    // Jika berhasil, onAuthStateChange di main.js akan membuka aplikasi.
  });
}
