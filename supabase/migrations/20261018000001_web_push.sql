-- Web push (owner, 2026-10-18): notifications on the phone even when the app is closed.
-- A phone that allows notifications saves its push subscription (save_push_subscription). Events put rows in
-- push_queue (one per person; the text is written by the Edge Function send-push in the person's language,
-- profiles.locale). pg_cron calls send-push every minute while rows wait; gone subscriptions are deleted there.
-- First kinds (owner): 代わり募集 / 指名 / 承認の結果, 送れていない写真・動画, and for managers 休み・遅刻・早退の連絡,
-- 代われます, クレーム・事故, 新規登録. Test accounts and test data never get real events (only テスト通知).

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sent_at timestamptz
);
create index push_subscriptions_user on public.push_subscriptions (user_id);
create trigger push_subscriptions_updated before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

create table public.push_queue (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('test', 'recruit', 'named', 'decided', 'assigned', 'upload', 'mgr_change', 'mgr_incident', 'mgr_signup')),
  data jsonb not null default '{}',
  url text not null default '/',
  urgent boolean not null default false,
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts int not null default 0,
  last_error text
);
create index push_queue_open on public.push_queue (id) where sent_at is null;

alter table public.push_subscriptions enable row level security;
alter table public.push_queue enable row level security;
-- a person sees their own phones; writes only through the functions below
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
revoke all on public.push_subscriptions, public.push_queue from anon;
revoke insert, update, delete on public.push_subscriptions from authenticated;
revoke all on public.push_queue from authenticated;

/** Save (or move to me) this phone's subscription. Called when notifications are turned on and at every app start. */
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_active() then
    raise exception 'not active' using errcode = '42501';
  end if;
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 1000 or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'bad subscription' using errcode = '22023';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
end $$;
revoke execute on function public.save_push_subscription(text, text, text, text) from anon, public;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

create function public.delete_push_subscription(p_endpoint text)
returns void
language sql security definer set search_path = ''
as $$ delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid() $$;
revoke execute on function public.delete_push_subscription(text) from anon, public;
grant execute on function public.delete_push_subscription(text) to authenticated;

