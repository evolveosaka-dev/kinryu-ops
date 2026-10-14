-- Test accounts are invisible to real users (owner, 2026-10-15): no profile, schedule, duty, shift
-- request, report, offer or translation usage of a test account is readable by anyone but a test
-- account. A test account sees everything (manager role) and can try every function on its own test
-- data; its writes to real data are refused (guard_test_account_writes) and its data is deleted every
-- night at 4:00 JST. Its schedule / duties are a copy of a real person's (test_shadows), made again
-- every night, so tests that change the test schedule (休み承認, 早退…) start fresh each day.

/** Is this user a test account? (granted: used inside RLS policies) */
create function public.is_test_user(p uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select is_test_account from public.profiles where id = p), false) $$;
revoke execute on function public.is_test_user(uuid) from public, anon;
grant execute on function public.is_test_user(uuid) to authenticated;

/** Is this shift-table name a test account's? */
create function public.is_test_roster(p text) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.profiles where is_test_account and roster_name = p) $$;
revoke execute on function public.is_test_roster(text) from public, anon;
grant execute on function public.is_test_roster(text) to authenticated;

-- profiles: real managers no longer see test accounts
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or (public.is_manager() and (not is_test_account or public.is_test_account())));

-- name pickers (朝礼 participants …)
create or replace function public.staff_directory()
returns table (id uuid, display_name text, full_name text, home_store_id uuid, can_patrol boolean)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.display_name, p.full_name, p.home_store_id, p.can_patrol
  from public.profiles p
  where public.is_active() and p.status = 'active'
    and (not p.is_test_account or public.is_test_account())
  order by p.display_name
$$;

drop policy shift_assignments_select on public.shift_assignments;
create policy shift_assignments_select on public.shift_assignments for select to authenticated
  using ((public.is_manager() and (public.is_test_account() or not public.is_test_roster(roster_name)))
         or roster_name = public.my_roster_name());

drop policy duty_assignments_select on public.duty_assignments;
create policy duty_assignments_select on public.duty_assignments for select to authenticated
  using ((public.is_manager() and (public.is_test_account() or not public.is_test_roster(roster_name)))
         or roster_name = public.my_roster_name());

-- the old write policy was "for all" (it also let managers read every row): writes only
drop policy duty_assignments_write on public.duty_assignments;
create policy duty_assignments_insert on public.duty_assignments for insert to authenticated with check (public.is_manager());
create policy duty_assignments_update on public.duty_assignments for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy duty_assignments_delete on public.duty_assignments for delete to authenticated using (public.is_manager());

drop policy shift_requests_select on public.shift_requests;
create policy shift_requests_select on public.shift_requests for select to authenticated
  using ((public.is_manager() and (public.is_test_account() or not public.is_test_user(user_id)))
         or (public.is_active() and user_id = auth.uid()));

drop policy shift_changes_select on public.shift_changes;
create policy shift_changes_select on public.shift_changes for select to authenticated
  using ((public.is_manager() and (not is_test or public.is_test_account()))
         or (public.is_active() and (requester_id = auth.uid() or roster_name = public.my_roster_name())));

drop policy shift_offers_select on public.shift_offers;
create policy shift_offers_select on public.shift_offers for select to authenticated
  using ((public.is_manager() and (public.is_test_account() or not public.is_test_user(user_id)))
         or (public.is_active() and (roster_name = public.my_roster_name()
             or exists (select 1 from public.shift_changes c where c.id = change_id and c.roster_name = public.my_roster_name()))));

drop policy translation_log_select on public.translation_log;
create policy translation_log_select on public.translation_log for select to authenticated
  using (public.is_manager() and (public.is_test_account() or not public.is_test_user(user_id)));

-- a test account may change its own schedule rows (休みの承認・早退 on its own test reports),
-- never put a real person in or out
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
  if tg_table_name = 'shift_assignments'
     and (tg_op = 'INSERT' or (to_jsonb(old) ->> 'roster_name') = public.my_roster_name())
     and (tg_op = 'DELETE' or (to_jsonb(new) ->> 'roster_name') = public.my_roster_name()) then
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

-- ---- the test schedule is a nightly copy of a real person's

create table public.test_shadows (
  test_roster text primary key,
  source_roster text not null
);
alter table public.test_shadows enable row level security;
revoke all on public.test_shadows from anon, authenticated;

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
  s record;
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
  -- the test schedule again: a copy of the source person's shifts and duties
  for s in select * from public.test_shadows loop
    delete from public.shift_assignments where roster_name = s.test_roster;
    insert into public.shift_assignments (month, business_date, shift, roster_name, store_mark, store_id, start_min, end_min, raw, original_end_min)
    select month, business_date, shift, s.test_roster, store_mark, store_id, start_min, end_min, raw, original_end_min
    from public.shift_assignments where roster_name = s.source_roster;
    delete from public.duty_assignments where roster_name = s.test_roster;
    insert into public.duty_assignments (business_date, shift, store_id, roster_name, kind, time_mode, start_min, end_min, method, is_plan, staff)
    select business_date, shift, store_id, s.test_roster, kind, time_mode, start_min, end_min, method, is_plan, staff
    from public.duty_assignments where roster_name = s.source_roster;
  end loop;
  return n;
end $$;
revoke execute on function public.purge_test_account_data() from public, anon, authenticated;
