-- 目標杯数 v2 (from 2026-10): six day types instead of 平日 / 土日祝, and events that raise or lower the
-- target of a date per store and shift (e.g. 阪神 games, Halloween).
--   weekday 平日（月〜木） / friday 金曜・祝前日 / saturday 土曜 / sunday_holiday 日曜・祝日（連休の最終日）
--   long_holiday 連休中（3日以上の連休の途中） / peak 繁忙期（12/29〜1/3・8/13〜16）
-- Months before 2026-10 keep weekday / weekend_holiday. The figures (2025 sales) are loaded outside the repo.

alter table public.target_bowls drop constraint if exists target_bowls_day_type_check;
alter table public.target_bowls add constraint target_bowls_day_type_check
  check (day_type in ('weekday', 'weekend_holiday', 'friday', 'saturday', 'sunday_holiday', 'long_holiday', 'peak'));

create table public.target_events (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  -- null = both stores
  store_id uuid references public.stores (id),
  early_pct int not null default 0 check (early_pct between -90 and 300),
  middle_pct int not null default 0 check (middle_pct between -90 and 300),
  late_pct int not null default 0 check (late_pct between -90 and 300),
  active boolean not null default true,
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index target_events_date on public.target_events (event_date);
create trigger target_events_updated before update on public.target_events for each row execute function public.set_updated_at();

alter table public.target_events enable row level security;
revoke all on public.target_events from anon;
create policy target_events_select on public.target_events for select to authenticated using (public.is_active());
create policy target_events_write on public.target_events for all to authenticated
  using (public.is_manager()) with check (public.is_manager());
create trigger test_account_read_only before insert or update or delete on public.target_events
  for each row execute function public.guard_test_account_writes();

-- Events whose effect was measured on the 2025 sales (same-type days of the same month = 100).
insert into public.target_events (event_date, name, store_id, early_pct, middle_pct, late_pct, active, note)
select d::date, e.name, s.id, e.e, e.m, e.l, e.active, e.note
from (values
  -- 阪神 CS ファイナル（甲子園）2026-10-14〜19 — 2025 CS: 中番 −20%, 御堂筋 遅番 −15%
  ('2026-10-14', '2026-10-19', '阪神 CSファイナル（甲子園）', 'sennichimae', 0, -20, 0, true, '2025年CS: 中番 −21%'),
  ('2026-10-14', '2026-10-19', '阪神 CSファイナル（甲子園）', 'midosuji', 0, -20, -15, true, '2025年CS: 中番 −18%・遅番 −15%'),
  -- 日本シリーズ: Central home games 1·2·6·7 — switch on when 阪神 is in it
  ('2026-10-24', '2026-10-25', '阪神 日本シリーズ（甲子園）', 'sennichimae', 10, 10, 10, false, '阪神が出場したらONにする。2025年 甲子園の試合日: +12%'),
  ('2026-10-24', '2026-10-25', '阪神 日本シリーズ（甲子園）', 'midosuji', 10, -5, 25, false, '阪神が出場したらONにする。2025年 甲子園の試合日: 遅番 +24%'),
  ('2026-10-31', '2026-11-01', '阪神 日本シリーズ（甲子園）', 'sennichimae', 10, 10, 10, false, '第6・7戦（行われる場合）。阪神が出場したらONにする'),
  ('2026-10-31', '2026-11-01', '阪神 日本シリーズ（甲子園）', 'midosuji', 10, -5, 25, false, '第6・7戦（行われる場合）。阪神が出場したらONにする'),
  -- ハロウィン（道頓堀）— 2025-10-31: 千日前 中番 +20%, 御堂筋 遅番 +46%
  ('2026-10-31', '2026-10-31', 'ハロウィン', 'sennichimae', 0, 20, 5, true, '2025年: 中番 +20%'),
  ('2026-10-31', '2026-10-31', 'ハロウィン', 'midosuji', 0, -15, 45, true, '2025年: 遅番 +46%'),
  -- クリスマス — 2025-12-24/25: −15%
  ('2026-12-24', '2026-12-25', 'クリスマス', 'sennichimae', -15, -15, -15, true, '2025年: −14%'),
  ('2026-12-24', '2026-12-25', 'クリスマス', 'midosuji', -15, -15, -15, true, '2025年: −18%'),
  -- 十日戎（今宮戎）2027-01-09〜11 — 御堂筋 −10%〜−15% (2025・2026)
  ('2027-01-09', '2027-01-11', '十日戎（今宮戎）', 'midosuji', -10, -10, -10, true, '2025年 −16%・2026年 −11%')
) as e (d1, d2, name, code, e, m, l, active, note)
cross join lateral generate_series(e.d1::date, e.d2::date, interval '1 day') d
join public.stores s on s.code = e.code;