/** Queue one notification for p_user (only when they have a phone; test accounts only get テスト通知). */
create function public.queue_push(p_user uuid, p_kind text, p_data jsonb, p_url text, p_urgent boolean default false, p_dedupe text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_user is null or not exists (select 1 from public.push_subscriptions s where s.user_id = p_user) then
    return;
  end if;
  if p_kind <> 'test' and public.is_test_profile(p_user) then
    return;
  end if;
  insert into public.push_queue (user_id, kind, data, url, urgent, dedupe_key)
  values (p_user, p_kind, coalesce(p_data, '{}'), p_url, p_urgent, p_dedupe)
  on conflict (dedupe_key) do nothing;
end $$;
revoke execute on function public.queue_push(uuid, text, jsonb, text, boolean, text) from public, anon, authenticated;

/** テスト通知 to my own phones (設定 → 通知). */
create function public.send_test_push()
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_active() then
    raise exception 'not active' using errcode = '42501';
  end if;
  if not exists (select 1 from public.push_subscriptions s where s.user_id = auth.uid()) then
    raise exception 'no subscription' using errcode = '22023';
  end if;
  perform public.queue_push(auth.uid(), 'test', '{}', '/profile', true);
end $$;
revoke execute on function public.send_test_push() from anon, public;
grant execute on function public.send_test_push() to authenticated;

/** The active account linked to a shift-table name. */
create function public.profile_of_roster(p_name text) returns uuid
language sql stable security definer set search_path = ''
as $$ select id from public.profiles where roster_name = p_name and status = 'active' order by created_at limit 1 $$;
revoke execute on function public.profile_of_roster(text) from public, anon, authenticated;

create function public.change_push_data(c public.shift_changes) returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object('name', c.roster_name, 'kind', c.kind, 'date', c.business_date, 'shift', c.shift, 'store', c.store_mark,
    'from', case when c.kind = 'early_leave' then c.leave_min else c.start_min end, 'to', c.end_min)
$$;
revoke execute on function public.change_push_data(public.shift_changes) from public, anon, authenticated;

/** Staff: 代わり募集 to everyone who could take it (like shift_recruits), 指名 to the named person, then the result. */
create function public.push_on_shift_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  d jsonb := public.change_push_data(new);
  from_min int := case when new.kind = 'early_leave' then new.leave_min else new.start_min end;
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
  if tg_op = 'UPDATE' and old.status = 'open' and new.status in ('approved', 'rejected') then
    perform public.queue_push(public.profile_of_roster(new.roster_name), 'decided', d || jsonb_build_object('ok', new.status = 'approved', 'cover', new.cover_name),
                              '/absence', false, 'decided|' || new.id);
    if new.status = 'approved' and new.cover_name is not null then
      perform public.queue_push(public.profile_of_roster(new.cover_name), 'assigned', d, '/schedule', true, 'assigned|' || new.id);
    end if;
  end if;
  return new;
end $$;
create trigger shift_changes_push after insert or update of status on public.shift_changes
  for each row execute function public.push_on_shift_change();

/** Managers: the same events as the manager e-mails (休み連絡・代われます・承認待ちの催促, クレーム・事故 new / overdue, 新規登録). */
create function public.push_on_notify_event() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  kind text;
  d jsonb;
  url text;
  c public.shift_changes;
  m record;
begin
  if new.kind = 'shift_change' and new.data ->> 'event' in ('report', 'offer', 'reminder') then
    select * into c from public.shift_changes where id = new.ref_id;
    if not found or c.is_test then
      return new;
    end if;
    kind := 'mgr_change';
    d := public.change_push_data(c) || jsonb_build_object('event', new.data ->> 'event', 'hours', new.data -> 'hours',
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
  for m in
    select p.id from public.profiles p
    where p.role in ('manager', 'admin') and p.status = 'active' and not p.is_test_account
      and p.id is distinct from new.actor_id
  loop
    perform public.queue_push(m.id, kind, d, url, new.urgent, 'ev|' || new.id || '|' || m.id);
  end loop;
  return new;
end $$;
create trigger notify_events_push after insert on public.notify_events
  for each row execute function public.push_on_notify_event();

/** 送れていない写真・動画: files waiting > 1 hour (sent in the last 3 days), at most every 6 hours, 9:00–22:59 JST. */
create function public.queue_upload_reminders() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  jst timestamp := now() at time zone 'Asia/Tokyo';
  n int := 0;
  r record;
begin
  if extract(hour from jst) < 9 then
    return 0;
  end if;
  for r in
    select a.owner_id, count(*)::int as files from public.attachments a
    where a.status = 'pending' and a.created_at < now() - interval '1 hour' and a.created_at > now() - interval '3 days'
    group by a.owner_id
  loop
    perform public.queue_push(r.owner_id, 'upload', jsonb_build_object('n', r.files), '/', false,
      'upload|' || r.owner_id || '|' || to_char(jst, 'YYYY-MM-DD') || '|' || floor(extract(hour from jst) / 6));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.queue_upload_reminders() from public, anon, authenticated;

-- send-push: every minute while rows wait. URL in Vault (push_url); secret shared with send-notifications (notify_secret).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('push-send', '* * * * *', $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'push_url'),
        headers := jsonb_build_object('Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notify_secret')),
        body := '{"action":"send"}'::jsonb,
        timeout_milliseconds := 60000)
      where exists (select 1 from public.push_queue where sent_at is null and attempts < 5)
        and exists (select 1 from vault.decrypted_secrets where name = 'push_url')
    $job$);
    perform cron.schedule('push-upload-reminders', '*/10 * * * *', 'select public.queue_upload_reminders()');
    perform cron.schedule('push-queue-purge', '15 3 * * *', $job$ delete from public.push_queue where created_at < now() - interval '30 days' $job$);
  end if;
end $$;
