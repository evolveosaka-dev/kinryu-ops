-- ホーム notices after a shift-table import (owner, 2026-10-17):
--   staff: 「あなたのシフトが変わりました」 = their own rows of shift_import_log.changes (my_shift_changes);
--   managers: 朝礼・巡回 duties whose person no longer works at that time (orphan_duties) → give them to someone
--   else with a wheel (reassign_duties).
-- apply_shift_import: the first import of a month with nothing in the app is only the baseline (no 「変更」 for
-- everyone when next month's workbook appears).

create or replace function public.apply_shift_import(p_month date, p_rows jsonb, p_source text, p_by uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  base jsonb;
  ext jsonb;
  diff jsonb;
  n int;
  n_diff int;
  log_id bigint;
  shadow record;
begin
  p_rows := coalesce((select jsonb_agg(r) from jsonb_array_elements(p_rows) r
                      where date_trunc('month', (r ->> 'business_date')::date)::date = p_month), '[]');
  -- the previous workbook of the month, or the app's rows (shift-table end, test copies left out)
  select l.rows into base from public.shift_import_log l where l.month = p_month order by l.imported_at desc, l.id desc limit 1;
  if base is null then
    select coalesce(jsonb_agg(jsonb_build_object('business_date', a.business_date, 'shift', a.shift, 'roster_name', a.roster_name,
             'store_mark', a.store_mark, 'start_min', a.start_min, 'end_min', coalesce(a.original_end_min, a.end_min), 'raw', a.raw)), '[]')
      into base
    from public.shift_assignments a
    where a.month = p_month and not exists (select 1 from public.test_shadows t where t.test_roster = a.roster_name)
      and not public.is_test_roster(a.roster_name);
  end if;

  with o as (
    select r ->> 'business_date' d, r ->> 'shift' s, r ->> 'roster_name' nm, r ->> 'store_mark' m,
           (r ->> 'start_min')::int st, (r ->> 'end_min')::int en, r ->> 'raw' raw
    from jsonb_array_elements(base) r
  ), w as (
    select r ->> 'business_date' d, r ->> 'shift' s, r ->> 'roster_name' nm, r ->> 'store_mark' m,
           (r ->> 'start_min')::int st, (r ->> 'end_min')::int en, r ->> 'raw' raw
    from jsonb_array_elements(p_rows) r
  ), x as (
    select coalesce(w.d, o.d) d, coalesce(w.s, o.s) s, coalesce(w.nm, o.nm) nm,
           case when o.d is null then 'added' when w.d is null then 'removed' else 'changed' end kind,
           o.raw before, w.raw after
    from w full join o on o.d = w.d and o.s = w.s and o.nm = w.nm
    where o.d is null or w.d is null or (o.m, o.st, o.en) is distinct from (w.m, w.st, w.en)
  )
  select coalesce(jsonb_agg(jsonb_build_object('date', d, 'shift', s, 'name', nm, 'kind', kind, 'before', before, 'after', after)
                            order by d, array_position(array['early', 'middle', 'late'], s), nm), '[]'), count(*)
    into diff, n_diff
  from x;
  -- a month seen for the first time (nothing in the app yet) is the baseline, not a list of changes
  if jsonb_array_length(base) = 0 then
    diff := '[]';
    n_diff := 0;
  end if;

  -- extensions for the 朝礼・巡回 (scripts/duties-from-plan.mjs) survive when the workbook keeps that shift
  select coalesce(jsonb_agg(jsonb_build_object('d', a.business_date, 's', a.shift, 'nm', a.roster_name, 'st', a.start_min,
                                               'en', a.end_min, 'orig', a.original_end_min)), '[]')
    into ext
  from public.shift_assignments a where a.month = p_month and a.original_end_min is not null;

  delete from public.shift_assignments where month = p_month;
  insert into public.shift_assignments (month, business_date, shift, roster_name, store_mark, store_id, start_min, end_min, raw)
  select p_month, (r ->> 'business_date')::date, r ->> 'shift', r ->> 'roster_name', r ->> 'store_mark',
         (select st.id from public.stores st where st.code = case r ->> 'store_mark' when '①' then 'midosuji' when '⑤' then 'sennichimae' end),
         (r ->> 'start_min')::int, (r ->> 'end_min')::int, r ->> 'raw'
  from jsonb_array_elements(p_rows) r;
  get diagnostics n = row_count;
  update public.shift_assignments a
     set end_min = (e ->> 'en')::int, original_end_min = (e ->> 'orig')::int
    from jsonb_array_elements(ext) e
   where a.month = p_month and a.business_date = (e ->> 'd')::date and a.shift = e ->> 's' and a.roster_name = e ->> 'nm'
     and a.start_min = (e ->> 'st')::int and a.end_min = (e ->> 'orig')::int;
  insert into public.staff_roster (name)
  select distinct r ->> 'roster_name' from jsonb_array_elements(p_rows) r
  on conflict (name) do nothing;
  -- 休み・代わり already approved for this month
  perform public.apply_shift_change(c.id)
  from public.shift_changes c
  where c.status = 'approved'
    and (date_trunc('month', c.business_date)::date = p_month or date_trunc('month', c.give_date)::date = p_month)
  order by c.decided_at;
  -- the test accounts' copy of a real person's month
  for shadow in select * from public.test_shadows loop
    insert into public.shift_assignments (month, business_date, shift, roster_name, store_mark, store_id, start_min, end_min, raw, original_end_min)
    select month, business_date, shift, shadow.test_roster, store_mark, store_id, start_min, end_min, raw, original_end_min
    from public.shift_assignments where month = p_month and roster_name = shadow.source_roster
    on conflict (business_date, shift, roster_name) do nothing;
  end loop;

  if n_diff > 0 or not exists (select 1 from public.shift_import_log l where l.month = p_month) then
    insert into public.shift_import_log (month, source, imported_by, rows, changes, n_changes)
    values (p_month, p_source, p_by, p_rows, diff, n_diff)
    returning id into log_id;
  end if;
  perform public.check_visa_hours();
  return jsonb_build_object('rows', n, 'changes', n_diff, 'log_id', log_id);
end $$;

create or replace function public.my_shift_changes(p_days int default 7)
returns table (log_id bigint, imported_at timestamptz, business_date date, shift text, kind text, before text, after text)
language sql stable security definer set search_path = ''
as $$
  select l.id, l.imported_at, (c ->> 'date')::date, c ->> 'shift', c ->> 'kind', c ->> 'before', c ->> 'after'
  from public.shift_import_log l
  cross join lateral jsonb_array_elements(l.changes) c
  where public.is_active()
    and l.imported_at > now() - make_interval(days => least(greatest(p_days, 1), 31))
    and c ->> 'name' = (select p.roster_name from public.profiles p where p.id = auth.uid())
  order by l.imported_at desc, 3, 4
$$;
revoke execute on function public.my_shift_changes(int) from public, anon;
grant execute on function public.my_shift_changes(int) to authenticated;

-- a duty not finished yet whose person has no shift running at its start (shift table after changes)
create or replace function public.orphan_duties()
returns table (id uuid, business_date date, shift text, store_id uuid, roster_name text, kind text, time_mode text,
               start_min int, end_min int, method text)
language sql stable security definer set search_path = ''
as $$
  select d.id, d.business_date, d.shift, d.store_id, d.roster_name, d.kind, d.time_mode, d.start_min, d.end_min, d.method
  from public.duty_assignments d
  where public.is_manager()
    and (d.business_date::timestamp + make_interval(mins => d.end_min)) at time zone 'Asia/Tokyo' > now()
    and (public.is_test_account() or not public.is_test_roster(d.roster_name))
    and not exists (
      select 1 from public.shift_assignments a
      where a.roster_name = d.roster_name
        and a.business_date between d.business_date - 1 and d.business_date
        and (a.business_date - d.business_date) * 1440 + a.start_min <= d.start_min
        and (a.business_date - d.business_date) * 1440 + a.end_min > d.start_min)
  order by d.business_date, d.start_min, d.kind
$$;
revoke execute on function public.orphan_duties() from public, anon;
grant execute on function public.orphan_duties() to authenticated;

create or replace function public.reassign_duties(p_ids uuid[], p_roster text) returns int
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
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
  update public.duty_assignments set roster_name = p_roster where id = any(p_ids);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.reassign_duties(uuid[], text) from public, anon;
grant execute on function public.reassign_duties(uuid[], text) to authenticated;
