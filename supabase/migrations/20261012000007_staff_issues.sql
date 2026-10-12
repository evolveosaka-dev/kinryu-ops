-- スタッフ別の改善点と面談指導.
--  * patrol_checks.issue_tags: who each 改善点 is about and which kind ([{staff, category}]); chosen by the
--    patroller (AI suggests, the patroller confirms), correctable by managers. [] = 全体・特定の人ではない,
--    null = sent before this existed.
--  * staff_interviews: 面談指導 records written by managers.
--  * staff_issue_status(): per person × kind — before any 面談: 3 times in 30 days → 'interview' (面談が必要);
--    after a 面談: 3 times since the last one → 'escalate' (対応策の検討, step = number of 面談 so far).
--  * Reaching a level sends one urgent 'staff_alert' mail (alert_log keeps it to once per level).

create or replace function public.valid_issue_tags(t jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select t is null or (
    jsonb_typeof(t) = 'array' and jsonb_array_length(t) <= 30
    and not exists (
      select 1 from jsonb_array_elements(t) e
      where jsonb_typeof(e) <> 'object'
         or coalesce(char_length(btrim(e ->> 'staff')), 0) not between 1 and 40
         or coalesce(e ->> 'category', '') not in ('smile', 'voice', 'grooming', 'clean', 'quality', 'other')))
$$;

alter table public.patrol_checks add column issue_tags jsonb check (public.valid_issue_tags(issue_tags));

create table public.staff_interviews (
  id uuid primary key default gen_random_uuid(),
  staff_name text not null check (char_length(btrim(staff_name)) between 1 and 40),
  category text not null check (category in ('smile', 'voice', 'grooming', 'clean', 'quality', 'other')),
  held_on date not null,
  interviewer_id uuid not null default auth.uid() references public.profiles (id),
  -- kept with the row (as in chorei_comments)
  interviewer_name text not null default '',
  note text not null default '' check (char_length(note) <= 2000),
  -- 対応策 taken (the suggested step or the manager's own words)
  measure text not null default '' check (char_length(measure) <= 1000),
  created_at timestamptz not null default now()
);
create index staff_interviews_staff on public.staff_interviews (staff_name, category, held_on);

alter table public.staff_interviews enable row level security;
create policy staff_interviews_select on public.staff_interviews for select to authenticated using (public.is_manager());
create policy staff_interviews_insert on public.staff_interviews for insert to authenticated
  with check (public.is_manager() and interviewer_id = auth.uid());
create policy staff_interviews_update on public.staff_interviews for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
create policy staff_interviews_delete on public.staff_interviews for delete to authenticated using (public.is_manager());
grant select, insert, update, delete on public.staff_interviews to authenticated;
revoke all on public.staff_interviews from anon;

create or replace function public.set_interviewer_name() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.interviewer_id is distinct from old.interviewer_id then
    new.interviewer_name := coalesce((select coalesce(nullif(p.full_name, ''), p.display_name, '') from public.profiles p where p.id = new.interviewer_id), '');
  end if;
  return new;
end $$;
create trigger staff_interviews_name before insert or update on public.staff_interviews
  for each row execute function public.set_interviewer_name();
-- test accounts (read-only managers) cannot write 面談記録 (no owner column → always refused)
create trigger test_account_read_only before insert or update or delete on public.staff_interviews
  for each row execute function public.guard_test_account_writes();

-- Per person × kind. Only valid, non-test patrols count; a 面談 on day D counts patrols after D.
create or replace function public.staff_issue_status(p_staff text default null)
returns table (staff text, category text, interviews int, last_interview date, occurrences int, last_seen date, level text)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  today date := public.tokyo_today();
begin
  if not public.is_manager() then
    raise exception 'managers only' using errcode = '42501';
  end if;
  return query
  with tags as (
    select btrim(e ->> 'staff') as staff, e ->> 'category' as category, c.business_date as d
    from public.patrol_checks c, jsonb_array_elements(c.issue_tags) e
    where c.status = 'valid' and not c.is_test and c.issue_tags is not null
      and (p_staff is null or btrim(e ->> 'staff') = p_staff)
  ),
  iv as (
    select i.staff_name as staff, i.category, count(*)::int as n, max(i.held_on) as last
    from public.staff_interviews i
    where p_staff is null or i.staff_name = p_staff
    group by 1, 2
  ),
  counted as (
    select t.staff, t.category, coalesce(iv.n, 0) as n, iv.last,
           count(*) filter (where case when iv.last is null then t.d > today - 30 else t.d > iv.last end)::int as occ,
           max(t.d) as last_seen
    from tags t left join iv on iv.staff = t.staff and iv.category = t.category
    group by t.staff, t.category, iv.n, iv.last
  )
  select c.staff, c.category, c.n, c.last, c.occ, c.last_seen,
         case when c.occ >= 3 and c.n = 0 then 'interview' when c.occ >= 3 then 'escalate' end
  from counted c
  union all
  -- people with 面談 but no tags left in the data still show their history
  select iv.staff, iv.category, iv.n, iv.last, 0, null::date, null::text
  from iv where not exists (select 1 from tags t where t.staff = iv.staff and t.category = iv.category);
end $$;
revoke execute on function public.staff_issue_status(text) from public, anon;
grant execute on function public.staff_issue_status(text) to authenticated;

-- notifications: new kind 'staff_alert' (on for every current recipient)
alter table public.notify_events drop constraint if exists notify_events_kind_check;
alter table public.notify_events add constraint notify_events_kind_check
  check (kind in ('chorei', 'chorei_note', 'patrol', 'shift_request', 'signup', 'edit', 'staff_alert'));
alter table public.notify_recipients drop constraint if exists notify_recipients_kinds_check;
alter table public.notify_recipients add constraint notify_recipients_kinds_check
  check (kinds <@ array['chorei', 'chorei_note', 'patrol', 'shift_request', 'signup', 'edit', 'staff_alert']);
alter table public.notify_recipients alter column kinds
  set default array['chorei', 'chorei_note', 'patrol', 'shift_request', 'signup', 'edit', 'staff_alert'];
update public.notify_recipients set kinds = kinds || array['staff_alert'] where not ('staff_alert' = any(kinds));

-- issue_tags corrections are not worth an 修正 mail
create or replace function public.notify_changes(o jsonb, n jsonb) returns jsonb
language sql immutable set search_path = ''
as $$
  select coalesce(jsonb_object_agg(k, jsonb_build_object('old', o -> k, 'new', n -> k)), '{}')
  from jsonb_object_keys(n) k
  where k not in ('updated_at', 'total', 'max_total', 'judgement', 'duration_min', 'issue_tags')
    and (o -> k) is distinct from (n -> k)
$$;

-- When a patrol becomes valid (or its tags change), check the people it names.
create or replace function public.notify_staff_issues() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  s record;
  inserted int;
begin
  if new.is_test or new.by_test_account or new.status <> 'valid' or new.issue_tags is null
     or jsonb_array_length(new.issue_tags) = 0 then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'valid' and old.issue_tags is not distinct from new.issue_tags then
    return new;
  end if;
  for s in
    with mine as (
      select distinct btrim(e ->> 'staff') as staff, e ->> 'category' as category from jsonb_array_elements(new.issue_tags) e
    ),
    tags as (
      select btrim(e ->> 'staff') as staff, e ->> 'category' as category, c.business_date as d
      from public.patrol_checks c, jsonb_array_elements(c.issue_tags) e
      where c.status = 'valid' and not c.is_test and c.issue_tags is not null
    ),
    iv as (
      select i.staff_name as staff, i.category, count(*)::int as n, max(i.held_on) as last
      from public.staff_interviews i group by 1, 2
    )
    select m.staff, m.category, coalesce(iv.n, 0) as n, iv.last,
           (select count(*) from tags t where t.staff = m.staff and t.category = m.category
              and case when iv.last is null then t.d > public.tokyo_today() - 30 else t.d > iv.last end)::int as occ
    from mine m left join iv on iv.staff = m.staff and iv.category = m.category
  loop
    continue when s.occ < 3;
    insert into public.alert_log (kind, key)
    values ('staff_issue', format('staff_issue:%s:%s:%s', s.staff, s.category, s.n))
    on conflict (key) do nothing;
    get diagnostics inserted = row_count;
    if inserted > 0 then
      perform public.add_notify_event('staff_alert', 'patrol_checks', new.id, true, jsonb_build_object(
        'staff', s.staff, 'category', s.category, 'interviews', s.n, 'last_interview', s.last,
        'occurrences', s.occ, 'level', case when s.n = 0 then 'interview' else 'escalate' end));
    end if;
  end loop;
  return new;
end $$;
create trigger patrol_staff_issues after insert or update on public.patrol_checks
  for each row execute function public.notify_staff_issues();
