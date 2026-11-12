import { createClient } from '@supabase/supabase-js';

// Memastikan pemanggil adalah admin yang sedang login. Mengembalikan klien service-role.
export async function requireAdmin(req, res) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diatur di environment server.' });
    return null;
  }
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) { res.status(401).json({ error: 'Belum login.' }); return null; }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: u, error } = await admin.auth.getUser(token);
  if (error || !u?.user) { res.status(401).json({ error: 'Sesi tidak valid.' }); return null; }

  const { data: prof } = await admin.from('profiles').select('role').eq('id', u.user.id).maybeSingle();
  if (!prof || prof.role !== 'admin') { res.status(403).json({ error: 'Hanya admin yang boleh melakukan ini.' }); return null; }
  return { admin, userId: u.user.id };
}
