-- =====================================================================
-- HOGA Counting Sewing - skema Supabase
-- Jalankan seluruh file ini sekali di Supabase > SQL Editor > New query.
-- Aman dijalankan ulang (idempotent).
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- Profil & role ----------
-- role: admin (kelola master data, absensi, user), contributor (isi counting), viewer (lihat saja)
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  name       text,
  role       text not null default 'contributor' check (role in ('admin','contributor','viewer')),
  created_at timestamptz not null default now()
);

-- User pertama yang mendaftar otomatis menjadi admin, berikutnya contributor.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    case when (select count(*) from public.profiles) = 0 then 'admin' else 'contributor' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.current_role_name()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() = 'admin', false)
$$;
create or replace function public.can_write()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() in ('admin','contributor'), false)
$$;

-- ---------- Master data ----------
create table if not exists public.buyers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists buyers_name_uq on public.buyers (upper(name));

create table if not exists public.lines (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists lines_name_uq on public.lines (upper(name));

create table if not exists public.styles (
  id         uuid primary key default gen_random_uuid(),
  line_id    uuid not null references public.lines(id) on delete restrict,
  buyer_id   uuid references public.buyers(id) on delete set null,
  code       text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists styles_line_code_uq on public.styles (line_id, upper(code));

-- Modul yang tidak dipakai (disembunyikan) per style, mis. {HOOD,GOSOK}. Data tetap tersimpan.
-- Pernyataan ini juga aman dijalankan di database yang sudah ada.
alter table public.styles add column if not exists hidden_modules text[] not null default '{}';

-- ---------- Absensi karyawan (NIK, Nama, Line) ----------
create table if not exists public.employees (
  nik        text primary key,
  name       text not null,
  line_name  text,
  updated_at timestamptz not null default now()
);
create index if not exists employees_line_idx on public.employees (upper(line_name));

-- ---------- Counting harian ----------
create table if not exists public.counting_days (
  id            uuid primary key default gen_random_uuid(),
  style_id      uuid not null references public.styles(id) on delete cascade,
  day           date not null,
  mode          text not null default 'hourly' check (mode in ('hourly','cumulative')),
  wh            numeric not null default 10,
  operator_line integer,
  counts        jsonb not null default '{}'::jsonb,   -- jumlah baris per modul
  created_at    timestamptz not null default now(),
  unique (style_id, day)
);

create table if not exists public.counting_rows (
  id         uuid primary key default gen_random_uuid(),
  day_id     uuid not null references public.counting_days(id) on delete cascade,
  row_key    text not null,                            -- mis. FRONT_3
  data       jsonb not null default '{}'::jsonb,       -- nik, operator, proses, o1..o9, dst.
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (day_id, row_key)
);

-- ---------- Row Level Security ----------
alter table public.profiles       enable row level security;
alter table public.buyers         enable row level security;
alter table public.lines          enable row level security;
alter table public.styles         enable row level security;
alter table public.employees      enable row level security;
alter table public.counting_days  enable row level security;
alter table public.counting_rows  enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists profiles_admin_delete on public.profiles;
create policy profiles_admin_delete on public.profiles for delete to authenticated
  using (public.is_admin() and id <> auth.uid());

-- master data + absensi: semua user login boleh baca, hanya admin boleh ubah
do $$
declare t text;
begin
  foreach t in array array['buyers','lines','styles','employees'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select to authenticated using (true)', t, t);
    execute format('drop policy if exists %I_admin_write on public.%I', t, t);
    execute format('create policy %I_admin_write on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t, t);
  end loop;
  -- counting: semua login boleh baca, admin & contributor boleh tulis
  foreach t in array array['counting_days','counting_rows'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select to authenticated using (true)', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format('create policy %I_write on public.%I for all to authenticated using (public.can_write()) with check (public.can_write())', t, t);
  end loop;
end $$;

-- ---------- Realtime (sinkron antar pengguna) ----------
do $$
declare t text;
begin
  foreach t in array array['counting_days','counting_rows','lines','styles','buyers','employees'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
