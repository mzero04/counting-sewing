# HOGA Counting Sewing

Aplikasi counting sewing harian (Vite + Supabase), tampil putih-biru seperti HOGA B Weekly Monitoring.

Fitur:
- Login email + password (Supabase Auth) dengan 3 role: **admin**, **contributor**, **viewer**
- Counting harian per line / style / tanggal, tersimpan di database dan sinkron realtime antar pengguna
- Master data **Buyer, Line, Style**: tambah (banyak style sekaligus, buyer baru otomatis dibuat), ubah nama, pindah line, cari/filter, hapus dengan konfirmasi
- **Absensi**: impor NIK, Nama, Line dari file Excel/CSV atau link Google Sheets. Di halaman Counting, mengisi NIK otomatis mengisi nama operator (dan sebaliknya)
- **Action Plan Report**: laporan per style (seperti spreadsheet Action Plan) yang terhubung ke Counting dan bisa disalin ke email
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

## Action Plan Report

Menu **Action Plan** menampilkan laporan per line/style/tanggal: ringkasan per modul (Pcs/Jam, Total Output, Working Days, Total Operator, Production Target, Stock, Balance Days, Expected Finish Date) dan tabel detail harian.

**Terhubung ke Counting.** Output harian dan jumlah operator tiap modul dihitung otomatis dari halaman Counting (jumlah semua Pcs/jam semua baris modul itu). Total Input JOIN, ASSEMBLY, dan QC ENDLINE diambil dari output modul sebelumnya. Mengisi Counting langsung memperbarui Action Plan, bahkan di layar pengguna lain. P.Qty yang diisi di Action Plan muncul sebagai isian bawaan di kolom P.Qty Counting, dan ada tombol pindah antar halaman (termasuk langsung ke tanggal yang sama).

**Tetap bisa diedit manual.** Kolom Target, Output/Day, Total Input, W/H, Stock Qty, dan Operator di tabel harian bisa diketik langsung. Sel yang diubah manual berwarna biru; mengosongkannya mengembalikan ke angka otomatis. Perubahan manual tidak mengubah data Counting.

**Salin ke email.** Tombol **Salin untuk email** menyalin laporan (header, tabel ringkasan, dan catatan action plan; opsional tabel harian) sebagai tabel berformat. Paste langsung di Gmail atau Outlook. **Salin judul email** menyalin baris subjek.

**Rumus** (disamakan dengan spreadsheet):
- Total Output = jumlah Output/Day sampai tanggal itu; Balance = P.Qty - Total Output
- Pcs/Jam = Output/Day / W/H; Working Days = jumlah hari dengan output
- Balance Days = Balance / Target jadwal per hari pada hari kerja pertama, lalu Balance / Output/Day hari itu
- Expected Finish = tanggal + Balance Days (dibulatkan ke atas), hari Minggu libur
- Stock Qty otomatis = Total Input - Total Output; Stock Days = Stock Qty / (Target x W/H)

Isi **Pengaturan style** (P.Qty, target, W/H, target jadwal/hari, modul yang tampil, tanggal first output) sekali per style.

## Hak akses

| | admin | contributor | viewer |
|---|:-:|:-:|:-:|
| Lihat semua | ✓ | ✓ | ✓ |
| Isi counting | ✓ | ✓ | |
| Action Plan (pengaturan, angka manual, catatan) | ✓ | ✓ | |
| Atur modul di Counting | ✓ | ✓ | |
| Master data, absensi, user | ✓ | | |

Aturan ini dijaga di database (Row Level Security), bukan hanya di tampilan.

## Struktur

```
api/               fungsi server Vercel (create-user, delete-user, sheet-proxy)
supabase/schema.sql   tabel, RLS, trigger profil, realtime
src/main.js        login gate, router, shell
src/store.js       master data + absensi + realtime
src/views/         login, counting, action (action plan), master, absensi, users
src/lib/           actionplan.js (rumus), email.js (isi email)
test/              uji rumus: node test/actionplan.test.mjs
```

## Catatan

- Menghapus **style** ikut menghapus data counting style itu (dikonfirmasi di aplikasi).
- Data dari versi HTML lama (penyimpanan Claude) tidak otomatis dipindahkan; mulai dari database baru.
