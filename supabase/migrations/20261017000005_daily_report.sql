-- AI日報 (owner, 2026-10-16): every day at 7:30 JST a report of the previous business day (早番・中番・遅番 of
-- both stores) is made from the 朝礼 and 巡回 records: who led / joined each 朝礼, who patrolled whom, good points,
-- problems and whether they were coached (改善点・指導内容 + managers' comments), the day's 休み・遅刻・早退 and
-- クレーム・事故, and the cases from earlier days that are still open. Claude writes the summary and the proposals;
-- the report is stored in ai_reports (kind 'daily') and mailed to the recipients with the kind 'daily_report'.
-- Unlike the weekly / monthly report, names are used (the readers are the managers).

alter table public.ai_reports drop constraint if exists ai_reports_kind_check;
alter table public.ai_reports add constraint ai_reports_kind_check check (kind in ('daily', 'weekly', 'monthly'));

/** Everything of one business day for the AI日報 (managers, or the service role from the scheduled job). Test data left out. */
create or replace function public.daily_report_data(p_date date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  slots jsonb;
  open_cases jsonb;
begin
  if auth.uid() is not null and not public.is_manager() then
    raise exception 'managers only' using errcode = '42501';
  end if;

  with names as (
    select p.id, coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.display_name), ''), '?') as name from public.profiles p
  ), sl as (
    select st.id as store_id, st.name_ja as store, st.code, sh, array_position(array['early', 'middle', 'late'], sh) as ord
    from public.stores st cross join unnest(array['early', 'middle', 'late']) sh
    where st.active
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'store', sl.store,
    'shift', sl.sh,
    'bowls', (select sum(d.bowls) from public.daily_sales d where d.store_id = sl.store_id and d.business_date = p_date and d.shift = sl.sh),
    'target', (select r.target_bowls from public.sales_reports r where r.store_id = sl.store_id and r.business_date = p_date and r.shift = sl.sh
                 and r.status = 'submitted' and not r.by_test_account limit 1),
    'chorei', (select jsonb_build_object(
                 'leader', (select n.name from names n where n.id = c.leader_id),
                 'participants', (select coalesce(jsonb_agg(n.name), '[]') from names n where n.id = any(c.participants) and n.id <> c.leader_id)
                                 || coalesce(to_jsonb(c.participants_extra), '[]'),
                 'caution', c.caution_text,
                 'stock', case when c.stock_none then 'なし' else c.stock_text end,
                 'skip_reason', c.skip_reason,
                 'entered_by_manager', c.entered_by_manager,
                 'manager_note', c.manager_note,
                 'notes', (select coalesce(jsonb_agg(x.body order by x.created_at), '[]') from public.chorei_notes x where x.chorei_id = c.id),
                 'comments', (select coalesce(jsonb_agg(jsonb_build_object('by', m.author_name, 'body', m.body) order by m.created_at), '[]')
                              from public.chorei_comments m where m.chorei_id = c.id))
               from public.chorei_records c
               where c.store_id = sl.store_id and c.business_date = p_date and c.shift = sl.sh and c.status = 'valid' and not c.is_test and not c.by_test_account
               limit 1),
    'chorei_missed', (select jsonb_build_object('kind', m.kind, 'reason', m.reason, 'note', m.note)
                      from public.chorei_misses m
                      where m.store_id = sl.store_id and m.business_date = p_date and m.shift = sl.sh and not m.by_test_account limit 1),
    'patrols', (select coalesce(jsonb_agg(jsonb_build_object(
                  'patroller', (select n.name from names n where n.id = q.patroller_id),
                  'type', q.patrol_type,
                  'time', to_char(q.started_at at time zone 'Asia/Tokyo', 'HH24:MI'),
                  'staff', q.staff_names,
                  'score', q.total, 'max', q.max_total, 'judgement', q.judgement,
                  'items', jsonb_build_object('smile', q.score_smile, 'voice', q.score_voice, 'grooming', q.score_grooming, 'clean', q.score_clean, 'quality', q.score_quality),
                  'mask', q.mask_worn,
                  'good_points', q.good_points,
                  'improvements', q.improvements,
                  'remarks', q.remarks,
                  'issue_tags', q.issue_tags,
                  'customer', case when q.customer_none then null else jsonb_build_object('satisfied', q.customer_satisfied, 'reason', q.customer_reason) end,
                  'comments', (select coalesce(jsonb_agg(jsonb_build_object('by', m.author_name, 'body', m.body) order by m.created_at), '[]')
                               from public.patrol_comments m where m.patrol_id = q.id)) order by q.started_at), '[]')
                from public.patrol_checks q
                where q.store_id = sl.store_id and q.business_date = p_date and q.shift = sl.sh and q.status = 'valid' and not q.is_test and not q.by_test_account),
    'attendance', (select coalesce(jsonb_agg(jsonb_build_object('kind', c.kind, 'name', c.roster_name, 'reason', c.reason, 'status', c.status,
                                                                 'late_min', c.late_min, 'told_after_start', c.notice_min < 0, 'cover', c.cover_name) order by c.reported_at), '[]')
                   from public.shift_changes c
                   where c.store_id = sl.store_id and c.business_date = p_date and c.shift = sl.sh and c.status in ('open', 'approved') and not c.is_test),
    'incidents', (select coalesce(jsonb_agg(jsonb_build_object('no', i.incident_no, 'kind', i.kind, 'priority', i.priority, 'state', coalesce(i.wf_state, i.status),
                                                                'time', to_char(i.occurred_at at time zone 'Asia/Tokyo', 'HH24:MI'), 'description', left(i.description, 400),
                                                                'action', left(i.action_taken, 300), 'reporter', i.reporter_name) order by i.occurred_at), '[]')
                  from public.incidents i
                  where i.store_id = sl.store_id and i.business_date = p_date and i.shift = sl.sh and not i.by_test_account)
  ) order by sl.code, sl.ord), '[]')
  into slots
  from sl;

  select coalesce(jsonb_agg(jsonb_build_object(
    'no', i.incident_no, 'kind', i.kind, 'store', st.name_ja, 'date', i.business_date, 'shift', i.shift,
    'priority', i.priority, 'state', coalesce(i.wf_state, i.status), 'days_open', p_date - i.business_date,
    'overdue', i.due_at is not null and i.due_at < now(), 'assignee', coalesce(i.assignee_name, i.owner_name),
    'description', left(i.description, 200)) order by i.business_date), '[]')
  into open_cases
  from public.incidents i join public.stores st on st.id = i.store_id
  where i.business_date < p_date and i.status <> 'done' and not i.by_test_account;

  return jsonb_build_object('date', p_date, 'slots', slots, 'open_cases', open_cases);
