import { requireAdmin } from './_auth.js';

// Mengambil Google Sheets (publik via link) sebagai CSV, karena browser terhalang CORS.
// Hanya host docs.google.com dan ID sheet yang divalidasi, agar tidak bisa dipakai mengakses alamat lain.
export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;

  const id = String(req.query.id || '');
  const gid = String(req.query.gid || '');
  if (!/^[a-zA-Z0-9_-]{20,100}$/.test(id)) return res.status(400).json({ error: 'ID spreadsheet tidak valid.' });
  if (gid && !/^\d{1,12}$/.test(gid)) return res.status(400).json({ error: 'gid tidak valid.' });

  const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? '&gid=' + gid : ''}`;
  try {
    const r = await fetch(url, { redirect: 'follow' });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || type.includes('text/html')) {
      return res.status(403).json({
        error: 'Sheet tidak bisa dibaca. Pastikan dibagikan dengan akses "Siapa saja yang memiliki link: Pelihat".'
      });
    }
    const text = await r.text();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(text);
  } catch (e) {
    return res.status(502).json({ error: 'Gagal menghubungi Google Sheets.' });
  }
}
