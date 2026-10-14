-- 休み・遅刻・早退の連絡 and 代わり募集 (owner chose plan ②, 2026-10-14).
--   Staff report one of their own shifts: 休む (absence) / 遅れる (late, minutes) / 早退する (early_leave, time).
--   Absence / early leave may ask for a replacement (recruit); other staff without an overlapping shift see it
--   and tap 「代われます」 (offer), optionally giving one of their own shifts back (交換, when swap_ok).
--   A manager approves with an offer, with any person (after a phone call) or without a replacement, or rejects.
--   Approval changes shift_assignments at once; approved changes are re-applied after a re-import of the
--   month (import_shift_month), so the workbook never wipes them out.
--   Reasons stay between the reporter and the managers: other staff see only the shift and the name.

-- 週の上限時間 per shift-table name. Managers only (staff never read their visa).
-- visa = 留学 (student) / 家族滞在 (dependent): 資格外活動 = at most 28 h in any 7 days in a row.
create table public.staff_limits (
  roster_name text primary key,
  id uuid not null default gen_random_uuid() unique,
  visa text check (visa in ('student', 'dependent')),
  weekly_limit_min int check (weekly_limit_min between 60 and 10080),
  note text check (char_length(note) <= 200),
  updated_at timestamptz not null default now()
);
create trigger staff_limits_updated before update on public.staff_limits for each row execute function public.set_updated_at();
alter table public.staff_limits enable row level security;
revoke all on public.staff_limits from anon;
create policy staff_limits_manager on public.staff_limits for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

create table public.shift_changes (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('absence', 'late', 'early_leave')),
  roster_name text not null,
  requester_id uuid references public.profiles (id) on delete set null,
  -- the shift as scheduled when reported
  business_date date not null,
  shift text not null check (shift in ('early', 'middle', 'late')),
  store_id uuid references public.stores (id),
  store_mark text not null,
  start_min int not null,
  end_min int not null,
  late_min int check (late_min between 1 and 600),
  -- 早退: minute (from 00:00 of the business date) of leaving
  leave_min int,
  reason text not null check (reason in ('sick', 'family', 'transport', 'personal', 'paid_leave', 'store', 'other')),
  note text check (char_length(note) <= 500),
  note_original text,
  source_lang text,
  recruit boolean not null default false,
  swap_ok boolean not null default false,
  reported_at timestamptz not null default now(),
  -- minutes between the report and the shift start (negative = reported after the start)
  notice_min int not null,
  status text not null default 'open' check (status in ('open', 'approved', 'rejected', 'cancelled')),
  cover_name text,
  cover_offer_id uuid,
  -- 交換: the cover's shift given to the reporter
  give_date date,
  give_shift text check (give_shift in ('early', 'middle', 'late')),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  manager_note text check (char_length(manager_note) <= 500),
  -- recorded by a manager for the staff member (e.g. a phone call)
  by_manager boolean not null default false,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'late') = (late_min is not null)),
  check ((kind = 'early_leave') = (leave_min is not null))
);
create trigger shift_changes_updated before update on public.shift_changes for each row execute function public.set_updated_at();
create unique index shift_changes_one_active on public.shift_changes (roster_name, business_date, shift) where status in ('open', 'approved');
create index shift_changes_date on public.shift_changes (business_date);

