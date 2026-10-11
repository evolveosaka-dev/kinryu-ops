-- Test accounts (profiles.is_test_account, set by a manager / SQL only). Everything such an
-- account records is test data: labelled is_test, kept apart from the real records (it never
-- takes the 朝礼 slot, never shows as handover or as a coworker, never ticks a real 担当) and
-- deleted every night at 4:00 JST by purge_test_account_data().

alter table public.profiles add column if not exists is_test_account boolean not null default false;
alter table public.chorei_records add column if not exists by_test_account boolean not null default false;
alter table public.patrol_checks add column if not exists by_test_account boolean not null default false;

create or replace function public.is_test_account() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select is_test_account from public.profiles where id = auth.uid()), false) $$;
revoke execute on function public.is_test_account() from anon, public;
grant execute on function public.is_test_account() to authenticated;

-- is_test = before the operation start or written by a test account
create or replace function public.set_test_flag() returns trigger
language plpgsql set search_path = ''
as $$
declare
  owner uuid;
begin
  if tg_table_name = 'chorei_records' then
    owner := new.leader_id;
  else
    owner := new.patroller_id;
  end if;
  new.by_test_account := coalesce((select is_test_account from public.profiles where id = owner), false);
  new.is_test := new.business_date < date '2026-10-12' or new.by_test_account;
  return new;
end $$;

-- one real 朝礼 per slot; test-account records never block it
drop index if exists public.chorei_one_per_slot;
create unique index chorei_one_per_slot on public.chorei_records (store_id, business_date, shift)
  where status = 'valid' and not by_test_account;

