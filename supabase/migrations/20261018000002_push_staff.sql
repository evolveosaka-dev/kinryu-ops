-- Web push for staff, part 2 (owner, 2026-10-18):
--  * 指名 needs the named person's answer: cover_consent pending → accepted / declined (respond_cover_request);
--    a manager approves only after 引き受ける. Both answers are pushed to the reporter and the managers.
--  * シフトが変わりました: after a shift-table import (shift_import_log.changes, future dates; the source is not named)
--    and after an approval (the reporter and the cover, swaps included).
--  * 管理者のコメント on my 朝礼 / 巡回.
--  * シフト希望 not sent yet for next month: on the 15th, 18th and 20th (the deadline) at 12:00 JST.
--  * クレーム・事故 / 忘れ物: every step, assignment and comment goes to the staff involved (reporter, assignee,
--    the injured staff member / the reporter and whoever recorded the return), except the one who did it.

alter table public.push_queue drop constraint if exists push_queue_kind_check;
alter table public.push_queue add constraint push_queue_kind_check check (kind in (
  'test', 'recruit', 'named', 'decided', 'assigned', 'upload', 'mgr_change', 'mgr_incident', 'mgr_signup',
  'consent', 'schedule', 'comment', 'shift_request', 'inc_step', 'lost_step'));

-- ---- 指名: the named person answers

alter table public.shift_changes
  add column if not exists cover_consent text check (cover_consent in ('pending', 'accepted', 'declined')),
  add column if not exists cover_consent_at timestamptz,
  add column if not exists cover_consent_note text check (char_length(cover_consent_note) <= 300);

create function public.shift_change_consent_default() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.proposed_cover is not null then
    new.cover_consent := 'pending';
  end if;
  return new;
end $$;
create trigger shift_changes_consent before insert on public.shift_changes
  for each row execute function public.shift_change_consent_default();

/** The named person: 引き受ける (checked again: busy / 28 hours) or 断る. */
create function public.respond_cover_request(p_change uuid, p_accept boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me text := public.my_roster_name();
  c public.shift_changes;
  problem jsonb;
begin
  if not public.is_active() or me is null then
    raise exception 'no shift-table name' using errcode = '42501';
  end if;
  select * into c from public.shift_changes where id = p_change for update;
  if not found or c.proposed_cover is distinct from me then
    raise exception 'not named' using errcode = '42501';
  end if;
  if c.status <> 'open' or c.cover_consent is distinct from 'pending' then
    raise exception 'already answered' using errcode = '22023';
  end if;
  if p_accept then
    problem := public.cover_problem(me, c.roster_name, c.business_date, case when c.kind = 'early_leave' then c.leave_min else c.start_min end, c.end_min);
    if problem is not null then
      raise exception 'cover_problem:%', problem::text using errcode = '22023';
    end if;
  end if;
  update public.shift_changes
  set cover_consent = case when p_accept then 'accepted' else 'declined' end, cover_consent_at = now(),
      cover_consent_note = nullif(btrim(left(coalesce(p_note, ''), 300)), '')
  where id = p_change;
end $$;
revoke execute on function public.respond_cover_request(uuid, boolean, text) from anon, public;
grant execute on function public.respond_cover_request(uuid, boolean, text) to authenticated;

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
  -- 指名: the named person answers first (only rows reported after 2026-10-18 carry cover_consent)
  if p_approve and c.cover_consent = 'pending' then
    raise exception 'waiting for the named person' using errcode = '22023';
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
  if cover is not null and cover = c.proposed_cover and c.cover_consent = 'declined' then
    raise exception 'the named person declined' using errcode = '22023';
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
               designated boolean, my_over_min int, my_consent text)
language sql stable security definer set search_path = ''
as $$
  with me as (select public.my_roster_name() as name where public.is_active())
  select c.id, c.kind, c.status, c.roster_name, c.business_date, c.shift, c.store_mark,
         case when c.kind = 'early_leave' then c.leave_min else c.start_min end, c.end_min, c.swap_ok,
         (select count(*)::int from public.shift_offers x where x.change_id = c.id and x.status = 'offered'),
         o.id, o.status, o.give_date, o.give_shift, coalesce(c.cover_name = me.name, false),
         coalesce(c.proposed_cover = me.name, false),
         (public.visa_over(me.name, c.business_date, c.end_min - case when c.kind = 'early_leave' then c.leave_min else c.start_min end) ->> 'minutes')::int,
         case when c.proposed_cover = me.name then c.cover_consent end
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

