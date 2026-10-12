-- Manager e-mail notifications (Resend, Edge Function send-notifications).
-- Every report (朝礼, 追記, 巡回, シフト希望), every sign-up and every manager edit / void adds a row to
-- notify_events by trigger, so no client path can skip it and a mail problem never blocks a report.
-- Recipients are managed by managers (設定 → 通知メール); each one chooses 'instant' (one mail per event)
-- or 'digest' (one mail a day at 7:30 JST). Urgent events (即日指導, sign-up) go out at once to everyone.
-- Test accounts and test data (is_test) never notify.

create table public.notify_recipients (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name text not null default '',
  mode text not null default 'instant' check (mode in ('instant', 'digest')),
  kinds text[] not null default array['chorei', 'chorei_note', 'patrol', 'shift_request', 'signup', 'edit']
    check (kinds <@ array['chorei', 'chorei_note', 'patrol', 'shift_request', 'signup', 'edit']),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger notify_recipients_updated before update on public.notify_recipients
  for each row execute function public.set_updated_at();

create table public.notify_events (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('chorei', 'chorei_note', 'patrol', 'shift_request', 'signup', 'edit')),
  urgent boolean not null default false,
  ref_table text not null,
  ref_id uuid not null,
  actor_id uuid,
  data jsonb not null default '{}',
  -- later events with the same key replace earlier unsent ones (シフト希望 edited several times)
  dedupe_key text,
  created_at timestamptz not null default now(),
  instant_done_at timestamptz,
  digest_done_at timestamptz,
  attempts int not null default 0,
  last_error text
);
create index notify_events_instant_open on public.notify_events (created_at) where instant_done_at is null;
create index notify_events_digest_open on public.notify_events (created_at) where digest_done_at is null;

alter table public.notify_recipients enable row level security;
alter table public.notify_events enable row level security;
create policy notify_recipients_select on public.notify_recipients for select to authenticated using (public.is_manager());
create policy notify_recipients_insert on public.notify_recipients for insert to authenticated with check (public.is_manager());
create policy notify_recipients_update on public.notify_recipients for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
create policy notify_recipients_delete on public.notify_recipients for delete to authenticated using (public.is_manager());
create policy notify_events_select on public.notify_events for select to authenticated using (public.is_manager());
revoke all on public.notify_recipients, public.notify_events from anon;
revoke insert, update, delete on public.notify_events from authenticated;

-- test accounts (manager role, read only) cannot change the recipients either
drop trigger if exists test_account_read_only on public.notify_recipients;
create trigger test_account_read_only before insert or update or delete on public.notify_recipients
  for each row execute function public.guard_test_account_writes();

create or replace function public.is_test_profile(p uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select is_test_account from public.profiles where id = p), false) $$;
revoke execute on function public.is_test_profile(uuid) from public, anon, authenticated;