-- the slot as seen by the caller: a test account only meets its own test records,
-- real staff never see test-account records (existing record / handover)
create or replace function public.chorei_slot(p_store uuid, p_date date, p_shift text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  prev_date date := case when p_shift = 'early' then p_date - 1 else p_date end;
  prev_shift text := case p_shift when 'early' then 'late' when 'middle' then 'early' else 'middle' end;
  tester boolean := public.is_test_account();
  existing jsonb;
  previous jsonb;
begin
  if not public.is_active() then
    return null;
  end if;
  select jsonb_build_object('id', c.id, 'leader', p.display_name, 'submitted_at', c.submitted_at)
    into existing
    from public.chorei_records c join public.profiles p on p.id = c.leader_id
   where c.store_id = p_store and c.business_date = p_date and c.shift = p_shift and c.status = 'valid'
     and c.by_test_account = tester
   order by c.submitted_at desc
   limit 1;
  select jsonb_build_object(
           'id', c.id, 'business_date', c.business_date, 'shift', c.shift, 'leader', p.display_name,
           'stock_none', c.stock_none, 'stock_text', c.stock_text, 'target_bowls', c.target_bowls,
           'caution_text', c.caution_text, 'submitted_at', c.submitted_at,
           'notes', coalesce((select jsonb_agg(jsonb_build_object('body', n.body, 'author', a.display_name) order by n.created_at)
                              from public.chorei_notes n join public.profiles a on a.id = n.author_id
                              where n.chorei_id = c.id and (tester or not a.is_test_account)), '[]'))
    into previous
    from public.chorei_records c join public.profiles p on p.id = c.leader_id
   where c.store_id = p_store and c.business_date = prev_date and c.shift = prev_shift and c.status = 'valid'
     and (tester or not c.by_test_account)
   order by c.by_test_account, c.submitted_at desc
   limit 1;
  return jsonb_build_object('existing', existing, 'previous', previous);
end $$;

-- test accounts may add notes only to their own test records
create or replace function public.add_chorei_note(p_chorei uuid, p_body text, p_original text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  new_id uuid;
begin
  if not public.is_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.chorei_records where id = p_chorei and status = 'valid'
                  and (not public.is_test_account() or by_test_account)) then
    raise exception 'record not found' using errcode = 'P0002';
  end if;
  insert into public.chorei_notes (chorei_id, author_id, body, original_body)
  values (p_chorei, auth.uid(), p_body, nullif(btrim(p_original), ''))
  returning id into new_id;
  return new_id;
end $$;

-- 担当 done: real staff count only real records; a test account only its own
create or replace function public.my_duties(p_from date, p_to date)
returns table (
  id uuid, business_date date, shift text, store_id uuid, kind text, time_mode text,
  start_min int, end_min int, method text, is_plan boolean, staff text, done boolean
)
language sql stable security definer set search_path = ''
as $$
  select d.id, d.business_date, d.shift, d.store_id, d.kind, d.time_mode, d.start_min, d.end_min,
         d.method, d.is_plan, d.staff,
         case d.kind
           when 'chorei' then exists (
             select 1 from public.chorei_records c
              where c.store_id = d.store_id and c.business_date = d.business_date
                and c.shift = d.shift and c.status = 'valid'
                and c.by_test_account = public.is_test_account())
           else exists (
             select 1 from public.patrol_checks p
              where p.patroller_id = auth.uid() and p.store_id = d.store_id
                and p.business_date = d.business_date and p.shift = d.shift and p.status = 'valid')
         end
    from public.duty_assignments d
   where d.roster_name = public.my_roster_name()
     and d.business_date between p_from and p_to
   order by d.business_date, d.start_min, d.kind
$$;

-- coworkers never include the shift-table names of test accounts
create or replace function public.shift_coworkers(p_date date, p_shift text)
returns table (roster_name text, start_min int, end_min int, store_mark text)
language sql stable security definer set search_path = ''
as $$
  select o.roster_name, o.start_min, o.end_min, o.store_mark
  from public.shift_assignments mine
  join public.shift_assignments o
    on o.business_date = mine.business_date and o.shift = mine.shift and o.store_mark = mine.store_mark
  where mine.roster_name = public.my_roster_name()
    and mine.business_date = p_date and mine.shift = p_shift
    and o.roster_name <> mine.roster_name
    and not exists (select 1 from public.profiles t where t.is_test_account and t.roster_name = o.roster_name)
  order by o.start_min, o.roster_name
$$;

-- only managers set the test flag (otherwise as before)
create or replace function public.guard_profile_update() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.full_name is not null then
    new.full_name := regexp_replace(btrim(new.full_name), '\s+', ' ', 'g');
  end if;
  if public.is_manager() or auth.uid() is null then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.can_patrol is distinct from old.can_patrol
     or new.status is distinct from old.status
     or new.email is distinct from old.email
     or new.roster_name is distinct from old.roster_name
     or new.is_test_account is distinct from old.is_test_account
     or (new.home_store_id is distinct from old.home_store_id and old.status <> 'pending') then
    raise exception 'only managers can change role, permissions, status, store or shift-table name' using errcode = '42501';
  end if;
  if new.full_name is distinct from old.full_name and coalesce(btrim(old.full_name), '') <> '' then
    raise exception 'only managers can change the full name' using errcode = '42501';
  end if;
  return new;
end $$;

-- Delete everything the test accounts recorded (their profile, 担当 and shifts stay).
create or replace function public.purge_test_account_data() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  testers uuid[] := array(select id from public.profiles where is_test_account);
  chorei uuid[] := array(select id from public.chorei_records where by_test_account or leader_id = any(testers));
  patrol uuid[] := array(select id from public.patrol_checks where by_test_account or patroller_id = any(testers));
  n int := 0;
  k int;
begin
  delete from public.attachments where chorei_id = any(chorei) or patrol_id = any(patrol) or owner_id = any(testers);
  delete from public.chorei_notes where chorei_id = any(chorei) or author_id = any(testers);
  delete from public.chorei_records where id = any(chorei);
  get diagnostics k = row_count; n := n + k;
  delete from public.patrol_checks where id = any(patrol);
  get diagnostics k = row_count; n := n + k;
  delete from public.shift_requests where user_id = any(testers);
  delete from public.translation_log where user_id = any(testers);
  delete from public.audit_log where row_id = any(chorei || patrol) or actor_id = any(testers);
  return n;
end $$;
revoke execute on function public.purge_test_account_data() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('purge-test-accounts', '0 19 * * *', 'select public.purge_test_account_data()'); -- 4:00 JST
  end if;
end $$;
