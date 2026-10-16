-- Myanmar (Burmese, `my`) as a 6th language (owner, 2026-10-17): staff may choose it.

alter table public.profiles drop constraint if exists profiles_locale_check;
alter table public.profiles add constraint profiles_locale_check check (locale in ('ja', 'en', 'si', 'ne', 'vi', 'my'));

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
    case when new.raw_user_meta_data ->> 'locale' in ('ja', 'en', 'si', 'ne', 'vi', 'my')
         then new.raw_user_meta_data ->> 'locale' else 'ja' end
  );
  return new;
end $$;
