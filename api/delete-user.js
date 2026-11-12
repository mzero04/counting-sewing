import { requireAdmin } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;

  const { id } = req.body || {};
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'ID user wajib diisi.' });
  if (id === ctx.userId) return res.status(400).json({ error: 'Anda tidak bisa menghapus akun sendiri.' });

  const { error } = await ctx.admin.auth.admin.deleteUser(id);
  if (error) return res.status(400).json({ error: error.message });
  return res.status(200).json({ ok: true });
}
