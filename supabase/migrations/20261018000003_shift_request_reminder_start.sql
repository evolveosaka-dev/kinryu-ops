-- シフト希望 reminders start on 2026-11-15 (owner, 2026-10-18): no reminder for the October deadline.

create or replace function public.queue_shift_request_reminders() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Tokyo')::date;
  next_month date := (date_trunc('month', (now() at time zone 'Asia/Tokyo')::date) + interval '1 month')::date;
  n int := 0;
  r record;
begin
  -- owner 2026-10-18: start with the deadline of December (reminders from 2026-11-15), none in October
  if today < date '2026-11-15' or extract(day from today) not in (15, 18, 20) then
    return 0;
  end if;
  for r in
    select p.id from public.profiles p
    where p.status = 'active' and p.roster_name is not null and not p.is_test_account
      and not exists (select 1 from public.shift_requests q where q.user_id = p.id and q.month = next_month)
  loop
    perform public.queue_push(r.id, 'shift_request',
      jsonb_build_object('month', extract(month from next_month)::int, 'deadline', extract(month from today)::int || '/20', 'last', extract(day from today) = 20),
      '/shift-request', false, 'sreq|' || r.id || '|' || today);
    n := n + 1;
  end loop;
  return n;
end $$;
