export const $ = (s, r) => (r || document).querySelector(s);
export const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

export const nf = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
export const nf1 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });

export function todayStr() {
  try { return new Date().toLocaleDateString('sv-SE'); }
  catch { return new Date().toISOString().slice(0, 10); }
}

export function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
export function disp(n) { return n == null ? '' : nf.format(n); }
export function raw(n) { return n == null ? '' : String(n).replace('.', ','); }

export function parseNum(s) {
  s = String(s).trim().replace(/\s/g, '');
  if (!s) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
export const norm = (s) => String(s ?? '').trim().toUpperCase();

export function sanitizeFile(s) {
  const t = String(s).trim().replace(/[^A-Za-z0-9_\-.]/g, '-').replace(/-{2,}/g, '-').slice(0, 60);
  return t || 'x';
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* Toast sederhana */
let toastTimer;
export function toast(text, kind = 'ok') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.dataset.kind = kind;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

/* Status simpan di topbar */
export function setSaveState(text, kind = '') {
  const el = document.getElementById('save-state');
  if (el) { el.textContent = text; el.dataset.kind = kind; }
}

/* Dialog konfirmasi */
export function confirmDialog(message, okLabel = 'Hapus') {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <p>${esc(message)}</p>
        <div class="modal-actions">
          <button class="btn ghost" data-r="0" type="button">Batal</button>
          <button class="btn danger" data-r="1" type="button">${esc(okLabel)}</button>
        </div>
      </div>`;
    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-r]');
      if (b) done(b.dataset.r === '1');
      else if (e.target === wrap) done(false);
    });
    document.body.appendChild(wrap);
    wrap.querySelector('[data-r="0"]').focus();
  });
}

/* Debounce */
export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
