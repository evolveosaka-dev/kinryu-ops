-- 代わりの人を指名 (owner, 2026-10-15): the form lists first the people who marked that shift
-- 出勤できる in their シフト希望 for the month but are not scheduled for it, each with the reason
-- they cannot take it (busy / over 28 h, from cover_problem). Only the caller's own shift; names and
-- the chosen times only — never anything else from other people's requests.

create function public.available_covers(p_date date, p_shift text, p_leave_min int default null)
returns table (roster_name text, choice text, until_1730 boolean, problem jsonb)
language plpgsql stable security definer set search_path = ''
as $$
declare
  me text := public.my_roster_name();
  a public.shift_assignments;
begin
  if not public.is_active() or me is null then
    raise exception 'no shift-table name' using errcode = '42501';
  end if;
  select * into a from public.shift_assignments s where s.roster_name = me and s.business_date = p_date and s.shift = p_shift;
  if not found then
    raise exception 'no such shift' using errcode = '22023';
  end if;
  return query
    select p.roster_name,
           r.days -> p_date::text ->> p_shift,
           coalesce((r.days -> p_date::text ->> 'early_until_1730')::boolean, false),
           public.cover_problem(p.roster_name, me, p_date, coalesce(p_leave_min, a.start_min), a.end_min)
    from public.shift_requests r
    join public.profiles p on p.id = r.user_id
    where r.month = date_trunc('month', p_date)::date
      and p.status = 'active' and not p.is_test_account
      and p.roster_name is not null and p.roster_name <> me
      and coalesce(r.days -> p_date::text ->> p_shift, '') <> ''
      and not exists (select 1 from public.shift_assignments x
                      where x.roster_name = p.roster_name and x.business_date = p_date and x.shift = p_shift)
    order by (public.cover_problem(p.roster_name, me, p_date, coalesce(p_leave_min, a.start_min), a.end_min) is not null), p.roster_name;
end $$;
revoke execute on function public.available_covers(date, text, int) from anon, public;
grant execute on function public.available_covers(date, text, int) to authenticated;
