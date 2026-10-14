-- 朝礼 参加者: the names scheduled for one store / date / shift, listed first in the picker.
-- Active users may ask for yesterday … tomorrow (Tokyo) only; managers for any date.
-- Test accounts' shift-table names are left out.
create function public.slot_staff(p_store uuid, p_date date, p_shift text)
returns table (roster_name text, start_min int, end_min int)
language sql stable security definer set search_path = ''
as $$
  select a.roster_name, a.start_min, a.end_min
  from public.shift_assignments a
  where a.store_id = p_store and a.business_date = p_date and a.shift = p_shift
    and (public.is_manager()
         or (public.is_active()
             and p_date between (now() at time zone 'Asia/Tokyo')::date - 1 and (now() at time zone 'Asia/Tokyo')::date + 1))
    and not exists (select 1 from public.profiles t where t.is_test_account and t.roster_name = a.roster_name)
  order by a.start_min, a.roster_name
$$;

revoke execute on function public.slot_staff(uuid, date, text) from anon, public;
grant execute on function public.slot_staff(uuid, date, text) to authenticated;
