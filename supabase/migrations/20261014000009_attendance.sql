-- 出勤評価 (owner, 2026-10-14): points per event; the app adds them to 100 over the last 90 days
-- (src/domain/attendance.ts: A ≥ 95 / B 85–94 / C 70–84 / D < 70).
-- Sources: 休み・遅刻・早退の連絡 (shift_changes, open or approved), the スタッフ rows of sent 販売日報
-- (遅刻 / 早退 / 欠勤 without a report = 連絡なし), replacements (代わり) and full months (皆勤).
-- We judge how early people report, never being sick; 有給 and 店の都合 are always 0 (労基法 附則136条).
--   欠勤: reported before the day of the shift → 0 with a replacement, −1 without;
--         on the day ≥ 2 h before the start −3; < 2 h −5; after the start or not at all (無断) −10
--   遅刻: ≤ 15 min −1, > 15 min −2; reported after the start or not at all: another −2
--   早退: −1; not reported: another −2
--   代わりに入った +2; 皆勤 (a finished month with shifts and no minus) +3
-- Managers may exclude an event or change its points (attendance_overrides, with a note).

create table public.attendance_overrides (
  event_key text primary key,
  points int check (points between -20 and 20),
  excluded boolean not null default false,
  note text check (char_length(note) <= 300),
  updated_by uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);
create trigger attendance_overrides_updated before update on public.attendance_overrides for each row execute function public.set_updated_at();
alter table public.attendance_overrides enable row level security;
revoke all on public.attendance_overrides from anon;
create policy attendance_overrides_manager on public.attendance_overrides for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

/** "07:20" → 440 */
create function public.hhmm_min(p text) returns int
language sql immutable set search_path = ''
as $$ select case when p ~ '^\d{1,2}:\d{2}$' then split_part(p, ':', 1)::int * 60 + split_part(p, ':', 2)::int end $$;

/**
 * Attendance events of [from, to]: managers everyone, staff only themselves.
 * points = after the manager's override (0 when excluded); base_points = the rule.
 */
create function public.attendance_events(p_from date, p_to date)
returns table (event_key text, roster_name text, business_date date, shift text, kind text, reason text,
               minutes int, notice_min int, reported boolean, base_points int, points int, excluded boolean, note text)
language sql stable security definer set search_path = ''
as $$
  with me as (select public.my_roster_name() as name, public.is_manager() as mgr where public.is_active()),
  test_names as (select p.roster_name from public.profiles p where p.is_test_account and p.roster_name is not null),
  ch as (
    select c.* from public.shift_changes c
    where c.status in ('open', 'approved') and not c.is_test and c.business_date between p_from and p_to
  ),
  rep as (
    select r.id as report_id, r.business_date, r.shift, r.store_id, s ->> 'name' as name, s ->> 'status' as status, s ->> 'start' as start_txt
    from public.sales_reports r
    cross join lateral jsonb_array_elements(r.staff) s
    where r.status = 'submitted' and not r.by_test_account and r.business_date between p_from and p_to
      and s ->> 'status' in ('late', 'early_leave', 'absent')
  ),
  -- actual lateness from the 販売日報 start time vs the shift table (遅番 past midnight handled)
  rep_late as (
    select rep.*,
      (select case when public.hhmm_min(rep.start_txt) is null then null
                   else greatest(0, ((public.hhmm_min(rep.start_txt) - a.start_min + 720 + 1440 * 2) % 1440) - 720) end
       from public.shift_assignments a
       where a.roster_name = rep.name and a.business_date = rep.business_date and a.shift = rep.shift) as late_actual
    from rep
  ),
  base as (
    -- reported absences / lateness / early leaves
    select 'change:' || c.id as event_key, c.roster_name, c.business_date, c.shift,
      case when c.kind = 'absence' and c.reason = 'paid_leave' then 'paid_leave' else c.kind end as kind,
      c.reason,
      case when c.kind = 'late' then greatest(c.late_min, coalesce(rl.late_actual, 0)) when c.kind = 'early_leave' then c.end_min - c.leave_min end as minutes,
      c.notice_min, c.notice_min >= 0 as reported,
      case
        when c.reason in ('paid_leave', 'store') then 0
        when c.kind = 'absence' then
          case when (c.reported_at at time zone 'Asia/Tokyo')::date < c.business_date then case when c.cover_name is not null then 0 else -1 end
               when c.notice_min >= 120 then -3
               when c.notice_min >= 0 then -5
               else -10 end
        when c.kind = 'late' then
          (case when greatest(c.late_min, coalesce(rl.late_actual, 0)) <= 15 then -1 else -2 end) + (case when c.notice_min < 0 then -2 else 0 end)
        else -1
      end as base_points
    from ch c
    left join lateral (select max(x.late_actual) as late_actual from rep_late x
                       where x.name = c.roster_name and x.business_date = c.business_date and x.shift = c.shift and x.status = 'late') rl on true
    union all
    -- written in a 販売日報 without any report (連絡なし)
    select 'report:' || r.report_id || ':' || r.name, r.name, r.business_date, r.shift,
      case r.status when 'absent' then 'absence' else r.status end, null,
      case when r.status = 'late' then r.late_actual end, null, false,
      case r.status
        when 'absent' then -10
        when 'late' then (case when coalesce(r.late_actual, 0) <= 15 then -1 else -2 end) - 2
        else -3
      end
    from rep_late r
    where not exists (select 1 from ch c where c.roster_name = r.name and c.business_date = r.business_date and c.shift = r.shift)
    union all
    -- 代わりに入った
    select 'cover:' || c.id, c.cover_name, c.business_date, c.shift, 'cover', null,
      case when c.kind = 'early_leave' then c.end_min - c.leave_min else c.end_min - c.start_min end, null, true, 2
    from ch c
    where c.status = 'approved' and c.cover_name is not null
  ),
  months as (
    select m::date as month
    from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') m
    where m::date >= p_from and (m + interval '1 month')::date - 1 <= least(p_to, (now() at time zone 'Asia/Tokyo')::date - 1)
  ),
  perfect as (
    select 'perfect:' || a.roster_name || ':' || to_char(m.month, 'YYYY-MM') as event_key, a.roster_name, max(a.business_date) as business_date,
      null::text as shift, 'perfect' as kind, null::text as reason, count(*)::int as minutes, null::int as notice_min, true as reported, 3 as base_points
    from months m
    join public.shift_assignments a on a.month = m.month
    where not exists (select 1 from base b where b.roster_name = a.roster_name and b.base_points < 0
                        and b.business_date >= m.month and b.business_date < (m.month + interval '1 month')::date)
    group by a.roster_name, m.month
  ),
  everything as (
    select * from base
    union all
    select * from perfect
  )
  select e.event_key, e.roster_name, e.business_date, e.shift, e.kind, e.reason, e.minutes, e.notice_min, e.reported, e.base_points,
         case when coalesce(o.excluded, false) then 0 else coalesce(o.points, e.base_points) end,
         coalesce(o.excluded, false), o.note
  from everything e
  cross join me
  left join public.attendance_overrides o on o.event_key = e.event_key
  where (me.mgr or e.roster_name = me.name)
    and e.roster_name not in (select roster_name from test_names)
  order by e.business_date, e.roster_name
$$;

revoke execute on function public.attendance_events(date, date) from anon, public;
grant execute on function public.attendance_events(date, date) to authenticated;
