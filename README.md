# HOGA Counting Sewing

Aplikasi counting sewing harian (Vite + Supabase), tampil putih-biru seperti HOGA B Weekly Monitoring.

Fitur:
- Login email + password (Supabase Auth) dengan 3 role: **admin**, **contributor**, **viewer**
- Counting harian per line / style / tanggal, tersimpan di database dan sinkron realtime antar pengguna
- Master data **Buyer, Line, Style**: tambah (banyak style sekaligus, buyer baru otomatis dibuat), ubah nama, pindah line, cari/filter, hapus dengan konfirmasi
- **Absensi**: impor NIK, Nama, Line dari file Excel/CSV atau link Google Sheets. Di halaman Counting, mengisi NIK otomatis mengisi nama operator (dan sebaliknya)
- Export Excel per line/style/tanggal
- Halaman User untuk admin (tambah user, ubah role, hapus)

## 1. Siapkan Supabase

1. Buat project di <https://supabase.com>.
2. Buka **SQL Editor > New query**, tempel isi `supabase/schema.sql`, lalu **Run**.
3. Buka **Authentication > Providers > Email**, nonaktifkan **Allow new users to sign up** (agar hanya akun dari admin yang bisa masuk).
4. Buat akun admin pertama di **Authentication > Users > Add user** (centang *Auto Confirm User*). **User pertama otomatis menjadi admin**, user berikutnya menjadi contributor.
5. Ambil **Project URL** dan **anon key** di **Project Settings > API**.

## 2. Jalankan lokal

```bash
npm install
cp .env.example .env     # isi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY
npm run dev
```

Buka <http://localhost:5173>. Catatan: fungsi `/api/*` (tambah user dari aplikasi, ambil Google Sheets lewat link) hanya jalan di Vercel atau dengan `vercel dev`. Impor file Excel/CSV dan semua fitur lain jalan dengan `npm run dev`.

## 3. Deploy ke Vercel

1. Push folder ini ke GitHub, lalu **Import** di Vercel (framework Vite terdeteksi otomatis).
2. Isi **Environment Variables**:

| Nama | Isi |
|---|---|
| `VITE_SUPABASE_URL` | Project URL |
| `VITE_SUPABASE_ANON_KEY` | anon key |
| `SUPABASE_URL` | Project URL (sama) |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key (**rahasia**, hanya dipakai fungsi server) |

3. Deploy.

## Format absensi

Baris judul harus memuat kolom **NIK** dan **Nama**; kolom **Line** opsional tapi disarankan.

| NIK | Nama | Line |
|---|---|---|
| 12345 | Siti | B2 |

Nama kolom lain yang dikenali: `Nama Karyawan`, `Name`, `ID`, `NIP`, `Lini`. Nama line sebaiknya sama persis dengan nama line di Master data, supaya saran NIK/nama di Counting hanya menampilkan karyawan line tersebut.

Untuk Google Sheets: bagikan sheet dengan akses "Siapa saja yang memiliki link: Pelihat", tempel link di halaman Absensi. Jika link memuat `gid=...`, tab itu yang dibaca. Link terakhir diingat di browser untuk sinkron ulang.

## Hak akses

| | admin | contributor | viewer |
|---|:-:|:-:|:-:|
| Lihat semua | ✓ | ✓ | ✓ |
| Isi counting | ✓ | ✓ | |
| Master data, absensi, user | ✓ | | |

Aturan ini dijaga di database (Row Level Security), bukan hanya di tampilan.

## Struktur

```
api/               fungsi server Vercel (create-user, delete-user, sheet-proxy)
supabase/schema.sql   tabel, RLS, trigger profil, realtime
src/main.js        login gate, router, shell
src/store.js       master data + absensi + realtime
src/views/         login, counting, master, absensi, users
```

## Catatan

- Menghapus **style** ikut menghapus data counting style itu (dikonfirmasi di aplikasi).
- Data dari versi HTML lama (penyimpanan Claude) tidak otomatis dipindahkan; mulai dari database baru.
