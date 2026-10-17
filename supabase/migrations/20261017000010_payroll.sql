-- 給与計算 (owner, 2026-10-17): the payroll workbook's formulas in the app. System Admin only — not managers,
-- not test accounts (also a test admin cannot). Hours come from the Office 365 shift workbook's sheets (勤怠 etc.,
-- payroll_sources, written by shift-sync); rates / per-person settings / monthly inputs were loaded from the
-- payroll workbook outside the repo (no names or amounts in git). The original workbook is kept unchanged in the
-- private Storage bucket `payroll` (payroll_files: sha256). Billing to 金龍 (請求・清算) comes later.

create or replace function public.is_payroll_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select public.is_admin() and not public.is_test_account() $$;
revoke execute on function public.is_payroll_admin() from anon, public;
grant execute on function public.is_payroll_admin() to authenticated;

-- 時給・手当の単価, from a month on
create table public.payroll_rates (
  valid_from date primary key check (extract(day from valid_from) = 1),
  normal int not null check (normal > 0),
  night int not null check (night > 0),
  overtime int not null check (overtime > 0),
  training_normal int not null check (training_normal > 0),
  training_night int not null check (training_night > 0),
  day_leader_unit int not null default 0 check (day_leader_unit >= 0),
  training_allowance_unit int not null default 0 check (training_allowance_unit >= 0),
  busy_unit int not null default 0 check (busy_unit >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

-- one row per person on the payroll (name = the shift-table name)
create table public.payroll_staff (
  roster_name text primary key,
  staff_code text,
  kind text not null check (kind in ('早番', '中番', '遅番', '正社員')),
  commute_unit int not null default 0 check (commute_unit >= 0),
  leader_unit int not null default 0 check (leader_unit >= 0),
  shift_make_amount int not null default 0 check (shift_make_amount >= 0),
  active boolean not null default true,
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

-- the month's own figures per person (有給, 繁忙, その他, 出勤回数調整, 紹介料)
create table public.payroll_inputs (
  month date not null check (extract(day from month) = 1),
  roster_name text not null,
  paid_daily numeric not null default 0 check (paid_daily >= 0),
  paid_days numeric not null default 0 check (paid_days >= 0),
  busy_hours numeric not null default 0 check (busy_hours >= 0),
  other1_amount int not null default 0,
  other1_note text,
  other2_amount int not null default 0,
  other2_note text,
  commute_adjust int not null default 0,
  referral_amount int not null default 0,
  referral_note text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  primary key (month, roster_name)
);

-- the shift workbook's sheets for the month (PayrollSource JSON), written by shift-sync
create table public.payroll_sources (
  month date primary key check (extract(day from month) = 1),
  data jsonb not null,
  source text not null check (source in ('office365', 'payroll_file')),
  imported_at timestamptz not null default now()
);

-- 確定: the results as they were (the figures no longer change with the sources)
create table public.payroll_closings (
  month date primary key check (extract(day from month) = 1),
  results jsonb not null,
  total bigint not null,
  source_imported_at timestamptz,
  closed_at timestamptz not null default now(),
  closed_by uuid references public.profiles (id) on delete set null,
  closed_by_name text
);

create table public.payroll_files (
  id uuid primary key default gen_random_uuid(),
  month date,
  name text not null,
  storage_path text not null unique,
  sha256 text not null,
  size_bytes bigint not null,
  note text,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid references public.profiles (id) on delete set null
);

do $$
declare
  t text;
begin
  foreach t in array array['payroll_rates', 'payroll_staff', 'payroll_inputs', 'payroll_sources', 'payroll_closings', 'payroll_files'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_payroll_admin())', t || '_select', t);
  end loop;
  foreach t in array array['payroll_rates', 'payroll_staff', 'payroll_inputs'] loop
    execute format('grant insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_payroll_admin()) with check (public.is_payroll_admin())', t || '_write', t);
  end loop;
end $$;

-- who changed it; a 確定 month cannot be changed
create or replace function public.payroll_touch() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
create or replace function public.payroll_inputs_open() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if exists (select 1 from public.payroll_closings c where c.month in (old.month, new.month)) then
    raise exception 'month_closed' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger payroll_rates_touch before insert or update on public.payroll_rates for each row execute function public.payroll_touch();
create trigger payroll_staff_touch before insert or update on public.payroll_staff for each row execute function public.payroll_touch();
create trigger payroll_inputs_touch before insert or update on public.payroll_inputs for each row execute function public.payroll_touch();
create trigger payroll_inputs_open before insert or update or delete on public.payroll_inputs for each row execute function public.payroll_inputs_open();

create or replace function public.close_payroll(p_month date, p_results jsonb, p_total bigint) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_payroll_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  insert into public.payroll_closings (month, results, total, source_imported_at, closed_by, closed_by_name)
  values (p_month, p_results, p_total, (select s.imported_at from public.payroll_sources s where s.month = p_month), auth.uid(),
          (select coalesce(p.full_name, p.display_name) from public.profiles p where p.id = auth.uid()));
end $$;

create or replace function public.reopen_payroll(p_month date) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_payroll_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  delete from public.payroll_closings where month = p_month;
end $$;
revoke execute on function public.close_payroll(date, jsonb, bigint) from public, anon;
grant execute on function public.close_payroll(date, jsonb, bigint) to authenticated;
revoke execute on function public.reopen_payroll(date) from public, anon;
grant execute on function public.reopen_payroll(date) to authenticated;

-- the original workbook (never modified), System Admin only
do $$
begin
  if to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('payroll', 'payroll', false, 50 * 1024 * 1024)
    on conflict (id) do nothing;
    create policy payroll_read on storage.objects for select to authenticated
      using (bucket_id = 'payroll' and public.is_payroll_admin());
  end if;
end $$;
