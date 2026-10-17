-- 担当の割り当て + 勤務延長 (owner, 2026-10-17): duties left without a person can go to someone of the shift
-- before (早番 → 中番's duties, 中番 → 遅番's, the previous night's 遅番 → 早番's) whose shift is extended to cover
-- them (shift_assignments.end_min, original_end_min keeps the shift-table end — the same 勤務延長 the staff see
-- in 次の勤務 / 勤務予定; a re-import keeps it while the workbook keeps that shift).

drop function if exists public.reassign_duties(uuid[], text);

create or replace function public.reassign_duties(p_ids uuid[], p_roster text, p_extend_date date default null,
                                                   p_extend_shift text default null, p_extend_end int default null)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
  a public.shift_assignments;
begin
  if not public.is_manager() or public.is_test_account() then
    raise exception 'managers only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.staff_roster r where r.name = p_roster) then
    raise exception 'unknown_name' using errcode = '22023';
  end if;
  if exists (select 1 from public.duty_assignments d join public.duty_assignments o
               on o.business_date = d.business_date and o.shift = d.shift and o.store_id = d.store_id and o.kind = d.kind
             where d.id = any(p_ids) and o.roster_name = p_roster and o.id <> d.id) then
    raise exception 'already_has_duty' using errcode = '23505';
  end if;
  if p_extend_end is not null then
    select * into a from public.shift_assignments s
    where s.roster_name = p_roster and s.business_date = p_extend_date and s.shift = p_extend_shift;
    if not found then
      raise exception 'no_shift' using errcode = '22023';
    end if;
    -- later than the shift-table end, at most 6 hours more
    if p_extend_end <= coalesce(a.original_end_min, a.end_min) or p_extend_end > coalesce(a.original_end_min, a.end_min) + 360
       or p_extend_end > 2880 then
      raise exception 'bad_extension' using errcode = '22023';
    end if;
    update public.shift_assignments
       set original_end_min = coalesce(original_end_min, end_min), end_min = p_extend_end
     where id = a.id;
  end if;
  update public.duty_assignments set roster_name = p_roster where id = any(p_ids);
  get diagnostics n = row_count;
  if p_extend_end is not null then
    perform public.check_visa_hours();
  end if;
  return n;
end $$;
revoke execute on function public.reassign_duties(uuid[], text, date, text, int) from public, anon;
grant execute on function public.reassign_duties(uuid[], text, date, text, int) to authenticated;
