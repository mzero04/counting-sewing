import { supabase } from './supabase.js';
import { natural, norm } from './utils.js';

/* Data bersama (master data, absensi, profil) + sinkron realtime */
export const store = {
  session: null,
  profile: null,
  buyers: [],
  lines: [],
  styles: [],
  employees: [],
  loaded: false
};

const listeners = new Set();
export function onStore(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(what) { listeners.forEach((fn) => { try { fn(what); } catch (e) { console.error(e); } }); }

export const role = () => store.profile?.role || 'viewer';
export const isAdmin = () => role() === 'admin';
export const canWrite = () => role() === 'admin' || role() === 'contributor';

export const lineById = (id) => store.lines.find((l) => l.id === id);
export const buyerById = (id) => store.buyers.find((b) => b.id === id);
export const styleById = (id) => store.styles.find((s) => s.id === id);
export const stylesOfLine = (lineId) => store.styles.filter((s) => s.line_id === lineId);

function sortAll() {
  store.buyers.sort((a, b) => natural(a.name, b.name));
  store.lines.sort((a, b) => natural(a.name, b.name));
  store.styles.sort((a, b) => natural(a.code, b.code));
  store.employees.sort((a, b) => natural(a.nik, b.nik));
}

async function fetchAll() {
  const [b, l, s, e] = await Promise.all([
    supabase.from('buyers').select('*'),
    supabase.from('lines').select('*'),
    supabase.from('styles').select('*'),
    fetchAllEmployees()
  ]);
  const err = b.error || l.error || s.error || e.error;
  if (err) throw err;
  store.buyers = b.data; store.lines = l.data; store.styles = s.data; store.employees = e.data;
  sortAll();
}

// Supabase membatasi 1000 baris per permintaan, jadi ambil bertahap.
async function fetchAllEmployees() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('employees').select('*').range(from, from + 999);
    if (error) return { data: null, error };
    out.push(...data);
    if (data.length < 1000) break;
  }
  return { data: out, error: null };
}

function applyChange(key, payload, pk) {
  const arr = store[key];
  const row = payload.new && Object.keys(payload.new).length ? payload.new : null;
  const old = payload.old || {};
  if (payload.eventType === 'DELETE') {
    store[key] = arr.filter((x) => x[pk] !== old[pk]);
  } else if (row) {
    const i = arr.findIndex((x) => x[pk] === row[pk]);
    if (i >= 0) arr[i] = row; else arr.push(row);
  }
  sortAll();
  emit(key);
}

let channel = null;
export async function startStore(session) {
  store.session = session;
  const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  store.profile = prof || { id: session.user.id, email: session.user.email, name: session.user.email, role: 'viewer' };
  await fetchAll();
  store.loaded = true;

  if (channel) supabase.removeChannel(channel);
  channel = supabase.channel('master-data')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'buyers' }, (p) => applyChange('buyers', p, 'id'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lines' }, (p) => applyChange('lines', p, 'id'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'styles' }, (p) => applyChange('styles', p, 'id'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, (p) => applyChange('employees', p, 'nik'))
    .subscribe();
  emit('all');
}

export async function stopStore() {
  if (channel) { await supabase.removeChannel(channel); channel = null; }
  Object.assign(store, { session: null, profile: null, buyers: [], lines: [], styles: [], employees: [], loaded: false });
}

export async function reloadStore() { await fetchAll(); emit('all'); }

/* Karyawan menurut NIK / line */
export function employeeByNik(nik) {
  const n = norm(nik);
  return n ? store.employees.find((e) => norm(e.nik) === n) : null;
}
export function employeesOfLine(lineName) {
  const n = norm(lineName);
  return store.employees.filter((e) => norm(e.line_name) === n);
}
