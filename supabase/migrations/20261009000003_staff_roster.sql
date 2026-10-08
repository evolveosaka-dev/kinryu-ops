-- Staff roster: the real staff names from the shift table (not only people with an app account).
-- Used for the per-person pickers in 朝礼 (participants) and 巡回 (staff on shift).
-- Names are loaded with scripts/roster-from-shift.mjs and managed by managers in the app;
-- they are never stored in this repository.

create table public.staff_roster (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 1 and 40),
  home_store_id uuid references public.stores (id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger staff_roster_updated before update on public.staff_roster
  for each row execute function public.set_updated_at();

alter table public.staff_roster enable row level security;
create policy staff_roster_select on public.staff_roster for select to authenticated using (public.is_active());
create policy staff_roster_write on public.staff_roster for all to authenticated
  using (public.is_manager()) with check (public.is_manager());
revoke all on public.staff_roster from anon;

-- 巡回: staff on shift as a list of names (staff_on_shift keeps the readable text, "全員" when empty).
alter table public.patrol_checks add column staff_names text[] not null default '{}';
