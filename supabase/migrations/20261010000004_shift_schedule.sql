-- シフトスケジュール: assignments read from the monthly shift workbook (sheets 早番 / 中番 / 遅番).
-- Cells like "①11-17.5" → store mark ①, 11:00–17:30. Times are minutes from 00:00 of the
-- business date (遅番 23-7 → 1380–1860). Marks: ① 御堂筋店, ③ 戎橋店, ④ 道頓堀店, ⑤ 千日前店.

-- Link an app account to the name used in the shift table (e.g. "madushanka" → バンダラ).
alter table public.profiles add column roster_name text;
create unique index profiles_roster_name on public.profiles (roster_name) where roster_name is not null;

create table public.shift_assignments (
  id uuid primary key default gen_random_uuid(),
  month date not null check (extract(day from month) = 1),
  business_date date not null,
  shift text not null check (shift in ('early', 'middle', 'late')),
  roster_name text not null,
  store_mark text not null,
  store_id uuid references public.stores (id),
  start_min int not null check (start_min between 0 and 1440),
  end_min int not null check (end_min > start_min and end_min <= 2880),
  raw text not null,
  imported_at timestamptz not null default now(),
  unique (business_date, shift, roster_name)
);
create index shift_assignments_person on public.shift_assignments (roster_name, business_date);
create index shift_assignments_slot on public.shift_assignments (business_date, shift, store_mark);

alter table public.shift_assignments enable row level security;
revoke all on public.shift_assignments from anon;

create function public.my_roster_name() returns text
language sql stable security definer set search_path = ''
as $$ select roster_name from public.profiles where id = auth.uid() and status = 'active' $$;

-- Staff read their own assignments; managers read everything. Writes go through import_shift_month().
create policy shift_assignments_select on public.shift_assignments for select to authenticated
  using (public.is_manager() or (roster_name = public.my_roster_name()));

-- Who else works the same shift at the same store (for the detail view). Only for dates
-- where the caller works that shift there.
create function public.shift_coworkers(p_date date, p_shift text)
returns table (roster_name text, start_min int, end_min int, store_mark text)
language sql stable security definer set search_path = ''
as $$
  select o.roster_name, o.start_min, o.end_min, o.store_mark
  from public.shift_assignments mine
  join public.shift_assignments o
    on o.business_date = mine.business_date and o.shift = mine.shift and o.store_mark = mine.store_mark
  where mine.roster_name = public.my_roster_name()
    and mine.business_date = p_date and mine.shift = p_shift
    and o.roster_name <> mine.roster_name
  order by o.start_min, o.roster_name
$$;

-- Replace one month of assignments (manager only). rows: [{business_date, shift, roster_name,
-- store_mark, start_min, end_min, raw}, …]. New names are added to the staff roster.
create function public.import_shift_month(p_month date, p_rows jsonb)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  if not public.is_manager() then
    raise exception 'managers only' using errcode = '42501';
  end if;
  delete from public.shift_assignments where month = p_month;
  insert into public.shift_assignments (month, business_date, shift, roster_name, store_mark, store_id, start_min, end_min, raw)
  select p_month, (r ->> 'business_date')::date, r ->> 'shift', r ->> 'roster_name', r ->> 'store_mark',
         (select s.id from public.stores s where s.code = case r ->> 'store_mark' when '①' then 'midosuji' when '⑤' then 'sennichimae' end),
         (r ->> 'start_min')::int, (r ->> 'end_min')::int, r ->> 'raw'
  from jsonb_array_elements(p_rows) r
  where date_trunc('month', (r ->> 'business_date')::date)::date = p_month;
  get diagnostics n = row_count;
  insert into public.staff_roster (name)
  select distinct r ->> 'roster_name' from jsonb_array_elements(p_rows) r
  on conflict (name) do nothing;
  return n;
end $$;

revoke execute on function public.import_shift_month(date, jsonb) from anon, public;
grant execute on function public.import_shift_month(date, jsonb) to authenticated;
revoke execute on function public.shift_coworkers(date, text) from anon, public;
grant execute on function public.shift_coworkers(date, text) to authenticated;
revoke execute on function public.my_roster_name() from anon, public;
grant execute on function public.my_roster_name() to authenticated;

-- Only managers may link an account to a shift-table name (otherwise staff could read others' shifts).
create or replace function public.guard_profile_update() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.full_name is not null then
    new.full_name := regexp_replace(btrim(new.full_name), '\s+', ' ', 'g');
  end if;
  if public.is_manager() or auth.uid() is null then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.can_patrol is distinct from old.can_patrol
     or new.status is distinct from old.status
     or new.email is distinct from old.email
     or new.roster_name is distinct from old.roster_name
     or (new.home_store_id is distinct from old.home_store_id and old.status <> 'pending') then
    raise exception 'only managers can change role, permissions, status, store or shift-table name' using errcode = '42501';
  end if;
  if new.full_name is distinct from old.full_name and coalesce(btrim(old.full_name), '') <> '' then
    raise exception 'only managers can change the full name' using errcode = '42501';
  end if;
  return new;
end $$;
