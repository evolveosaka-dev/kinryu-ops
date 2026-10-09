-- 巡回 is limited to 15 minutes: a longer patrol, or one started without 終了 after
-- 15 minutes, is flagged for a manager to review (needs_time_review). Was 60 minutes.

create or replace function public.guard_patrol() returns trigger
language plpgsql set search_path = ''
as $$
declare
  limit_ts timestamptz := now() + interval '5 minutes';
begin
  if new.status = 'valid' and (tg_op = 'INSERT' or old.status = 'draft') then
    new.submitted_at := coalesce(new.submitted_at, now());
    if new.ended_at - new.started_at > interval '15 minutes' then
      new.needs_time_review := true;
    end if;
  end if;

  if public.is_manager() or auth.uid() is null then
    return new;
  end if;

  if new.business_date not between public.tokyo_today() - 1 and public.tokyo_today() + 1 then
    raise exception 'business_date out of range' using errcode = '22023';
  end if;
  if new.started_at > limit_ts or new.ended_at > limit_ts then
    raise exception 'times cannot be in the future' using errcode = '22023';
  end if;
  if new.status = 'void' or new.follow_up_done_at is not null then
    raise exception 'only managers can void or close follow-ups' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.needs_time_review := new.needs_time_review and new.status = 'valid'
      and new.ended_at - new.started_at > interval '15 minutes';
    if new.started_at < now() - interval '1 day' then
      raise exception 'started_at too old' using errcode = '22023';
    end if;
  else
    if new.patroller_id is distinct from old.patroller_id then
      raise exception 'cannot change patroller' using errcode = '42501';
    end if;
    if old.status = 'valid' and (
      new.started_at is distinct from old.started_at or new.ended_at is distinct from old.ended_at
      or new.status is distinct from old.status or new.needs_time_review is distinct from old.needs_time_review
    ) then
      raise exception 'only managers can correct patrol times' using errcode = '42501';
    end if;
    if old.status = 'draft' and new.started_at is distinct from old.started_at then
      raise exception 'cannot change start time' using errcode = '42501';
    end if;
    -- 終了 is recorded once on the draft and cannot be moved later
    if old.status = 'draft' and old.ended_at is not null and new.ended_at is distinct from old.ended_at then
      raise exception 'end time already recorded' using errcode = '42501';
    end if;
    if old.needs_time_review and not new.needs_time_review then
      raise exception 'only managers can clear the time review flag' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- Started (開始) but no 終了 after 15 minutes → flag (pg_cron runs this every 15 minutes).
create or replace function public.flag_open_patrols() returns int
language sql security definer set search_path = ''
as $$
  with flagged as (
    update public.patrol_checks
       set needs_time_review = true
     where status = 'draft' and ended_at is null and not needs_time_review
       and started_at < now() - interval '15 minutes'
    returning 1
  )
  select count(*)::int from flagged
$$;
revoke execute on function public.flag_open_patrols() from public, anon, authenticated;