-- ---- push helpers

create function public.push_hm(m int) returns text
language sql immutable set search_path = ''
as $$ select ((m % 1440) / 60)::text || ':' || lpad((m % 60)::text, 2, '0') $$;
revoke execute on function public.push_hm(int) from public, anon, authenticated;

create or replace function public.change_push_data(c public.shift_changes) returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object('name', c.roster_name, 'kind', c.kind, 'date', c.business_date, 'shift', c.shift, 'store', c.store_mark,
    'from', case when c.kind = 'early_leave' then c.leave_min else c.start_min end, 'to', c.end_min, 'named', c.proposed_cover)
$$;

create function public.push_managers(p_kind text, p_data jsonb, p_url text, p_urgent boolean, p_key text, p_actor uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  m record;
begin
  for m in
    select p.id from public.profiles p
    where p.role in ('manager', 'admin') and p.status = 'active' and not p.is_test_account and p.id is distinct from p_actor
  loop
    perform public.queue_push(m.id, p_kind, p_data, p_url, p_urgent, p_key || '|' || m.id);
  end loop;
end $$;
revoke execute on function public.push_managers(text, jsonb, text, boolean, text, uuid) from public, anon, authenticated;

/** Staff: 代わり募集, 指名 and its answer, the decision, and the shift-table changes it makes. */
create or replace function public.push_on_shift_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  d jsonb := public.change_push_data(new);
  from_min int := case when new.kind = 'early_leave' then new.leave_min else new.start_min end;
  mine jsonb;
  theirs jsonb;
  g record;
  r record;
begin
  if new.is_test then
    return new;
  end if;
  if tg_op = 'INSERT' and new.status = 'open' and public.shift_at(new.business_date, new.end_min) > now() then
    if new.recruit then
      for r in
        select p.id from public.profiles p
        where p.status = 'active' and p.roster_name <> new.roster_name
          and exists (select 1 from public.push_subscriptions x where x.user_id = p.id)
          and not public.works_during(p.roster_name, new.business_date, from_min, new.end_min)
          and public.visa_over(p.roster_name, new.business_date, new.end_min - from_min) is null
      loop
        perform public.queue_push(r.id, 'recruit', d, '/absence?tab=recruit', public.shift_at(new.business_date, new.start_min) < now() + interval '24 hours',
                                  'recruit|' || new.id || '|' || r.id);
      end loop;
    end if;
    if new.proposed_cover is not null then
      perform public.queue_push(public.profile_of_roster(new.proposed_cover), 'named', d, '/absence?tab=recruit', true, 'named|' || new.id);
    end if;
  end if;
  -- the named person answered
  if tg_op = 'UPDATE' and old.cover_consent = 'pending' and new.cover_consent in ('accepted', 'declined') then
    d := d || jsonb_build_object('ok', new.cover_consent = 'accepted', 'cover', new.proposed_cover, 'note', new.cover_consent_note);
    perform public.queue_push(public.profile_of_roster(new.roster_name), 'consent', d, '/absence', true, 'consent|' || new.id);
    perform public.push_managers('mgr_change', d || jsonb_build_object('event', case when new.cover_consent = 'accepted' then 'accepted' else 'declined' end,
                                 'offer_name', new.proposed_cover), '/manager/attendance', true, 'consent|' || new.id, null);
  end if;
  if tg_op = 'UPDATE' and old.status = 'open' and new.status in ('approved', 'rejected') then
    perform public.queue_push(public.profile_of_roster(new.roster_name), 'decided', d || jsonb_build_object('ok', new.status = 'approved', 'cover', new.cover_name),
                              '/absence', false, 'decided|' || new.id);
    if new.status = 'approved' and new.cover_name is not null then
      perform public.queue_push(public.profile_of_roster(new.cover_name), 'assigned', d, '/schedule', true, 'assigned|' || new.id);
    end if;
    if new.status = 'approved' then
      -- シフトが変わりました: what the approval changes in the shift table
      mine := jsonb_build_array(jsonb_build_object('date', new.business_date, 'shift', new.shift,
        'kind', case when new.kind = 'absence' then 'removed' else 'changed' end,
        'detail', case new.kind when 'early_leave' then public.push_hm(new.start_min) || '–' || public.push_hm(new.leave_min)
                                when 'late' then public.push_hm(new.start_min + coalesce(new.late_min, 0)) || '–' || public.push_hm(new.end_min)
                                else '' end));
      theirs := '[]';
      if new.cover_name is not null then
        theirs := jsonb_build_array(jsonb_build_object('date', new.business_date, 'shift', new.shift, 'kind', 'added',
          'detail', public.push_hm(from_min) || '–' || public.push_hm(new.end_min)));
        if new.give_date is not null then
          select a.start_min, a.end_min into g from public.shift_assignments a
          where a.roster_name = new.cover_name and a.business_date = new.give_date and a.shift = new.give_shift;
          mine := mine || jsonb_build_array(jsonb_build_object('date', new.give_date, 'shift', new.give_shift, 'kind', 'added',
            'detail', case when g.start_min is null then '' else public.push_hm(g.start_min) || '–' || public.push_hm(g.end_min) end));
          theirs := theirs || jsonb_build_array(jsonb_build_object('date', new.give_date, 'shift', new.give_shift, 'kind', 'removed', 'detail', ''));
        end if;
        perform public.queue_push(public.profile_of_roster(new.cover_name), 'schedule', jsonb_build_object('n', jsonb_array_length(theirs), 'items', theirs),
                                  '/schedule', false, 'sched-c|' || new.id);
      end if;
      perform public.queue_push(public.profile_of_roster(new.roster_name), 'schedule', jsonb_build_object('n', jsonb_array_length(mine), 'items', mine),
                                '/schedule', false, 'sched-r|' || new.id);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists shift_changes_push on public.shift_changes;
create trigger shift_changes_push after insert or update of status, cover_consent on public.shift_changes
  for each row execute function public.push_on_shift_change();

-- 休み連絡 to managers: say when the named person has not answered yet
create or replace function public.push_on_notify_event() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  kind text;
  d jsonb;
  url text;
  c public.shift_changes;
begin
  if new.kind = 'shift_change' and new.data ->> 'event' in ('report', 'offer', 'reminder') then
    select * into c from public.shift_changes where id = new.ref_id;
    if not found or c.is_test then
      return new;
    end if;
    kind := 'mgr_change';
    d := public.change_push_data(c) || jsonb_build_object('event', new.data ->> 'event', 'hours', new.data -> 'hours', 'consent', c.cover_consent,
      'offer_name', (select o.roster_name from public.shift_offers o where o.id = (new.data ->> 'offer')::uuid));
    url := '/manager/attendance';
  elsif new.kind = 'incident' and new.data ->> 'event' in ('created', 'overdue') then
    kind := 'mgr_incident';
    d := jsonb_build_object('event', new.data ->> 'event', 'kind', (select i.kind from public.incidents i where i.id = new.ref_id));
    url := '/manager/incidents';
  elsif new.kind = 'signup' then
    kind := 'mgr_signup';
    d := '{}';
    url := '/manager/users';
  else
    return new;
  end if;
  perform public.push_managers(kind, d, url, new.urgent, 'ev|' || new.id, new.actor_id);
  return new;
end $$;

-- ---- シフトが変わりました after an import (the person's own future changes)

create function public.push_on_shift_import() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Tokyo')::date;
  r record;
begin
  for r in
    select c ->> 'name' as nm, count(*)::int as n,
           jsonb_agg(jsonb_build_object('date', c ->> 'date', 'shift', c ->> 'shift', 'kind', c ->> 'kind', 'detail', coalesce(c ->> 'after', ''))
                     order by c ->> 'date', array_position(array['early', 'middle', 'late'], c ->> 'shift')) as items
    from jsonb_array_elements(new.changes) c
    where (c ->> 'date')::date >= today
    group by 1
  loop
    perform public.queue_push(public.profile_of_roster(r.nm), 'schedule', jsonb_build_object('n', r.n, 'items', r.items), '/schedule', false,
                              'sched|' || new.id || '|' || r.nm);
  end loop;
  return new;
end $$;
create trigger shift_import_log_push after insert on public.shift_import_log
  for each row execute function public.push_on_shift_import();

-- ---- 管理者のコメント on my 朝礼 / 巡回

create function public.push_on_record_comment() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  owner uuid;
  d date;
  s text;
  test boolean;
  what text := case when tg_table_name = 'chorei_comments' then 'chorei' else 'patrol' end;
begin
  if what = 'chorei' then
    select c.leader_id, c.business_date, c.shift, c.is_test or c.by_test_account into owner, d, s, test from public.chorei_records c where c.id = new.chorei_id;
  else
    select c.patroller_id, c.business_date, c.shift, c.by_test_account into owner, d, s, test from public.patrol_checks c where c.id = new.patrol_id;
  end if;
  if owner is null or owner = new.author_id or coalesce(test, false) then
    return new;
  end if;
  perform public.queue_push(owner, 'comment', jsonb_build_object('what', what, 'date', d, 'shift', s, 'author', new.author_name, 'body', left(new.body, 120)),
                            case when what = 'chorei' then '/history' else '/history?tab=patrol' end, false, 'comment|' || new.id);
  return new;
end $$;
create trigger chorei_comments_push after insert on public.chorei_comments
  for each row execute function public.push_on_record_comment();
create trigger patrol_comments_push after insert on public.patrol_comments
  for each row execute function public.push_on_record_comment();

-- ---- シフト希望: not sent yet for next month (deadline = the 20th)

create function public.queue_shift_request_reminders() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Tokyo')::date;
  next_month date := (date_trunc('month', (now() at time zone 'Asia/Tokyo')::date) + interval '1 month')::date;
  n int := 0;
  r record;
begin
  if extract(day from today) not in (15, 18, 20) then
    return 0;
  end if;
  for r in
    select p.id from public.profiles p
    where p.status = 'active' and p.roster_name is not null and not p.is_test_account
      and not exists (select 1 from public.shift_requests q where q.user_id = p.id and q.month = next_month)
  loop
    perform public.queue_push(r.id, 'shift_request',
      jsonb_build_object('month', extract(month from next_month)::int, 'deadline', extract(month from today)::int || '/20', 'last', extract(day from today) = 20),
      '/shift-request', false, 'sreq|' || r.id || '|' || today);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.queue_shift_request_reminders() from public, anon, authenticated;

-- ---- クレーム・事故: steps, assignment and comments to the staff involved

create function public.push_on_incident_event() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  i public.incidents;
  r record;
begin
  if new.kind not in ('state', 'assign', 'comment') then
    return new;
  end if;
  select * into i from public.incidents where id = new.incident_id;
  if not found or i.by_test_account then
    return new;
  end if;
  for r in
    select distinct x.id from (values (i.reporter_id), (i.assignee_id), (public.profile_of_roster(i.injured_staff))) as x (id)
    where x.id is not null and x.id is distinct from new.actor_id
  loop
    perform public.queue_push(r.id, 'inc_step', jsonb_build_object('no', i.incident_no, 'kind', i.kind, 'event', new.kind, 'to', new.to_state,
      'actor', new.actor_name, 'body', left(new.body, 120), 'assignee', i.assignee_name, 'you', r.id = i.assignee_id),
      '/incident?tab=wf&open=' || i.id, new.kind = 'state' and i.priority = 'urgent', 'inc|' || new.id || '|' || r.id);
  end loop;
  return new;
end $$;
create trigger incident_events_push after insert on public.incident_events
  for each row execute function public.push_on_incident_event();

-- ---- 忘れ物: every step and comment to the finder (and whoever recorded the return)

create function public.push_on_lost_item_comment() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  li public.lost_items;
  r record;
begin
  if new.action = 'found' then
    return new;
  end if;
  select * into li from public.lost_items where id = new.lost_item_id;
  if not found or li.by_test_account then
    return new;
  end if;
  for r in
    select distinct x.id from (values (li.reporter_id), (li.outcome_by)) as x (id)
    where x.id is not null and x.id is distinct from new.author_id
  loop
    perform public.queue_push(r.id, 'lost_step', jsonb_build_object('desc', left(li.description, 40), 'action', new.action, 'actor', new.author_name,
      'body', left(new.body, 120)), '/lost-items?open=' || li.id, false, 'lost|' || new.id || '|' || r.id);
  end loop;
  return new;
end $$;
create trigger lost_item_comments_push after insert on public.lost_item_comments
  for each row execute function public.push_on_lost_item_comment();

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('push-shift-request-reminders', '0 3 * * *', 'select public.queue_shift_request_reminders()');
  end if;
end $$;
