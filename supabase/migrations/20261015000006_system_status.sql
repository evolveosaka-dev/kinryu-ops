-- システム状態 (owner, 2026-10-15): one manager screen for what can silently go wrong —
-- mails sent today vs Resend's free 100 / day, notifications that failed or are stuck, photo / video
-- uploads that failed or are stuck, the last run of every pg_cron job, the last Sheets sync and this
-- month's AI usage. send-notifications writes mail_log after each batch (Auth mails sent by Supabase
-- through Resend SMTP are not counted there).

create table public.mail_log (
  id bigint generated always as identity primary key,
  sent_at timestamptz not null default now(),
  kind text not null,
  mails int not null check (mails > 0)
);
create index mail_log_sent_at on public.mail_log (sent_at);
alter table public.mail_log enable row level security;
revoke all on public.mail_log from anon;
create policy mail_log_select on public.mail_log for select to authenticated using (public.is_manager());

create function public.system_status() returns jsonb
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
    'ai_tokens_month', (select jsonb_build_object('calls', count(*), 'input', coalesce(sum(l.input_tokens), 0), 'output', coalesce(sum(l.output_tokens), 0))
                        from public.translation_log l where l.at >= month_start)
  );
end $$;
revoke execute on function public.system_status() from anon, public;
grant execute on function public.system_status() to authenticated;
