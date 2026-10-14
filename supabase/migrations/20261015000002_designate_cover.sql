-- 代わりの人を指名 (owner, 2026-10-15): a staff member who already found someone names them when reporting;
-- a manager still approves. The 28-hour rule of 留学 / 家族滞在 (any 7 days in a row) now blocks everywhere
-- a person takes a shift: naming (checked live in the form with check_cover), 「代われます」, a swap (the
-- reporter receiving the given shift) and the manager's approval. The error 'cover_problem:{json}' carries
-- problem (self / unknown / busy / visa / visa_other), name, minutes and the 7-day window for the app.

alter table public.shift_changes add column proposed_cover text;

/** 留学 / 家族滞在: the worst 7-day window around p_date if p_add minutes are added (and one shift dropped); null when fine. */
create function public.visa_over(p_name text, p_date date, p_add int, p_drop_date date default null, p_drop_shift text default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  best int := -1;
  best_from date;
  m int;
  f date;
begin
  if not exists (select 1 from public.staff_limits l where l.roster_name = p_name and l.visa is not null) then
    return null;
  end if;
  for k in 0..6 loop
    f := p_date - k;
    select coalesce(sum(a.end_min - a.start_min), 0)::int + coalesce(p_add, 0) into m
    from public.shift_assignments a
    where a.roster_name = p_name and a.business_date between f and f + 6
      and not (p_drop_date is not null and a.business_date = p_drop_date and a.shift = p_drop_shift);
    if m > best then
      best := m;
      best_from := f;
    end if;
  end loop;
  if best > 1680 then
    return jsonb_build_object('minutes', best, 'from', best_from, 'to', best_from + 6);
  end if;
  return null;
end $$;
revoke execute on function public.visa_over(text, date, int, date, text) from public, anon, authenticated;

/** Why p_name cannot replace p_requester for [p_from, p_to) of p_date; null when they can. */
create function public.cover_problem(p_name text, p_requester text, p_date date, p_from int, p_to int)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  over jsonb;
begin
  if p_name = p_requester then
    return jsonb_build_object('problem', 'self', 'name', p_name);
  end if;
  if not exists (select 1 from public.staff_roster r where r.name = p_name and r.active) then
    return jsonb_build_object('problem', 'unknown', 'name', p_name);
  end if;
  if public.works_during(p_name, p_date, p_from, p_to) then
    return jsonb_build_object('problem', 'busy', 'name', p_name);
  end if;
  over := public.visa_over(p_name, p_date, p_to - p_from);
  if over is not null then
    return over || jsonb_build_object('problem', 'visa', 'name', p_name);
  end if;
  return null;
end $$;
revoke execute on function public.cover_problem(text, text, date, int, int) from public, anon, authenticated;

/** For the report form: can p_name replace me on my shift? null = yes. */
create function public.check_cover(p_date date, p_shift text, p_kind text, p_leave_min int, p_name text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  me text := public.my_roster_name();
  a public.shift_assignments;
begin
  if not public.is_active() or me is null then
    raise exception 'no shift-table name' using errcode = '42501';
  end if;
  select * into a from public.shift_assignments where roster_name = me and business_date = p_date and shift = p_shift;
  if not found then
    raise exception 'no such shift' using errcode = '22023';
  end if;
  return public.cover_problem(btrim(p_name), me, p_date, case when p_kind = 'early_leave' and p_leave_min is not null then p_leave_min else a.start_min end, a.end_min);
end $$;
revoke execute on function public.check_cover(date, text, text, int, text) from anon, public;
grant execute on function public.check_cover(date, text, text, int, text) to authenticated;

drop function public.report_shift_change(text, date, text, text, text, text, text, int, int, boolean, boolean, text, timestamptz);
create function public.report_shift_change(
  p_kind text, p_date date, p_shift text, p_reason text,
  p_note text default null, p_note_original text default null, p_source_lang text default null,
  p_late_min int default null, p_leave_min int default null,
  p_recruit boolean default false, p_swap_ok boolean default false,
  p_roster_name text default null, p_reported_at timestamptz default null, p_cover text default null)
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
  cover text := nullif(btrim(coalesce(p_cover, '')), '');
  problem jsonb;
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
  if cover is not null then
    if p_kind = 'late' then
      raise exception 'no replacement for a late report' using errcode = '22023';
    end if;
    problem := public.cover_problem(cover, who, p_date, case when p_kind = 'early_leave' then p_leave_min else a.start_min end, a.end_min);
    if problem is not null then
      raise exception 'cover_problem:%', problem::text using errcode = '22023';
    end if;
  end if;
  notice := floor(extract(epoch from (public.shift_at(p_date, a.start_min) - rep_at)) / 60);
  insert into public.shift_changes (kind, roster_name, requester_id, business_date, shift, store_id, store_mark, start_min, end_min,
                                    late_min, leave_min, reason, note, note_original, source_lang, recruit, swap_ok, proposed_cover,
                                    reported_at, notice_min, by_manager, is_test)
  values (p_kind, who, auth.uid(), p_date, p_shift, a.store_id, a.store_mark, a.start_min, a.end_min,
          case when p_kind = 'late' then p_late_min end, case when p_kind = 'early_leave' then p_leave_min end,
          p_reason, nullif(btrim(coalesce(p_note, '')), ''), p_note_original, p_source_lang,
          p_kind <> 'late' and p_recruit and cover is null, p_kind = 'absence' and p_recruit and p_swap_ok and cover is null, cover,
          rep_at, notice, who is distinct from mine, public.is_test_profile(auth.uid()))
  returning id into new_id;
  -- urgent (at once to every recipient) when the shift starts within 24 hours
  perform public.add_notify_event('shift_change', 'shift_changes', new_id, notice < 1440, jsonb_build_object('event', 'report'));
  return new_id;
end $$;

revoke execute on function public.report_shift_change(text, date, text, text, text, text, text, int, int, boolean, boolean, text, timestamptz, text) from anon, public;
grant execute on function public.report_shift_change(text, date, text, text, text, text, text, int, int, boolean, boolean, text, timestamptz, text) to authenticated;

create or replace function public.offer_shift_cover(p_change uuid, p_give_date date default null, p_give_shift text default null, p_note text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me text := public.my_roster_name();
  c public.shift_changes;
  g public.shift_assignments;
  oid uuid;
  over jsonb;
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
  over := public.visa_over(me, c.business_date, c.end_min - case when c.kind = 'early_leave' then c.leave_min else c.start_min end, p_give_date, p_give_shift);
  if over is not null then
    raise exception 'cover_problem:%', (over || jsonb_build_object('problem', 'visa', 'name', me))::text using errcode = '22023';
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
    over := public.visa_over(c.roster_name, p_give_date, g.end_min - g.start_min, c.business_date, c.shift);
    if over is not null then
      raise exception 'cover_problem:%', (over || jsonb_build_object('problem', 'visa_other', 'name', c.roster_name))::text using errcode = '22023';
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

create or replace function public.decide_shift_change(p_id uuid, p_approve boolean, p_offer uuid default null, p_cover text default null, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  c public.shift_changes;
  o public.shift_offers;
  cover text := nullif(btrim(coalesce(p_cover, '')), '');
  over jsonb;
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
    -- 留学 / 家族滞在: 28 hours in any 7 days, also for the reporter receiving a swapped shift
    over := public.visa_over(cover, c.business_date, c.end_min - case when c.kind = 'early_leave' then c.leave_min else c.start_min end, o.give_date, o.give_shift);
    if over is not null then
      raise exception 'cover_problem:%', (over || jsonb_build_object('problem', 'visa', 'name', cover))::text using errcode = '22023';
    end if;
    if o.give_date is not null then
      over := public.visa_over(c.roster_name, o.give_date,
        (select g.end_min - g.start_min from public.shift_assignments g where g.roster_name = cover and g.business_date = o.give_date and g.shift = o.give_shift),
        c.business_date, c.shift);
      if over is not null then
        raise exception 'cover_problem:%', (over || jsonb_build_object('problem', 'visa_other', 'name', c.roster_name))::text using errcode = '22023';
      end if;
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

drop function public.shift_recruits();
create function public.shift_recruits()
returns table (id uuid, kind text, status text, roster_name text, business_date date, shift text, store_mark text,
               start_min int, end_min int, swap_ok boolean, offers int,
               my_offer_id uuid, my_offer_status text, my_give_date date, my_give_shift text, assigned boolean,
               designated boolean, my_over_min int)
language sql stable security definer set search_path = ''
as $$
  with me as (select public.my_roster_name() as name where public.is_active())
  select c.id, c.kind, c.status, c.roster_name, c.business_date, c.shift, c.store_mark,
         case when c.kind = 'early_leave' then c.leave_min else c.start_min end, c.end_min, c.swap_ok,
         (select count(*)::int from public.shift_offers x where x.change_id = c.id and x.status = 'offered'),
         o.id, o.status, o.give_date, o.give_shift, coalesce(c.cover_name = me.name, false),
         coalesce(c.proposed_cover = me.name, false),
         (public.visa_over(me.name, c.business_date, c.end_min - case when c.kind = 'early_leave' then c.leave_min else c.start_min end) ->> 'minutes')::int
  from public.shift_changes c
  cross join me
  left join public.shift_offers o on o.change_id = c.id and o.roster_name = me.name
  where me.name is not null and not c.is_test and c.roster_name <> me.name
    and ((c.status = 'open' and c.recruit
          and public.shift_at(c.business_date, c.end_min) > now()
          and not public.works_during(me.name, c.business_date, case when c.kind = 'early_leave' then c.leave_min else c.start_min end, c.end_min))
         or ((o.id is not null or c.cover_name = me.name or c.proposed_cover = me.name) and c.business_date >= (now() at time zone 'Asia/Tokyo')::date - 1))
  order by c.business_date, c.start_min
$$;
revoke execute on function public.shift_recruits() from anon, public;
grant execute on function public.shift_recruits() to authenticated;