end $$;
revoke execute on function public.daily_report_data(date) from anon, public;
grant execute on function public.daily_report_data(date) to authenticated, service_role;

-- recipients choose 'daily_report' like the other kinds (on for everyone now)
alter table public.notify_recipients drop constraint if exists notify_recipients_kinds_check;
alter table public.notify_recipients add constraint notify_recipients_kinds_check
  check (kinds <@ array['chorei', 'chorei_note', 'patrol', 'shift_request', 'signup', 'edit', 'staff_alert', 'stock', 'sales', 'shift_change', 'visa_hours', 'incident', 'report', 'lost_item', 'stock_standard', 'daily_report']);
alter table public.notify_recipients alter column kinds
  set default array['chorei', 'chorei_note', 'patrol', 'shift_request', 'signup', 'edit', 'staff_alert', 'stock', 'sales', 'shift_change', 'visa_hours', 'incident', 'report', 'lost_item', 'daily_report'];
update public.notify_recipients set kinds = kinds || array['daily_report'] where not ('daily_report' = any(kinds));

-- every day at 7:30 JST (22:30 UTC), after the 遅番 (23-7) has ended
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('ai-daily-report', '30 22 * * *', $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'notify_url'),
        headers := jsonb_build_object('Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notify_secret')),
        body := '{"action":"daily_report"}'::jsonb,
        timeout_milliseconds := 150000)
    $job$);
  end if;
end $$;
