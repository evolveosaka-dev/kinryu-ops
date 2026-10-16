-- テスト管理者 (2026-10-16, owner): a manager whose changes only test accounts see.
-- = role manager + is_test_account + keep_test_data (their records are NOT purged at 4:00, unlike kinryutest).
-- Only a システム管理者 (role admin) may make or unmake one; admins see test accounts in 管理 → ユーザー.

alter table public.profiles add column if not exists keep_test_data boolean not null default false;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.profiles where id = auth.uid() and status = 'active' and role = 'admin') $$;
revoke execute on function public.is_admin() from anon, public;
grant execute on function public.is_admin() to authenticated;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or (public.is_manager() and (not is_test_account or public.is_test_account() or public.is_admin())));

-- a name on the real shift table (not a test copy): a test manager must not take it, or it would vanish for everyone
create or replace function public.is_real_roster(p text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.shift_assignments where roster_name = p)
     and not exists (select 1 from public.test_shadows where test_roster = p)
$$;
revoke execute on function public.is_real_roster(text) from anon, public;
grant execute on function public.is_real_roster(text) to authenticated;

create or replace function public.guard_profile_update() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.full_name is not null then
    new.full_name := regexp_replace(btrim(new.full_name), '\s+', ' ', 'g');
  end if;
  if auth.uid() is null then
    return new;
  end if;
  -- テスト管理者 / システム管理者: only admins give or take these
  if (new.is_test_account is distinct from old.is_test_account
      or new.keep_test_data is distinct from old.keep_test_data
      or (new.role is distinct from old.role and 'admin' in (new.role, old.role)))
     and not public.is_admin() then
    raise exception 'only a system admin can change test managers or admins' using errcode = '42501';
  end if;
  if new.is_test_account and (new.roster_name is distinct from old.roster_name or not old.is_test_account)
     and public.is_real_roster(new.roster_name) then
    raise exception 'a test manager cannot use a real shift-table name' using errcode = '23514';
  end if;
  if public.is_manager() then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.can_patrol is distinct from old.can_patrol
     or (new.status is distinct from old.status
         and not (old.status = 'rejected' and new.status = 'pending' and new.id = auth.uid()))
     or new.email is distinct from old.email
     or new.roster_name is distinct from old.roster_name
     or (new.home_store_id is distinct from old.home_store_id and old.status <> 'pending') then
    raise exception 'only managers can change role, permissions, status, store or shift-table name' using errcode = '42501';
  end if;
  if new.full_name is distinct from old.full_name and coalesce(btrim(old.full_name), '') <> '' then
    raise exception 'only managers can change the full name' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.purge_test_account_data() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  -- テスト管理者 (keep_test_data) keep what they made; only the other test accounts are purged
  testers uuid[] := array(select id from public.profiles where is_test_account and not keep_test_data);
  keepers uuid[] := array(select id from public.profiles where is_test_account and keep_test_data);
  chorei uuid[] := array(select id from public.chorei_records where (by_test_account and not coalesce(leader_id = any(keepers), false)) or leader_id = any(testers));
  patrol uuid[] := array(select id from public.patrol_checks where (by_test_account and not coalesce(patroller_id = any(keepers), false)) or patroller_id = any(testers));
  misses uuid[] := array(select id from public.chorei_misses where (by_test_account and not coalesce(reporter_id = any(keepers), false)) or reporter_id = any(testers));
  stock uuid[] := array(select id from public.stock_events where (by_test_account and not coalesce(author_id = any(keepers), false)));
  sales uuid[] := array(select id from public.sales_reports where by_test_account and not coalesce(submitted_by = any(keepers) or updated_by = any(keepers), false));
  changes uuid[] := array(select id from public.shift_changes where (is_test and not coalesce(requester_id = any(keepers), false)) or requester_id = any(testers));
  inc_ids uuid[] := array(select id from public.incidents where (by_test_account and not coalesce(reporter_id = any(keepers), false)) or reporter_id = any(testers));
  lost uuid[] := array(select id from public.lost_items where (by_test_account and not coalesce(reporter_id = any(keepers), false)) or reporter_id = any(testers));
  n int := 0;
  k int;
  s record;
begin
  delete from public.attachments where chorei_id = any(chorei) or patrol_id = any(patrol) or miss_id = any(misses) or stock_event_id = any(stock) or incident_id = any(inc_ids) or lost_item_id = any(lost) or owner_id = any(testers);
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
  delete from public.emergency_contact_log where (by_test_account and not coalesce(user_id = any(keepers), false)) or user_id = any(testers) or incident_id = any(inc_ids);
  delete from public.incidents where id = any(inc_ids);
  get diagnostics k = row_count; n := n + k;
  delete from public.lost_items where id = any(lost);
  get diagnostics k = row_count; n := n + k;
  delete from public.shift_requests where user_id = any(testers);
  delete from public.translation_log where user_id = any(testers);
  delete from public.audit_log where row_id = any(chorei || patrol || misses || stock || sales || changes || inc_ids || lost) or actor_id = any(testers);
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
