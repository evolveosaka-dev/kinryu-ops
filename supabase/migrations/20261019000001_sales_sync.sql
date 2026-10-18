-- 販売杯数 from Office 365 (owner, 2026-10-19): the workbook 「金龍売り上げ杯数」 (sheet ★拝数入力シート, columns G–L) is
-- shared like the shift workbook; shift-sync downloads it at the same time (6:00 JST, or 今すぐ取り込む) and calls
-- apply_sales_import. The file is only read, never changed.
-- Rules: a figure from a sent 販売日報 (source 'report') always wins; Excel figures are added or updated; a cell
-- emptied in the file never deletes a figure; a file with far fewer figures than the app has is refused.

create or replace function public.set_sales_workbook_url(p_url text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_manager() or public.is_test_account() then
    raise exception 'managers only' using errcode = '42501';
  end if;
  if p_url is null or btrim(p_url) = '' then
    delete from public.app_kv where key = 'sales_workbook_url';
    return;
  end if;
  if btrim(p_url) !~ '^https://[a-z0-9-]+(-my)?\.sharepoint\.com/' then
    raise exception 'invalid_url' using errcode = '22023';
  end if;
  insert into public.app_kv (key, value, updated_at) values ('sales_workbook_url', btrim(p_url), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;
revoke execute on function public.set_sales_workbook_url(text) from public, anon;
grant execute on function public.set_sales_workbook_url(text) to authenticated;

-- p_rows = [{date, store (code), shift, bowls}] → {rows, added, changed, same, report, changes: [{date, store, shift, kind, before, after}]}
create or replace function public.apply_sales_import(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_have int;
  v_rows int := 0;
  v_added int := 0;
  v_changed int := 0;
  v_same int := 0;
  v_report int := 0;
  v_changes jsonb := '[]'::jsonb;
  v_old record;
  r record;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be an array' using errcode = '22023';
  end if;
  select count(*) into v_have from public.daily_sales where source = 'excel' and business_date >= date '2025-01-01';
  if jsonb_array_length(p_rows) < v_have * 0.9 then
    raise exception 'only % figures in the file (the app has % from the Excel); not imported', jsonb_array_length(p_rows), v_have
      using errcode = '22023';
  end if;
  for r in
    select (x ->> 'date')::date as d, s.id as store_id, s.code, x ->> 'shift' as shift, (x ->> 'bowls')::int as bowls
    from jsonb_array_elements(p_rows) x
    join public.stores s on s.code = x ->> 'store'
    where x ->> 'shift' in ('early', 'middle', 'late')
      and (x ->> 'bowls')::int between 0 and 100000
      and (x ->> 'date')::date >= date '2025-01-01'
      and (x ->> 'date')::date <= (now() at time zone 'Asia/Tokyo')::date
  loop
    v_rows := v_rows + 1;
    select bowls, source into v_old from public.daily_sales where store_id = r.store_id and business_date = r.d and shift = r.shift;
    if not found then
      insert into public.daily_sales (store_id, business_date, shift, bowls, source) values (r.store_id, r.d, r.shift, r.bowls, 'excel');
      v_added := v_added + 1;
      v_changes := v_changes || jsonb_build_object('date', r.d, 'store', r.code, 'shift', r.shift, 'kind', 'added', 'before', null, 'after', r.bowls);
    elsif v_old.source = 'report' then
      v_report := v_report + 1;
    elsif v_old.bowls = r.bowls then
      v_same := v_same + 1;
    else
      update public.daily_sales set bowls = r.bowls, updated_at = now() where store_id = r.store_id and business_date = r.d and shift = r.shift;
      v_changed := v_changed + 1;
      v_changes := v_changes || jsonb_build_object('date', r.d, 'store', r.code, 'shift', r.shift, 'kind', 'changed', 'before', v_old.bowls, 'after', r.bowls);
    end if;
  end loop;
  -- newest first, at most 60 kept in the status
  select coalesce(jsonb_agg(c order by c ->> 'date' desc, c ->> 'store', c ->> 'shift'), '[]'::jsonb) into v_changes
  from (select c from jsonb_array_elements(v_changes) c order by c ->> 'date' desc limit 60) x;
  return jsonb_build_object('rows', v_rows, 'added', v_added, 'changed', v_changed, 'same', v_same, 'report', v_report, 'changes', v_changes);
end $$;
revoke execute on function public.apply_sales_import(jsonb) from public, anon, authenticated;
