-- Flag patrols that were started ("開始") but not finished within 60 minutes.
create function public.flag_open_patrols() returns int
language sql security definer set search_path = ''
as $$
  with flagged as (
    update public.patrol_checks
       set needs_time_review = true
     where status = 'draft' and not needs_time_review and started_at < now() - interval '60 minutes'
    returning 1
  )
  select count(*)::int from flagged
$$;
revoke execute on function public.flag_open_patrols() from public, anon, authenticated;

-- pg_cron is available on Supabase; skipped where it is not (e.g. unit tests).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('flag-open-patrols', '*/15 * * * *', 'select public.flag_open_patrols()');
  end if;
end $$;