create table public.shift_offers (
  id uuid primary key default gen_random_uuid(),
  change_id uuid not null references public.shift_changes (id) on delete cascade,
  roster_name text not null,
  user_id uuid references public.profiles (id) on delete set null,
  give_date date,
  give_shift text check (give_shift in ('early', 'middle', 'late')),
  note text check (char_length(note) <= 300),
  status text not null default 'offered' check (status in ('offered', 'accepted', 'declined', 'withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (change_id, roster_name),
  check ((give_date is null) = (give_shift is null))
);
create trigger shift_offers_updated before update on public.shift_offers for each row execute function public.set_updated_at();

alter table public.shift_changes enable row level security;
alter table public.shift_offers enable row level security;
revoke all on public.shift_changes, public.shift_offers from anon;
-- writes only through the functions below
create policy shift_changes_select on public.shift_changes for select to authenticated
  using (public.is_manager() or (public.is_active() and (requester_id = auth.uid() or roster_name = public.my_roster_name())));
create policy shift_offers_select on public.shift_offers for select to authenticated
  using (public.is_manager() or (public.is_active() and (roster_name = public.my_roster_name()
    or exists (select 1 from public.shift_changes c where c.id = change_id and c.roster_name = public.my_roster_name()))));

/** Tokyo wall time of a shift minute → timestamptz. */
create function public.shift_at(p_date date, p_min int) returns timestamptz
language sql stable set search_path = ''
as $$ select (p_date::timestamp + make_interval(mins => p_min)) at time zone 'Asia/Tokyo' $$;

/** Does the person work at any time during [from, to) of that business date? */
create function public.works_during(p_name text, p_date date, p_from int, p_to int) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.shift_assignments a
    where a.roster_name = p_name and a.business_date between p_date - 1 and p_date + 1
      and tstzrange(public.shift_at(a.business_date, a.start_min), public.shift_at(a.business_date, a.end_min))
          && tstzrange(public.shift_at(p_date, p_from), public.shift_at(p_date, p_to)))
$$;
revoke execute on function public.works_during(text, date, int, int) from public, anon, authenticated;

-- ---- report / cancel

create function public.report_shift_change(
  p_kind text, p_date date, p_shift text, p_reason text,
  p_note text default null, p_note_original text default null, p_source_lang text default null,
  p_late_min int default null, p_leave_min int default null,
  p_recruit boolean default false, p_swap_ok boolean default false,
  p_roster_name text default null, p_reported_at timestamptz default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  mgr boolean := public.is_manager();
  mine text := public.my_roster_name();
  who text := coalesce(p_roster_name, mine);
  a public.shift_assignments;
  rep_at timestamptz := now();
  notice int;
  new_id uuid;
begin
  if not public.is_active() then
    raise exception 'not active' using errcode = '42501';
  end if;
  if who is distinct from mine and not mgr then
    raise exception 'managers only' using errcode = '42501';
  end if;
  if who is null then
    raise exception 'no shift-table name' using errcode = '22023';
  end if;
  if p_reported_at is not null then
    if not mgr then
      raise exception 'managers only' using errcode = '42501';
    end if;
    rep_at := least(p_reported_at, now());
  end if;
  if p_kind not in ('absence', 'late', 'early_leave') or p_reason not in ('sick', 'family', 'transport', 'personal', 'paid_leave', 'store', 'other') then
    raise exception 'bad kind or reason' using errcode = '22023';
  end if;
  if p_reason = 'store' and not mgr then
    raise exception 'managers only' using errcode = '42501';
  end if;
  if p_reason = 'paid_leave' and p_kind <> 'absence' then
    raise exception 'paid leave is for absences' using errcode = '22023';
  end if;
  if p_reason = 'other' and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'note required' using errcode = '22023';
  end if;
  select * into a from public.shift_assignments where roster_name = who and business_date = p_date and shift = p_shift;
  if not found then
    raise exception 'no such shift' using errcode = '22023';
  end if;
  if not mgr and public.shift_at(p_date, a.end_min) <= now() then
    raise exception 'the shift is over' using errcode = '22023';
  end if;
  if p_kind = 'late' and (p_late_min is null or p_late_min not between 1 and least(600, a.end_min - a.start_min - 1)) then
    raise exception 'bad late minutes' using errcode = '22023';
  end if;
  if p_kind = 'early_leave' and (p_leave_min is null or p_leave_min <= a.start_min or p_leave_min >= a.end_min) then
    raise exception 'bad leave time' using errcode = '22023';
  end if;
  notice := floor(extract(epoch from (public.shift_at(p_date, a.start_min) - rep_at)) / 60);
  insert into public.shift_changes (kind, roster_name, requester_id, business_date, shift, store_id, store_mark, start_min, end_min,
                                    late_min, leave_min, reason, note, note_original, source_lang, recruit, swap_ok,
                                    reported_at, notice_min, by_manager, is_test)
  values (p_kind, who, auth.uid(), p_date, p_shift, a.store_id, a.store_mark, a.start_min, a.end_min,
          case when p_kind = 'late' then p_late_min end, case when p_kind = 'early_leave' then p_leave_min end,
          p_reason, nullif(btrim(coalesce(p_note, '')), ''), p_note_original, p_source_lang,
          p_kind <> 'late' and p_recruit, p_kind = 'absence' and p_recruit and p_swap_ok,
          rep_at, notice, who is distinct from mine, public.is_test_profile(auth.uid()))
  returning id into new_id;
  -- urgent (at once to every recipient) when the shift starts within 24 hours
  perform public.add_notify_event('shift_change', 'shift_changes', new_id, notice < 1440, jsonb_build_object('event', 'report'));
  return new_id;
end $$;

create function public.cancel_shift_change(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  c public.shift_changes;
begin
  select * into c from public.shift_changes where id = p_id for update;
  if not found or c.status <> 'open'
     or not (public.is_manager() or (public.is_active() and (c.requester_id = auth.uid() or c.roster_name = public.my_roster_name()))) then
    raise exception 'cannot cancel' using errcode = '42501';
  end if;
  update public.shift_changes set status = 'cancelled', decided_at = now(), decided_by = auth.uid() where id = p_id;
  update public.shift_offers set status = 'declined' where change_id = p_id and status = 'offered';
end $$;

-- ---- 代わり募集

/**
 * For the caller: open recruits they could take (no overlapping shift, not their own, not over yet),
 * plus every change they offered on or were chosen for (from yesterday on). No reasons.
 */
create function public.shift_recruits()
returns table (id uuid, kind text, status text, roster_name text, business_date date, shift text, store_mark text,
               start_min int, end_min int, swap_ok boolean, offers int,
               my_offer_id uuid, my_offer_status text, my_give_date date, my_give_shift text, assigned boolean)
language sql stable security definer set search_path = ''
as $$
  with me as (select public.my_roster_name() as name where public.is_active())
  select c.id, c.kind, c.status, c.roster_name, c.business_date, c.shift, c.store_mark,
         case when c.kind = 'early_leave' then c.leave_min else c.start_min end, c.end_min, c.swap_ok,
         (select count(*)::int from public.shift_offers x where x.change_id = c.id and x.status = 'offered'),
         o.id, o.status, o.give_date, o.give_shift, c.cover_name = me.name
  from public.shift_changes c
  cross join me
  left join public.shift_offers o on o.change_id = c.id and o.roster_name = me.name
  where me.name is not null and not c.is_test and c.roster_name <> me.name
    and ((c.status = 'open' and c.recruit
          and public.shift_at(c.business_date, c.end_min) > now()
          and not public.works_during(me.name, c.business_date, case when c.kind = 'early_leave' then c.leave_min else c.start_min end, c.end_min))
         or ((o.id is not null or c.cover_name = me.name) and c.business_date >= (now() at time zone 'Asia/Tokyo')::date - 1))
  order by c.business_date, c.start_min
$$;

create function public.offer_shift_cover(p_change uuid, p_give_date date default null, p_give_shift text default null, p_note text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me text := public.my_roster_name();
  c public.shift_changes;
  g public.shift_assignments;
  oid uuid;
begin
  if not public.is_active() or me is null then
    raise exception 'no shift-table name' using errcode = '42501';
  end if;
  select * into c from public.shift_changes where id = p_change;
  if not found or c.status <> 'open' or not c.recruit or c.roster_name = me or c.is_test then
    raise exception 'not open' using errcode = '22023';
  end if;
  if public.works_during(me, c.business_date, case when c.kind = 'early_leave' then c.leave_min else c.start_min end, c.end_min) then
    raise exception 'you work at that time' using errcode = '22023';
  end if;
  if p_give_date is not null then
    if not c.swap_ok then
      raise exception 'no swap' using errcode = '22023';
    end if;
    select * into g from public.shift_assignments where roster_name = me and business_date = p_give_date and shift = p_give_shift;
    if not found or public.shift_at(p_give_date, g.start_min) <= now() then
      raise exception 'no such shift' using errcode = '22023';
    end if;
    if public.works_during(c.roster_name, p_give_date, g.start_min, g.end_min) then
      raise exception 'they work at that time' using errcode = '22023';
    end if;
  end if;
  insert into public.shift_offers (change_id, roster_name, user_id, give_date, give_shift, note)
  values (p_change, me, auth.uid(), p_give_date, case when p_give_date is null then null else p_give_shift end, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (change_id, roster_name) do update
    set status = 'offered', give_date = excluded.give_date, give_shift = excluded.give_shift, note = excluded.note, user_id = excluded.user_id
  returning id into oid;
  perform public.add_notify_event('shift_change', 'shift_changes', p_change, false, jsonb_build_object('event', 'offer', 'offer', oid));
  return oid;
end $$;

create function public.withdraw_shift_offer(p_offer uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.shift_offers set status = 'withdrawn'
  where id = p_offer and status = 'offered' and roster_name = public.my_roster_name() and public.is_active();
  if not found then
    raise exception 'cannot withdraw' using errcode = '42501';
  end if;
end $$;

-- ---- approval

/** Applies an approved change to shift_assignments; safe to run again (after a re-import). */
create function public.apply_shift_change(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  c public.shift_changes;
begin
  select * into c from public.shift_changes where id = p_id and status = 'approved';
  if not found then
    return;
  end if;
  if c.kind = 'absence' then
    if c.cover_name is not null then
      update public.shift_assignments set roster_name = c.cover_name
      where business_date = c.business_date and shift = c.shift and roster_name = c.roster_name
        and not exists (select 1 from public.shift_assignments x where x.business_date = c.business_date and x.shift = c.shift and x.roster_name = c.cover_name);
      if c.give_date is not null then
        update public.shift_assignments set roster_name = c.roster_name
        where business_date = c.give_date and shift = c.give_shift and roster_name = c.cover_name
          and not exists (select 1 from public.shift_assignments x where x.business_date = c.give_date and x.shift = c.give_shift and x.roster_name = c.roster_name);
      end if;
    else
      delete from public.shift_assignments where business_date = c.business_date and shift = c.shift and roster_name = c.roster_name;
    end if;
  elsif c.kind = 'early_leave' then
    update public.shift_assignments set end_min = c.leave_min, original_end_min = null
    where business_date = c.business_date and shift = c.shift and roster_name = c.roster_name and end_min > c.leave_min and start_min < c.leave_min;
    if c.cover_name is not null then
      insert into public.shift_assignments (month, business_date, shift, roster_name, store_mark, store_id, start_min, end_min, raw)
      values (date_trunc('month', c.business_date)::date, c.business_date, c.shift, c.cover_name, c.store_mark, c.store_id, c.leave_min, c.end_min, '代わり')
      on conflict (business_date, shift, roster_name) do nothing;
    end if;
  end if;
end $$;
revoke execute on function public.apply_shift_change(uuid) from public, anon, authenticated;

/**
 * Managers: approve (with an offer, with a person chosen by the manager, or without a replacement)
 * or reject. A late report has no replacement (approve = 確認).
 */
create function public.decide_shift_change(p_id uuid, p_approve boolean, p_offer uuid default null, p_cover text default null, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  c public.shift_changes;
  o public.shift_offers;
  cover text := nullif(btrim(coalesce(p_cover, '')), '');
begin
  if not public.is_manager() then
    raise exception 'managers only' using errcode = '42501';
  end if;
  select * into c from public.shift_changes where id = p_id for update;
  if not found or c.status <> 'open' then
    raise exception 'not open' using errcode = '22023';
  end if;
  if not p_approve then
    update public.shift_changes set status = 'rejected', decided_by = auth.uid(), decided_at = now(), manager_note = nullif(btrim(coalesce(p_note, '')), '') where id = p_id;
    update public.shift_offers set status = 'declined' where change_id = p_id and status = 'offered';
    return;
  end if;
  if p_offer is not null then
    select * into o from public.shift_offers where id = p_offer and change_id = p_id and status = 'offered';
    if not found then
      raise exception 'no such offer' using errcode = '22023';
    end if;
    cover := o.roster_name;
  end if;
  if cover is not null then
    if c.kind = 'late' then
      raise exception 'no replacement for a late report' using errcode = '22023';
    end if;
    if cover = c.roster_name or exists (select 1 from public.shift_assignments x where x.business_date = c.business_date and x.shift = c.shift and x.roster_name = cover) then
      raise exception 'already works that shift' using errcode = '22023';
    end if;
  end if;
  update public.shift_changes
  set status = 'approved', decided_by = auth.uid(), decided_at = now(), manager_note = nullif(btrim(coalesce(p_note, '')), ''),
      cover_name = cover, cover_offer_id = o.id, give_date = o.give_date, give_shift = o.give_shift
  where id = p_id;
  update public.shift_offers set status = case when id = o.id then 'accepted' else 'declined' end where change_id = p_id and status = 'offered';
  perform public.apply_shift_change(p_id);
  perform public.check_visa_hours();
end $$;

-- ---- re-import keeps approved changes

create or replace function public.import_shift_month(p_month date, p_rows jsonb)
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
  -- 休み・代わり already approved for this month
  perform public.apply_shift_change(c.id)
  from public.shift_changes c
  where c.status = 'approved'
    and (date_trunc('month', c.business_date)::date = p_month or date_trunc('month', c.give_date)::date = p_month)
  order by c.decided_at;
  perform public.check_visa_hours();
  return n;
end $$;

revoke execute on function public.report_shift_change(text, date, text, text, text, text, text, int, int, boolean, boolean, text, timestamptz) from anon, public;
grant execute on function public.report_shift_change(text, date, text, text, text, text, text, int, int, boolean, boolean, text, timestamptz) to authenticated;
revoke execute on function public.cancel_shift_change(uuid) from anon, public;
grant execute on function public.cancel_shift_change(uuid) to authenticated;
revoke execute on function public.shift_recruits() from anon, public;
grant execute on function public.shift_recruits() to authenticated;
revoke execute on function public.offer_shift_cover(uuid, date, text, text) from anon, public;
grant execute on function public.offer_shift_cover(uuid, date, text, text) to authenticated;
revoke execute on function public.withdraw_shift_offer(uuid) from anon, public;
grant execute on function public.withdraw_shift_offer(uuid) to authenticated;
revoke execute on function public.decide_shift_change(uuid, boolean, uuid, text, text) from anon, public;
grant execute on function public.decide_shift_change(uuid, boolean, uuid, text, text) to authenticated;

-- notifications: kind 'shift_change' (on for every current recipient)
alter table public.notify_events drop constraint if exists notify_events_kind_check;
alter table public.notify_events add constraint notify_events_kind_check
  check (kind in ('chorei', 'chorei_note', 'patrol', 'shift_request', 'signup', 'edit', 'staff_alert', 'stock', 'sales', 'shift_change', 'visa_hours'));
alter table public.notify_recipients drop constraint if exists notify_recipients_kinds_check;
alter table public.notify_recipients add constraint notify_recipients_kinds_check
  check (kinds <@ array['chorei', 'chorei_note', 'patrol', 'shift_request', 'signup', 'edit', 'staff_alert', 'stock', 'sales', 'shift_change', 'visa_hours']);
alter table public.notify_recipients alter column kinds
  set default array['chorei', 'chorei_note', 'patrol', 'shift_request', 'signup', 'edit', 'staff_alert', 'stock', 'sales', 'shift_change', 'visa_hours'];
update public.notify_recipients set kinds = kinds || array['shift_change'] where not ('shift_change' = any(kinds));
update public.notify_recipients set kinds = kinds || array['visa_hours'] where not ('visa_hours' = any(kinds));

-- ---- 留学 / 家族滞在: 28 hours in any 7 days in a row (2026-10-15, owner)

/** Minutes worked in each 7-day window [from, from + 6] (by shift date) of the people with a visa set. */
create function public.visa_hour_windows(p_from date, p_to date)
returns table (roster_name text, visa text, window_from date, window_to date, minutes int)
language sql stable security definer set search_path = ''
as $$
  select l.roster_name, l.visa, d::date, d::date + 6,
    (select coalesce(sum(a.end_min - a.start_min), 0)::int from public.shift_assignments a
      where a.roster_name = l.roster_name and a.business_date between d::date and d::date + 6)
  from public.staff_limits l
  cross join generate_series(p_from, p_to, interval '1 day') d
  where l.visa is not null and (public.is_manager() or auth.uid() is null)
  order by l.roster_name, d
$$;
revoke execute on function public.visa_hour_windows(date, date) from anon, public;
grant execute on function public.visa_hour_windows(date, date) to authenticated;

/**
 * One urgent mail per run of windows over 28 h (from 6 days ago to 6 weeks ahead). A run already
 * mailed is carried forward (its key moves with the run), so it is not mailed again every day.
 * Runs after: a shift import, an approved 休み・代わり, a visa set, and every hour (pg_cron).
 */
create function public.check_visa_hours() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  n int := 0;
  today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  for r in
    with w as (select * from public.visa_hour_windows(today - 6, today + 42) where minutes > 1680),
    runs as (select w.*, w.window_from - (row_number() over (partition by w.roster_name order by w.window_from))::int as grp from w)
    select roster_name, visa, min(window_from) as run_from, max(window_to) as run_to, max(minutes) as max_min
    from runs group by roster_name, visa, grp
  loop
    if exists (select 1 from public.alert_log a
               where a.kind = 'visa_hours' and split_part(a.key, '|', 2) = r.roster_name
                 and split_part(a.key, '|', 3)::date between r.run_from - 1 and r.run_to) then
      insert into public.alert_log (kind, key) values ('visa_hours', format('visa28|%s|%s', r.roster_name, r.run_from)) on conflict (key) do nothing;
      continue;
    end if;
    insert into public.alert_log (kind, key) values ('visa_hours', format('visa28|%s|%s', r.roster_name, r.run_from)) on conflict (key) do nothing;
    perform public.add_notify_event('visa_hours', 'staff_limits', (select l.id from public.staff_limits l where l.roster_name = r.roster_name), true,
      jsonb_build_object('roster_name', r.roster_name, 'visa', r.visa, 'from', r.run_from, 'to', r.run_to, 'minutes', r.max_min));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.check_visa_hours() from public, anon, authenticated;

create function public.staff_limits_check() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.visa is not null then
    perform public.check_visa_hours();
  end if;
  return new;
end $$;
create trigger staff_limits_visa after insert or update of visa on public.staff_limits
  for each row execute function public.staff_limits_check();

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('check-visa-hours', '7 * * * *', 'select public.check_visa_hours()');
  end if;
end $$;
