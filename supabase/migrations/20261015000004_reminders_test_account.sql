-- (1) 未対応の休み・遅刻の連絡 reminders (owner, 2026-10-15): a report still 確認待ち when its shift starts
--     within 12 hours, and again within 3 hours, sends one urgent mail each (kind shift_change, event
--     reminder; alert_log keeps it to once per threshold; not within 30 minutes of the report itself).
--     pg_cron every 10 minutes.
-- (2) A test account again (owner, 2026-10-15): the read-only guard and the nightly purge now cover the
--     newer tables. A test account's reports are is_test (never shown to real staff / managers); it can
--     offer only on test reports, and cannot approve, set visas or change scores.

create function public.check_pending_changes() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  c record;
  h int;
  n int := 0;
  inserted int;
begin
  for c in
    select x.id, public.shift_at(x.business_date, x.start_min) as starts
    from public.shift_changes x
    where x.status = 'open' and not x.is_test
      -- the report mail itself went out less than 30 minutes ago
      and x.created_at < now() - interval '30 minutes'
      and public.shift_at(x.business_date, x.start_min) > now()
      and public.shift_at(x.business_date, x.start_min) <= now() + interval '12 hours'
  loop
    h := case when c.starts <= now() + interval '3 hours' then 3 else 12 end;
    insert into public.alert_log (kind, key) values ('pending_change', format('pending%s|%s', h, c.id)) on conflict (key) do nothing;
    get diagnostics inserted = row_count;
    if inserted > 0 then
      -- a 3-hour reminder also covers the 12-hour one
      insert into public.alert_log (kind, key) values ('pending_change', format('pending12|%s', c.id)) on conflict (key) do nothing;
      perform public.add_notify_event('shift_change', 'shift_changes', c.id, true, jsonb_build_object('event', 'reminder', 'hours', h));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.check_pending_changes() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('check-pending-changes', '*/10 * * * *', 'select public.check_pending_changes()');
  end if;
end $$;

-- ---- test account

create or replace function public.guard_test_account_writes() returns trigger
language plpgsql set search_path = ''
as $$
declare
  me text := auth.uid()::text;
  owner_col text := case tg_table_name
    when 'chorei_records' then 'leader_id'
    when 'patrol_checks' then 'patroller_id'
    when 'chorei_notes' then 'author_id'
    when 'shift_requests' then 'user_id'
    when 'profiles' then 'id'
    when 'shift_changes' then 'requester_id'
    when 'shift_offers' then 'user_id'
  end;
  free_profile_cols text[] := array['locale', 'display_name', 'privacy_accepted_at', 'updated_at'];
begin
  if me is null or not public.is_test_account() then
    return coalesce(new, old);
  end if;
  if owner_col is not null
     and (tg_op = 'INSERT' or to_jsonb(old) ->> owner_col = me)
     and (tg_op = 'DELETE' or to_jsonb(new) ->> owner_col = me)
     and (tg_table_name <> 'profiles' or tg_op = 'UPDATE' and (to_jsonb(new) - free_profile_cols) = (to_jsonb(old) - free_profile_cols)) then
    return coalesce(new, old);
  end if;
  raise exception 'test account: read only (%)', tg_table_name using errcode = '42501';
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['shift_changes', 'shift_offers', 'staff_limits', 'attendance_overrides']
  loop
    execute format('drop trigger if exists test_account_read_only on public.%I', t);
    execute format('create trigger test_account_read_only before insert or update or delete on public.%I
                    for each row execute function public.guard_test_account_writes()', t);
  end loop;
end $$;

/** A test account offers only on test reports (real staff never see those). */
create function public.guard_test_offer() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if public.is_test_account() and not coalesce((select c.is_test from public.shift_changes c where c.id = new.change_id), false) then
    raise exception 'test account: read only (shift_offers)' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger shift_offers_test before insert or update on public.shift_offers
  for each row execute function public.guard_test_offer();

create or replace function public.purge_test_account_data() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  testers uuid[] := array(select id from public.profiles where is_test_account);
  chorei uuid[] := array(select id from public.chorei_records where by_test_account or leader_id = any(testers));
  patrol uuid[] := array(select id from public.patrol_checks where by_test_account or patroller_id = any(testers));
  misses uuid[] := array(select id from public.chorei_misses where by_test_account or reporter_id = any(testers));
  stock uuid[] := array(select id from public.stock_events where by_test_account);
  sales uuid[] := array(select id from public.sales_reports where by_test_account);
  changes uuid[] := array(select id from public.shift_changes where is_test or requester_id = any(testers));
  n int := 0;
  k int;
begin
  delete from public.attachments where chorei_id = any(chorei) or patrol_id = any(patrol) or miss_id = any(misses) or stock_event_id = any(stock) or owner_id = any(testers);
  delete from public.chorei_notes where chorei_id = any(chorei) or author_id = any(testers);
  delete from public.chorei_records where id = any(chorei);
  get diagnostics k = row_count; n := n + k;
  delete from public.patrol_checks where id = any(patrol);
  get diagnostics k = row_count; n := n + k;
  delete from public.chorei_misses where id = any(misses);
  get diagnostics k = row_count; n := n + k;
  delete from public.stock_events where id = any(stock);
  get diagnostics k = row_count; n := n + k;
  delete from public.sales_reports where id = any(sales);
  get diagnostics k = row_count; n := n + k;
  delete from public.shift_offers where change_id = any(changes) or user_id = any(testers);
  delete from public.shift_changes where id = any(changes);
  get diagnostics k = row_count; n := n + k;
  delete from public.shift_requests where user_id = any(testers);
  delete from public.translation_log where user_id = any(testers);
  delete from public.audit_log where row_id = any(chorei || patrol || misses || stock || sales || changes) or actor_id = any(testers);
  return n;
end $$;
revoke execute on function public.purge_test_account_data() from public, anon, authenticated;
