-- シフト表の自動取り込み (owner, 2026-10-17): the monthly workbook is shared from Office 365 (OneDrive link).
-- The Edge Function shift-sync downloads it every day at 6:00 JST (pg_cron shift-sync-daily) — or when a manager
-- taps 今すぐ取り込む — reads the 早番 / 中番 / 遅番 sheets and imports the month.
-- Every import (app or Office 365) is compared with the previous workbook of that month (the first time: with the
-- rows in the app) and the differences are kept in shift_import_log; managers see them on ダッシュボード.
-- A re-import now keeps: the 朝礼・巡回 extensions (original_end_min) of shifts the workbook did not change, approved
-- 休み・代わり (as before) and the test accounts' copied schedule (test_shadows).

create table public.shift_import_log (
  id bigint generated always as identity primary key,
  month date not null check (extract(day from month) = 1),
  source text not null check (source in ('app', 'office365')),
  imported_at timestamptz not null default now(),
  imported_by uuid references public.profiles (id) on delete set null,
  -- the workbook rows (baseline of the next comparison)
  rows jsonb not null,
  -- [{date, shift, name, kind: added | removed | changed, before, after}] (before / after = the cell, e.g. ①7-17)
  changes jsonb not null default '[]',
  n_changes int not null default 0
);
create index shift_import_log_month on public.shift_import_log (month, imported_at desc);
alter table public.shift_import_log enable row level security;
revoke all on public.shift_import_log from anon, authenticated;
grant select on public.shift_import_log to authenticated;
create policy shift_import_log_select on public.shift_import_log for select to authenticated using (public.is_manager());

-- managers read the link and the result of the last automatic run
drop policy if exists app_kv_manager_select on public.app_kv;
create policy app_kv_manager_select on public.app_kv for select to authenticated
  using (public.is_manager() and key in ('sheets_url', 'sheets_synced_at', 'shift_workbook_url', 'shift_sync_status'));

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
revoke execute on function public.apply_shift_import(date, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.apply_shift_import(date, jsonb, text, uuid) to service_role;

create or replace function public.import_shift_month(p_month date, p_rows jsonb)
returns int
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_manager() then
    raise exception 'managers only' using errcode = '42501';
  end if;
  return (public.apply_shift_import(p_month, p_rows, 'app', auth.uid()) ->> 'rows')::int;
end $$;

-- the Office 365 share link (managers, not test accounts)
create or replace function public.set_shift_workbook_url(p_url text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_manager() or public.is_test_account() then
    raise exception 'managers only' using errcode = '42501';
  end if;
  if p_url is null or btrim(p_url) = '' then
    delete from public.app_kv where key = 'shift_workbook_url';
    return;
  end if;
  if btrim(p_url) !~ '^https://[a-z0-9-]+(-my)?\.sharepoint\.com/' then
    raise exception 'invalid_url' using errcode = '22023';
  end if;
  insert into public.app_kv (key, value, updated_at) values ('shift_workbook_url', btrim(p_url), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;
revoke execute on function public.set_shift_workbook_url(text) from public, anon;
grant execute on function public.set_shift_workbook_url(text) to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('shift-sync-daily', '0 21 * * *', $job$
      select net.http_post(
        url := replace((select decrypted_secret from vault.decrypted_secrets where name = 'sheets_sync_url'), '/sync-sheets', '/shift-sync'),
        headers := jsonb_build_object('Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sheets_sync_secret')),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000)
    $job$);
  end if;
end $$;
