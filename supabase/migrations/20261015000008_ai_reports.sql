-- AIレポート (owner, 2026-10-15; item 13 + a weekly report): every Monday 8:00 JST for the previous
-- Monday–Sunday and on the 1st at 8:00 for the previous month, send-notifications (action 'report',
-- pg_cron 23:00 UTC) collects the figures with report_data(), asks Claude for 要点 and 提案, stores the
-- report in ai_reports and mails it to the recipients who have the kind 'report'. Managers can also make one
-- from 管理 → レポート.

create table public.ai_reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('weekly', 'monthly')),
  period_from date not null,
  period_to date not null,
  data jsonb not null,
  summary text not null,
  model text,
  created_by uuid references public.profiles (id) on delete set null,
  mailed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (kind, period_from)
);
alter table public.ai_reports enable row level security;
revoke all on public.ai_reports from anon;
create policy ai_reports_select on public.ai_reports for select to authenticated using (public.is_manager());

-- AI calls made by the scheduled report have no user
alter table public.translation_log alter column user_id drop not null;

/**
 * The figures of [from, to] for a report (managers, or the service role from the scheduled job).
 * Sales: daily_sales (ラーメン + チャーシューメン) vs the 目標杯数 stored on each sent 販売日報, and the same
 * slots 364 days before. Test data and test accounts are left out everywhere.
 */
