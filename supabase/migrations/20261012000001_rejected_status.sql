-- A manager can reject a sign-up (status 'rejected', not 'inactive' which is for staff who left).
-- The rejected user keeps the same account / e-mail and may apply again: the only status change
-- a non-manager may make is their own rejected → pending.

alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check
  check (status in ('pending', 'active', 'inactive', 'rejected'));

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
     or (new.status is distinct from old.status
         and not (old.status = 'rejected' and new.status = 'pending' and new.id = auth.uid()))
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