create or replace function public.add_notify_event(p_kind text, p_table text, p_id uuid, p_urgent boolean default false,
                                                   p_data jsonb default '{}', p_dedupe text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null and public.is_test_profile(auth.uid()) then
    return;
  end if;
  insert into public.notify_events (kind, urgent, ref_table, ref_id, actor_id, data, dedupe_key)
  values (p_kind, p_urgent, p_table, p_id, auth.uid(), coalesce(p_data, '{}'), p_dedupe);
end $$;
revoke execute on function public.add_notify_event(text, text, uuid, boolean, jsonb, text) from public, anon, authenticated;

-- columns whose change is not worth a mail
create or replace function public.notify_changes(o jsonb, n jsonb) returns jsonb
language sql immutable set search_path = ''
as $$
  select coalesce(jsonb_object_agg(k, jsonb_build_object('old', o -> k, 'new', n -> k)), '{}')
  from jsonb_object_keys(n) k
  where k not in ('updated_at', 'total', 'max_total', 'judgement', 'duration_min')
    and (o -> k) is distinct from (n -> k)
$$;

create or replace function public.notify_on_record() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  is_patrol boolean := tg_table_name = 'patrol_checks';
  changes jsonb;
begin
  if new.is_test or new.by_test_account then
    return new;
  end if;
  -- a new report: 朝礼 inserted, or 巡回 finalised (inserted valid or draft → valid)
  if new.status = 'valid' and (tg_op = 'INSERT' or (is_patrol and old.status = 'draft')) then
    perform public.add_notify_event(
      case when is_patrol then 'patrol' else 'chorei' end, tg_table_name, new.id,
      is_patrol and to_jsonb(new) ->> 'judgement' = 'coaching');
    return new;
  end if;
  -- a manager's edit / void of a submitted report
  if tg_op = 'UPDATE' and old.status <> 'draft' and auth.uid() is not null and public.is_manager() then
    changes := public.notify_changes(to_jsonb(old), to_jsonb(new));
    if changes <> '{}' then
      perform public.add_notify_event('edit', tg_table_name, new.id, false, jsonb_build_object(
        'action', case
          when new.status = 'void' and old.status <> 'void' then 'void'
          when changes ? 'follow_up_done_at' then 'follow_up'
          when changes ? 'started_at' or changes ? 'ended_at' or changes ? 'needs_time_review' then 'time'
          else 'update' end,
        'changes', changes));
    end if;
  end if;
  return new;
end $$;

create trigger chorei_notify after insert or update on public.chorei_records
  for each row execute function public.notify_on_record();
create trigger patrol_notify after insert or update on public.patrol_checks
  for each row execute function public.notify_on_record();

create or replace function public.notify_on_note() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if public.is_test_profile(new.author_id)
     or exists (select 1 from public.chorei_records c where c.id = new.chorei_id and (c.is_test or c.by_test_account)) then
    return new;
  end if;
  perform public.add_notify_event('chorei_note', 'chorei_notes', new.id);
  return new;
end $$;
create trigger chorei_note_notify after insert on public.chorei_notes
  for each row execute function public.notify_on_note();

create or replace function public.notify_on_shift_request() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  by_manager boolean := auth.uid() is not null and auth.uid() <> new.user_id;
begin
  if public.is_test_profile(new.user_id) then
    return new;
  end if;
  if by_manager then
    perform public.add_notify_event('edit', 'shift_requests', new.id, false, jsonb_build_object('action', 'update'));
  else
    perform public.add_notify_event('shift_request', 'shift_requests', new.id, false,
      jsonb_build_object('first', tg_op = 'INSERT'), 'shift_request:' || new.id);
  end if;
  return new;
end $$;
create trigger shift_request_notify after insert or update on public.shift_requests
  for each row execute function public.notify_on_shift_request();

create or replace function public.notify_on_profile() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.is_test_account or coalesce(new.email, '') like '%@example.com' then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.status = 'pending')
     or (tg_op = 'UPDATE' and old.status = 'rejected' and new.status = 'pending') then
    perform public.add_notify_event('signup', 'profiles', new.id, true, jsonb_build_object('reapply', tg_op = 'UPDATE'));
  end if;
  return new;
end $$;
create trigger profile_notify after insert or update on public.profiles
  for each row execute function public.notify_on_profile();

-- The Edge Function checks the cron caller's secret against Vault (name notify_secret).
create or replace function public.notify_secret_ok(p text) returns boolean
language plpgsql stable security definer set search_path = ''
as $$ begin
  return exists (select 1 from vault.decrypted_secrets where name = 'notify_secret' and decrypted_secret = p);
end $$;
revoke execute on function public.notify_secret_ok(text) from public, anon, authenticated;

-- Instant mails: every minute, only when something is waiting. Digest: 7:30 JST (22:30 UTC).
-- URL and secret live in Vault (notify_url, notify_secret) — never in this file.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('notify-instant', '* * * * *', $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'notify_url'),
        headers := jsonb_build_object('Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notify_secret')),
        body := '{"action":"instant"}'::jsonb,
        timeout_milliseconds := 60000)
      where exists (select 1 from public.notify_events where instant_done_at is null)
    $job$);
    perform cron.schedule('notify-digest', '30 22 * * *', $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'notify_url'),
        headers := jsonb_build_object('Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notify_secret')),
        body := '{"action":"digest"}'::jsonb,
        timeout_milliseconds := 60000)
    $job$);
  end if;
end $$;

-- the send history is kept 90 days (the reports themselves are never deleted)
create or replace function public.purge_notify_events() returns void
language sql security definer set search_path = ''
as $$ delete from public.notify_events where created_at < now() - interval '90 days' and instant_done_at is not null and digest_done_at is not null $$;
revoke execute on function public.purge_notify_events() from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('purge-notify-events', '0 20 * * *', 'select public.purge_notify_events()');
  end if;
end $$;
