-- Full legal name (氏名) used for weekly / monthly aggregation. display_name stays the
-- short name written in the shift table. Staff set full_name once; later changes by managers only.

alter table public.profiles
  add column full_name text
  constraint profiles_full_name_length check (full_name is null or char_length(btrim(full_name)) between 2 and 100);

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
     or (new.home_store_id is distinct from old.home_store_id and old.status <> 'pending') then
    raise exception 'only managers can change role, permissions, status or store' using errcode = '42501';
  end if;
  if new.full_name is distinct from old.full_name and coalesce(btrim(old.full_name), '') <> '' then
    raise exception 'only managers can change the full name' using errcode = '42501';
  end if;
  return new;
end $$;

-- Email sign-up sends the full name as "entered_full_name". Google's own name is NOT used,
-- so Google users are asked to enter it in the app.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  boot public.bootstrap_accounts;
  entered text := regexp_replace(btrim(coalesce(new.raw_user_meta_data ->> 'entered_full_name', '')), '\s+', ' ', 'g');
begin
  select * into boot from public.bootstrap_accounts where email = lower(new.email);
  insert into public.profiles (id, email, display_name, full_name, role, can_patrol, status, locale)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', ''),
    case when char_length(entered) between 2 and 100 then entered end,
    coalesce(boot.role, 'staff'),
    coalesce(boot.can_patrol, false),
    case when boot.email is null then 'pending' else 'active' end,
    case when new.raw_user_meta_data ->> 'locale' in ('ja', 'en', 'si', 'ne', 'vi')
         then new.raw_user_meta_data ->> 'locale' else 'ja' end
  );
  return new;
end $$;

-- Directory now also returns the full name (for participant pickers and reports).
drop function public.staff_directory();
create function public.staff_directory()
returns table (id uuid, display_name text, full_name text, home_store_id uuid, can_patrol boolean)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.display_name, p.full_name, p.home_store_id, p.can_patrol
  from public.profiles p
  where public.is_active() and p.status = 'active'
  order by p.display_name
$$;
revoke execute on function public.staff_directory() from anon, public;
grant execute on function public.staff_directory() to authenticated, service_role;
