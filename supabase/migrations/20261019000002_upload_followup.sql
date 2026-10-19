-- Files that did not arrive after a report (owner, 2026-10-19, part 2 of the upload fixes):
--  * the sender's app says which files it still holds (report_upload_holdings, at every start): the others of
--    this sender, waiting > 10 minutes, are gone from the phone → status 'lost' (lost_reason 'device');
--  * システム → 写真・動画: per file 本人に連絡 (push to the sender now) / 欠落として閉じる (lost, 'manager');
--  * a file still waiting after 48 hours is closed by itself (lost, 'expired');
--  * the first push reminder after 20 minutes (was 1 hour), from 7:00 JST (朝礼 is sent before 9:00).
-- 'lost' is not a problem for システム: the record shows 届かなかったファイル and the sender can add files again (履歴).

alter table public.attachments drop constraint if exists attachments_status_check;
alter table public.attachments add constraint attachments_status_check
  check (status in ('pending', 'uploaded', 'failed', 'deleted', 'lost'));
alter table public.attachments
  add column if not exists device_seen_at timestamptz,
  add column if not exists lost_reason text check (lost_reason in ('device', 'manager', 'expired')),
  add column if not exists closed_by uuid references public.profiles (id);

/** The sender's app at start: the attachment ids it still holds. Returns how many of mine became 'lost'. */
create function public.report_upload_holdings(p_ids uuid[])
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  if not public.is_active() then
    raise exception 'not active' using errcode = '42501';
  end if;
  update public.attachments set device_seen_at = now()
  where owner_id = auth.uid() and status = 'pending' and id = any (coalesce(p_ids, '{}'));
  update public.attachments set status = 'lost', lost_reason = 'device'
  where owner_id = auth.uid() and status = 'pending' and not (id = any (coalesce(p_ids, '{}')))
    and created_at < now() - interval '10 minutes';
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.report_upload_holdings(uuid[]) from anon, public;
grant execute on function public.report_upload_holdings(uuid[]) to authenticated;

