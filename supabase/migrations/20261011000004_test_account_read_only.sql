-- A test account may be given the manager role to look at the manager screens, but it can
-- change nothing: every write is refused except its own (nightly purged) test records and
-- its own language / display name. Enforced by a trigger, so RLS policies, security-definer
-- RPCs (import_shift_month, …) and manager screens are all covered.

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
  foreach t in array array['profiles', 'stores', 'bootstrap_accounts', 'target_bowls', 'holidays', 'chorei_records',
                           'chorei_notes', 'patrol_checks', 'attachments', 'app_kv', 'staff_roster', 'shift_requests',
                           'shift_assignments', 'duty_assignments']
  loop
    execute format('drop trigger if exists test_account_read_only on public.%I', t);
    execute format('create trigger test_account_read_only before insert or update or delete on public.%I
                    for each row execute function public.guard_test_account_writes()', t);
  end loop;
end $$;
