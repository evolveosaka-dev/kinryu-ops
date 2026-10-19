-- 前年の特殊期間 (owner, 2026-10-19; 杯数の予測 v3): days whose figures were unusual, so that a forecast built on
-- last year's figures takes their effect out. The effect is measured by the app per store × shift (the year-on-year
-- ratio outside ÷ inside the period); a period with too few days to measure is left out of last year's averages.
-- 大阪・関西万博 (2025-04-13〜10-13): 2026 vs 2025 was −6 % before it and after it, −15 % during it.

create table public.sales_periods (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  date_from date not null,
  date_to date not null check (date_to >= date_from),
  -- null = both stores
  store_id uuid references public.stores (id),
  active boolean not null default true,
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger sales_periods_updated before update on public.sales_periods for each row execute function public.set_updated_at();

alter table public.sales_periods enable row level security;
revoke all on public.sales_periods from anon;
create policy sales_periods_select on public.sales_periods for select to authenticated using (public.is_active());
create policy sales_periods_write on public.sales_periods for all to authenticated
  using (public.is_manager()) with check (public.is_manager());
create trigger test_account_read_only before insert or update or delete on public.sales_periods
  for each row execute function public.guard_test_account_writes();

insert into public.sales_periods (name, date_from, date_to, note)
values ('大阪・関西万博', '2025-04-13', '2025-10-13', '2025年は万博で観光客が多かった。期間中の前年比 −15%、期間の前後 −6%');