create function public.report_data(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  op date := greatest(p_from, '2026-10-12'::date);
  last_day date := least(p_to, (now() at time zone 'Asia/Tokyo')::date - 1);
  sales jsonb;
  patrol jsonb;
  chorei jsonb;
  attendance jsonb;
  stock jsonb;
  incidents jsonb;
begin
  if auth.uid() is not null and not public.is_manager() then
    raise exception 'managers only' using errcode = '42501';
  end if;

  with s as (
    select st.name_ja as store, d.shift, d.business_date, d.bowls, nullif(sr.target_bowls, 0) as target,
           (select ly.bowls from public.daily_sales ly where ly.store_id = d.store_id and ly.shift = d.shift and ly.business_date = d.business_date - 364) as ly
    from public.daily_sales d
    join public.stores st on st.id = d.store_id
    left join public.sales_reports sr on sr.store_id = d.store_id and sr.business_date = d.business_date and sr.shift = d.shift
                                     and sr.status = 'submitted' and not sr.by_test_account
    where d.business_date between p_from and p_to
  )
  select jsonb_build_object(
    'days', (select count(distinct business_date) from s),
    'bowls', (select coalesce(sum(bowls), 0) from s),
    'target', (select sum(target) from s),
    'bowls_with_target', (select sum(bowls) filter (where target is not null) from s),
    'last_year', (select sum(ly) from s),
    'bowls_with_last_year', (select sum(bowls) filter (where ly is not null) from s),
    'by_slot', (select coalesce(jsonb_agg(x order by x.store, x.shift), '[]') from (
                  select store, shift, sum(bowls) as bowls, sum(target) as target, sum(bowls) filter (where target is not null) as bowls_with_target,
                         sum(ly) as last_year, sum(bowls) filter (where ly is not null) as bowls_with_last_year
                  from s group by store, shift) x),
    'by_day', (select coalesce(jsonb_agg(y order by y.date), '[]') from (
                  select business_date as date, sum(bowls) as bowls, sum(target) as target from s group by business_date) y)
  ) into sales;

  select jsonb_build_object(
    'count', count(*),
    'avg25', round(avg(p.total::numeric / p.max_total * 25), 1),
    'coaching', count(*) filter (where p.judgement = 'coaching'),
    'items', jsonb_build_object('smile', round(avg(p.score_smile), 2), 'voice', round(avg(p.score_voice), 2), 'grooming', round(avg(p.score_grooming), 2),
                                'clean', round(avg(p.score_clean), 2), 'quality', round(avg(p.score_quality), 2)),
    'by_slot', (select coalesce(jsonb_agg(z order by z.store, z.shift), '[]') from (
                  select st.name_ja as store, q.shift, count(*) as count, round(avg(q.total::numeric / q.max_total * 25), 1) as avg25
                  from public.patrol_checks q join public.stores st on st.id = q.store_id
                  where q.status = 'valid' and not q.is_test and q.total is not null and q.business_date between p_from and p_to
                  group by st.name_ja, q.shift) z)
  ) into patrol
  from public.patrol_checks p
  where p.status = 'valid' and not p.is_test and p.total is not null and p.business_date between p_from and p_to;

  with slots as (
    select d::date as dt, st.id as store_id, sh
    from generate_series(op, last_day, interval '1 day') d
    cross join public.stores st
    cross join unnest(array['early', 'middle', 'late']) sh
    where st.active
  ), x as (
    select sl.*,
      exists (select 1 from public.chorei_records c where c.store_id = sl.store_id and c.business_date = sl.dt and c.shift = sl.sh and c.status = 'valid' and not c.is_test) as rec,
      (select m.kind || ':' || coalesce(m.reason, '') from public.chorei_misses m
        where m.store_id = sl.store_id and m.business_date = sl.dt and m.shift = sl.sh and not m.by_test_account) as miss
    from slots sl
  )
  select jsonb_build_object(
    'due', count(*),
    'done', count(*) filter (where rec or miss like 'done:%'),
    'missing_by_reason', (select coalesce(jsonb_object_agg(r, n), '{}') from (
                            select coalesce(nullif(split_part(miss, ':', 2), ''), 'unreported') as r, count(*) as n
                            from x where not rec and (miss is null or miss like 'missed:%') group by 1) z)
  ) into chorei
  from x;

  select jsonb_build_object(
    'absence', count(*) filter (where c.kind = 'absence'),
    'absence_same_day', count(*) filter (where c.kind = 'absence' and (c.reported_at at time zone 'Asia/Tokyo')::date >= c.business_date),
    'late', count(*) filter (where c.kind = 'late'),
    'early_leave', count(*) filter (where c.kind = 'early_leave'),
    'told_after_start', count(*) filter (where c.notice_min < 0),
    'covered', count(*) filter (where c.cover_name is not null and c.status = 'approved'),
    'not_reported', (select count(*) from public.sales_reports r cross join lateral jsonb_array_elements(r.staff) sf
                     where r.status = 'submitted' and not r.by_test_account and r.business_date between p_from and p_to
                       and sf ->> 'status' in ('late', 'early_leave', 'absent')
                       and not exists (select 1 from public.shift_changes c2 where c2.roster_name = sf ->> 'name' and c2.business_date = r.business_date
                                       and c2.shift = r.shift and c2.status in ('open', 'approved'))),
    'visa_over_people', (select count(distinct split_part(a.key, '|', 2)) from public.alert_log a
                         where a.kind = 'visa_hours' and split_part(a.key, '|', 3)::date between p_from - 6 and p_to)
  ) into attendance
  from public.shift_changes c
  where c.status in ('open', 'approved') and not c.is_test and c.business_date between p_from and p_to;

  select jsonb_build_object(
    'loss_events', (select count(*) from public.stock_events e where e.kind = 'loss' and e.voided_at is null and not e.by_test_account and e.business_date between p_from and p_to),
    'loss_items', (select coalesce(jsonb_agg(jsonb_build_object('store', st.name_ja, 'item', i.name_ja, 'qty', x.q) order by x.q desc), '[]') from (
                     select (l ->> 'item')::uuid as it, sum((l ->> 'qty')::numeric) as q
                     from public.stock_events e cross join lateral jsonb_array_elements(e.lines) l
                     where e.kind = 'loss' and e.voided_at is null and not e.by_test_account and e.business_date between p_from and p_to
                     group by 1) x
                   join public.stock_items i on i.id = x.it join public.stores st on st.id = i.store_id),
    'sales_reports_with_noodle_diff', (select count(*) from public.sales_reports r where r.status = 'submitted' and not r.by_test_account
                                        and r.business_date between p_from and p_to and coalesce(r.noodle_diff, 0) <> 0),
    'sales_reports_with_cash_diff', (select count(*) from public.sales_reports r where r.status = 'submitted' and not r.by_test_account
                                      and r.business_date between p_from and p_to and coalesce(r.cash_diff, 0) <> 0)
  ) into stock;

  select jsonb_build_object(
    'by_kind', (select coalesce(jsonb_object_agg(kind, n), '{}') from (
                  select i.kind, count(*) as n from public.incidents i
                  where not i.by_test_account and i.business_date between p_from and p_to group by i.kind) k),
    'open_now', (select count(*) from public.incidents i where not i.by_test_account and i.status <> 'done')
  ) into incidents;

  return jsonb_build_object('from', p_from, 'to', p_to, 'sales', sales, 'patrol', patrol, 'chorei', chorei,
                            'attendance', attendance, 'stock', stock, 'incidents', incidents);
end $$;
revoke execute on function public.report_data(date, date) from anon, public;
grant execute on function public.report_data(date, date) to authenticated, service_role;

-- recipients choose 'report' like the other kinds (on for everyone now)
alter table public.notify_recipients drop constraint if exists notify_recipients_kinds_check;
alter table public.notify_recipients add constraint notify_recipients_kinds_check
  check (kinds <@ array['chorei', 'chorei_note', 'patrol', 'shift_request', 'signup', 'edit', 'staff_alert', 'stock', 'sales', 'shift_change', 'visa_hours', 'incident', 'report']);
alter table public.notify_recipients alter column kinds
  set default array['chorei', 'chorei_note', 'patrol', 'shift_request', 'signup', 'edit', 'staff_alert', 'stock', 'sales', 'shift_change', 'visa_hours', 'incident', 'report'];
update public.notify_recipients set kinds = kinds || array['report'] where not ('report' = any(kinds));

-- every day at 8:00 JST; the function decides (Monday → weekly, 1st → monthly)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('ai-report', '0 23 * * *', $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'notify_url'),
        headers := jsonb_build_object('Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notify_secret')),
        body := '{"action":"report"}'::jsonb,
        timeout_milliseconds := 120000)
    $job$);
  end if;
end $$;