/** システム: 欠落として閉じる — a waiting file will not come. */
create function public.close_pending_upload(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_manager() then
    raise exception 'managers only' using errcode = '42501';
  end if;
  update public.attachments set status = 'lost', lost_reason = 'manager', closed_by = auth.uid()
  where id = p_id and status = 'pending';
end $$;
revoke execute on function public.close_pending_upload(uuid) from anon, public;
grant execute on function public.close_pending_upload(uuid) to authenticated;

/** システム: 本人に連絡 — push 「送れていない写真・動画があります」 to the sender now. False when they have no phone with notifications on. */
create function public.nudge_upload_owner(p_owner uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  if not public.is_manager() then
    raise exception 'managers only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.push_subscriptions s where s.user_id = p_owner) then
    return false;
  end if;
  select count(*) into n from public.attachments a where a.owner_id = p_owner and a.status = 'pending';
  -- at most once a minute per sender
  perform public.queue_push(p_owner, 'upload', jsonb_build_object('n', greatest(n, 1)), '/', true,
    'upload-nudge|' || p_owner || '|' || to_char(now(), 'YYYYMMDDHH24MI'));
  return true;
end $$;
revoke execute on function public.nudge_upload_owner(uuid) from anon, public;
grant execute on function public.nudge_upload_owner(uuid) to authenticated;

/** 送れていない写真・動画: files waiting > 20 minutes (sent in the last 2 days), at most every 6 hours, 7:00–22:59 JST. */
create or replace function public.queue_upload_reminders() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  jst timestamp := now() at time zone 'Asia/Tokyo';
  n int := 0;
  r record;
begin
  if extract(hour from jst) < 7 then
    return 0;
  end if;
  for r in
    select a.owner_id, count(*)::int as files from public.attachments a
    where a.status = 'pending' and a.created_at < now() - interval '20 minutes' and a.created_at > now() - interval '2 days'
    group by a.owner_id
  loop
    perform public.queue_push(r.owner_id, 'upload', jsonb_build_object('n', r.files), '/', false,
      'upload|' || r.owner_id || '|' || to_char(jst, 'YYYY-MM-DD') || '|' || floor(extract(hour from jst) / 6));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.queue_upload_reminders() from public, anon, authenticated;

/** Still waiting after 48 hours: it will not come any more. */
create function public.expire_pending_uploads() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  update public.attachments set status = 'lost', lost_reason = 'expired'
  where status = 'pending' and created_at < now() - interval '48 hours';
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.expire_pending_uploads() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('uploads-expire', '20 * * * *', 'select public.expire_pending_uploads()');
  end if;
end $$;

create or replace function public.upload_parent_kind(a public.attachments) returns text
language sql immutable set search_path = ''
as $$
  select case when a.chorei_id is not null then 'chorei' when a.patrol_id is not null then 'patrol' when a.miss_id is not null then 'miss'
              when a.stock_event_id is not null then 'stock' when a.incident_id is not null then 'incident'
              when a.lost_item_id is not null then 'lost' when a.sales_report_id is not null then 'sales' end
$$;
revoke execute on function public.upload_parent_kind(public.attachments) from public, anon, authenticated;

-- システム状態: the waiting files with what a manager can do, and the files closed as lost in the last 7 days
create or replace function public.system_status() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  day_start timestamptz := ((now() at time zone 'Asia/Tokyo')::date)::timestamp at time zone 'Asia/Tokyo';
  month_start timestamptz := (date_trunc('month', (now() at time zone 'Asia/Tokyo')))::timestamp at time zone 'Asia/Tokyo';
  jobs jsonb := '[]';
begin
  if not public.is_manager() then
    raise exception 'managers only' using errcode = '42501';
  end if;
  if to_regclass('cron.job_run_details') is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('name', j.jobname, 'schedule', j.schedule, 'status', d.status,
                                                   'at', d.start_time, 'message', left(d.return_message, 200)) order by j.jobname), '[]')
      from cron.job j
      left join lateral (select r.status, r.start_time, r.return_message from cron.job_run_details r
                         where r.jobid = j.jobid order by r.start_time desc limit 1) d on true
    $q$ into jobs;
  end if;
  return jsonb_build_object(
    'mails_today', (select coalesce(sum(m.mails), 0) from public.mail_log m where m.sent_at >= day_start),
    'mails_by_kind', (select coalesce(jsonb_object_agg(k.kind, k.n), '{}') from
                        (select m.kind, sum(m.mails) as n from public.mail_log m where m.sent_at >= day_start group by m.kind) k),
    'notify_failed', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'at', e.created_at, 'error', left(e.last_error, 200)) order by e.id desc), '[]')
                      from public.notify_events e
                      where e.attempts >= 5 and e.last_error is not null and e.last_error not in ('superseded', 'record not found')
                        and e.created_at > now() - interval '7 days'),
    'notify_waiting', (select count(*) from public.notify_events e where e.instant_done_at is null and e.created_at < now() - interval '10 minutes'),
    'uploads_failed', (select count(*) from public.attachments a where a.status = 'failed' and a.created_at > now() - interval '7 days'),
    'uploads_pending', (select count(*) from public.attachments a where a.status = 'pending' and a.created_at < now() - interval '1 hour'),
    'uploads_pending_list', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'owner', a.owner_id, 'name', p.display_name, 'kind', a.kind,
                                                       'size', a.size_bytes, 'at', a.created_at, 'seen', a.device_seen_at,
                                                       'parent', public.upload_parent_kind(a),
                                                       'push', exists (select 1 from public.push_subscriptions s where s.user_id = a.owner_id))
                                                       order by a.created_at), '[]')
                             from (select * from public.attachments a where a.status = 'pending' and a.created_at < now() - interval '1 hour'
                                   order by a.created_at limit 30) a
                             join public.profiles p on p.id = a.owner_id),
    'uploads_lost_list', (select coalesce(jsonb_agg(jsonb_build_object('name', p.display_name, 'kind', a.kind, 'at', a.created_at,
                                                    'reason', a.lost_reason, 'parent', public.upload_parent_kind(a)) order by a.created_at desc), '[]')
                          from (select * from public.attachments a where a.status = 'lost' and a.updated_at > now() - interval '7 days'
                                order by a.created_at desc limit 30) a
                          join public.profiles p on p.id = a.owner_id),
    'jobs', jobs,
    'sheets_synced_at', (select k.value from public.app_kv k where k.key = 'sheets_synced_at'),
    'backup_at', (select k.value from public.app_kv k where k.key = 'backup_at'),
    'backup_url', (select k.value from public.app_kv k where k.key = 'backup_url'),
    'backup_result', (select k.value::jsonb from public.app_kv k where k.key = 'backup_result'),
    'ai_tokens_month', (select jsonb_build_object('calls', count(*), 'input', coalesce(sum(l.input_tokens), 0), 'output', coalesce(sum(l.output_tokens), 0))
                        from public.translation_log l where l.at >= month_start)
  );
end $$;
