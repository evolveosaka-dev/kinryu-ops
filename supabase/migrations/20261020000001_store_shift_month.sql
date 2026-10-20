-- 全店舗シフト for every active user (owner, 2026-10-20; it was for managers only). Staff still read only their own
-- shift_assignments rows through RLS; this function gives one store's month (names and times only).
-- Test accounts' copied shifts stay hidden from real users, as in the RLS policy.
create function public.store_shift_month(p_store_mark text, p_month date)
returns table (id uuid, roster_name text, business_date date, shift text, store_mark text, start_min int, end_min int, original_end_min int)
language sql stable security definer set search_path = ''
as $$
  select a.id, a.roster_name, a.business_date, a.shift, a.store_mark, a.start_min, a.end_min, a.original_end_min
  from public.shift_assignments a
  where public.is_active()
    and a.month = p_month and a.store_mark = p_store_mark
    and (public.is_test_account() or not public.is_test_roster(a.roster_name))
  order by a.business_date, a.start_min, a.roster_name
$$;
revoke execute on function public.store_shift_month(text, date) from public, anon;
grant execute on function public.store_shift_month(text, date) to authenticated;
