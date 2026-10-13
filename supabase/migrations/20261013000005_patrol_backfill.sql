-- 管理 → 巡回一覧 「巡回を後から記録」: a manager records a past patrol for a patrol member
-- (patroller_id = that member, so 巡回時間 / pay stay with them) with typed start / end times.

alter table public.patrol_checks
  add column manager_note text check (char_length(manager_note) <= 2000),
  add column entered_by_manager boolean not null default false;

-- managers may insert for any active patrol member
create policy patrol_insert_manager on public.patrol_checks for insert to authenticated
  with check (
    public.is_manager()
    and exists (select 1 from public.profiles p where p.id = patroller_id and p.can_patrol and p.status = 'active')
  );

-- only managers set the two columns; a manager's own entry needs no 時間の確認
-- (named to run after patrol_guard, which flags > 15 minutes)
create or replace function public.guard_patrol_manager_fields() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_manager() then
    if tg_op = 'INSERT' then
      new.entered_by_manager := false;
      new.manager_note := null;
    else
      new.entered_by_manager := old.entered_by_manager;
      new.manager_note := old.manager_note;
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' and new.entered_by_manager then
    new.needs_time_review := false;
  end if;
  return new;
end $$;
create trigger patrol_zz_manager_fields before insert or update on public.patrol_checks
  for each row execute function public.guard_patrol_manager_fields();
