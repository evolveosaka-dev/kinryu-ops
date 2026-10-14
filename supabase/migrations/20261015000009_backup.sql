-- バックアップ (owner, 2026-10-15; item 15 of the proposal): sync-sheets action 'backup' writes every business
-- table to Drive (金龍 朝礼・巡回/バックアップ/<date>/<table>.json.gz) every Monday 4:30 JST (Sunday 19:30 UTC);
-- 12 weeks are kept. システム状態 shows the last backup (⚠ after 8 days).

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
    'jobs', jobs,
    'sheets_synced_at', (select k.value from public.app_kv k where k.key = 'sheets_synced_at'),
    'backup_at', (select k.value from public.app_kv k where k.key = 'backup_at'),
    'backup_url', (select k.value from public.app_kv k where k.key = 'backup_url'),
    'backup_result', (select k.value::jsonb from public.app_kv k where k.key = 'backup_result'),
    'ai_tokens_month', (select jsonb_build_object('calls', count(*), 'input', coalesce(sum(l.input_tokens), 0), 'output', coalesce(sum(l.output_tokens), 0))
                        from public.translation_log l where l.at >= month_start)
  );
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('backup-weekly', '30 19 * * 0', $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'sheets_sync_url'),
        headers := jsonb_build_object('Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sheets_sync_secret')),
        body := '{"action":"backup"}'::jsonb,
        timeout_milliseconds := 300000)
    $job$);
  end if;
end $$;
