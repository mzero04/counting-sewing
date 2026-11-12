import { requireAdmin } from './_auth.js';

const ROLES = ['admin', 'contributor', 'viewer'];

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;

  const { email, password, name, role } = req.body || {};
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Email tidak valid.' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter.' });
  const r = ROLES.includes(role) ? role : 'contributor';

  const { data, error } = await ctx.admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { name: name || '' }
  });
  if (error) return res.status(400).json({ error: /already/i.test(error.message) ? 'Email sudah terdaftar.' : error.message });

  // Trigger membuat profil dengan role default; sesuaikan role & nama sesuai pilihan admin.
  const { error: e2 } = await ctx.admin.from('profiles')
    .upsert({ id: data.user.id, email, name: name || email.split('@')[0], role: r });
  if (e2) return res.status(500).json({ error: 'User dibuat tetapi profil gagal diperbarui: ' + e2.message });

  return res.status(200).json({ ok: true, id: data.user.id });
}
