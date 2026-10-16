-- 在庫・仕入 from a photo of the paper 日報 (2ページ表) (2026-10-16, owner):
-- * places: 仕込場・本店 is now shown as 相合橋本店 (code honten kept); new 道頓堀店 (dotonbori) for 受入 and 払出;
--   相合橋本店 also as a 払出 destination
-- * add_stock_event(p_partial): a 終わりの在庫 for only some items (items not on the paper are entered later)
-- * save_stock_sheet: every row read from one sheet in one transaction (繰越 recount, 受入 / 払出 per place,
--   終わりの在庫, temperatures)
-- * the photo of the sheet is attached to its 終わりの在庫 row (drive-upload accepts close rows)
-- * a handwritten standard that differs from 在庫の品目 → mail to the system admins (notify kind stock_standard)

drop function if exists public.add_stock_event(uuid, date, text, text, jsonb, text, text, numeric[], text, text, text);
drop function if exists public.add_stock_event(uuid, date, text, text, jsonb, text, text, numeric[], text, text, text, boolean);

create function public.add_stock_event(
  p_store uuid, p_date date, p_shift text, p_kind text,
  p_lines jsonb default '[]', p_place text default null, p_note text default null, p_temps numeric[] default null,
  p_reason text default null, p_note_original text default null, p_source_lang text default null,
  -- 終わりの在庫 for only some items (photo of the paper sheet: items not on the paper are entered later)
  p_partial boolean default false
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles;
  own_code text;
  fridges int;
  norm jsonb;
  n int;
  new_id uuid;
  today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'active';
  if me.id is null then
    raise exception 'active users only' using errcode = '42501';
  end if;
  if not public.is_manager() and p_date not between today - 1 and today + 1 then
    raise exception 'date out of range' using errcode = '22023';
  end if;
  if p_shift not in ('early', 'middle', 'late') then
    raise exception 'bad shift' using errcode = '22023';
  end if;
  select code, fridge_count into own_code, fridges from public.stores where id = p_store and active;
  if own_code is null then
    raise exception 'bad store' using errcode = '22023';
  end if;
  p_note := nullif(btrim(coalesce(p_note, '')), '');
  p_note_original := case when p_note is null then null else nullif(btrim(coalesce(p_note_original, '')), '') end;

  -- reasons: 繰越 recount and 廃棄・破損 only; その他 needs a note
  if p_kind = 'open' then
    if p_reason is null or p_reason not in ('miscount', 'unrecorded', 'unknown', 'no_record', 'other') then
      raise exception 'bad reason' using errcode = '22023';
    end if;
  elsif p_kind = 'loss' then
    if p_reason is null or p_reason not in ('dropped', 'spoiled', 'quality', 'mistake', 'other') then
      raise exception 'bad reason' using errcode = '22023';
    end if;
  else
    p_reason := null;
  end if;
  if p_reason = 'other' and p_note is null then
    raise exception 'note required for other' using errcode = '22023';
  end if;

  if p_kind in ('temp_start', 'temp_end') then
    if coalesce(array_length(p_temps, 1), 0) <> fridges or fridges = 0
       or exists (select 1 from unnest(p_temps) x where x is null or x < -30 or x > 40) then
      raise exception 'one temperature per fridge (-30…40)' using errcode = '22023';
    end if;
    norm := '[]';
    p_place := null;
  elsif p_kind in ('open', 'in', 'out', 'loss', 'close') then
    p_temps := null;
    if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
      raise exception 'no lines' using errcode = '22023';
    end if;
    select jsonb_agg(jsonb_build_object('item', i.id, 'qty', round((l ->> 'qty')::numeric, 1)) order by i.sort_order), count(*)
      into norm, n
      from jsonb_array_elements(p_lines) l
      join public.stock_items i on i.id = (l ->> 'item')::uuid and i.store_id = p_store and i.active
     where (l ->> 'qty')::numeric between 0 and 100000
       -- an amount that moves stock must be more than 0; counts may be 0
       and (p_kind in ('open', 'close') or (l ->> 'qty')::numeric > 0);
    if n is distinct from jsonb_array_length(p_lines)
       or n <> (select count(distinct l ->> 'item') from jsonb_array_elements(p_lines) l) then
      raise exception 'bad lines' using errcode = '22023';
    end if;
    if p_kind = 'in' then
      if p_place is null or p_place not in ('honten', 'sennichimae', 'midosuji', 'ebisubashi', 'dotonbori', 'warehouse', 'vendor') or p_place = own_code then
        raise exception 'bad place' using errcode = '22023';
      end if;
    elsif p_kind = 'out' then
      if p_place is null or p_place not in ('honten', 'midosuji', 'sennichimae', 'ebisubashi', 'dotonbori', 'other') or p_place = own_code then
        raise exception 'bad place' using errcode = '22023';
      end if;
      if p_place = 'other' and p_note is null then
        raise exception 'note required for other' using errcode = '22023';
      end if;
    else
      p_place := null;
      if p_kind = 'close' and not p_partial and n <> (select count(*) from public.stock_items where store_id = p_store and active) then
        raise exception 'count every item' using errcode = '22023';
      end if;
    end if;
  else
    raise exception 'bad kind' using errcode = '22023';
  end if;

  insert into public.stock_events (store_id, business_date, shift, kind, place, note, lines, temps, author_id, author_name,
                                   by_test_account, reason, note_original, source_lang)
  values (p_store, p_date, p_shift, p_kind, p_place, p_note, norm, p_temps, me.id,
          coalesce(nullif(btrim(me.display_name), ''), me.full_name, '—'), public.is_test_account(),
          p_reason, p_note_original, case when p_note_original is null then null else p_source_lang end)
  returning id into new_id;
  return new_id;
end $$;
revoke execute on function public.add_stock_event(uuid, date, text, text, jsonb, text, text, numeric[], text, text, text, boolean) from anon, public;
grant execute on function public.add_stock_event(uuid, date, text, text, jsonb, text, text, numeric[], text, text, text, boolean) to authenticated;

-- a manager's correction of a 終わりの在庫 keeps working when the row it replaces is partial
create or replace function public.replace_stock_event(
  p_id uuid, p_lines jsonb default '[]', p_place text default null, p_note text default null, p_temps numeric[] default null,
  p_reason text default null, p_note_original text default null, p_source_lang text default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  old public.stock_events;
  me public.profiles;
  my_name text;
  new_id uuid;
begin
  if not public.is_manager() then
    raise exception 'managers only' using errcode = '42501';
  end if;
  select * into me from public.profiles where id = auth.uid();
  my_name := coalesce(nullif(btrim(me.display_name), ''), me.full_name, '—');
  select * into old from public.stock_events where id = p_id for update;
  if not found or old.voided_at is not null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if old.by_test_account <> public.is_test_account() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  new_id := public.add_stock_event(old.store_id, old.business_date, old.shift, old.kind, p_lines, p_place, p_note, p_temps,
                                   p_reason, p_note_original, p_source_lang, old.kind = 'close');
  update public.stock_events
     set author_id = old.author_id, author_name = old.author_name, created_at = old.created_at,
         replaces = old.id, edited_by = me.id, edited_by_name = my_name
   where id = new_id;
  update public.stock_events set voided_at = now(), voided_by = me.id, voided_by_name = my_name where id = old.id;
  update public.attachments set stock_event_id = new_id where stock_event_id = old.id;
  return new_id;
end $$;
revoke execute on function public.replace_stock_event(uuid, jsonb, text, text, numeric[], text, text, text) from public, anon;
grant execute on function public.replace_stock_event(uuid, jsonb, text, text, numeric[], text, text, text) to authenticated;

-- One paper sheet → its rows, all or nothing. p_sheet:
--   { open: {lines, reason, note} | null, ins: [{place, note, lines}], outs: [{place, note, lines}],
--     close: [{item, qty}], temps_start: [..] | null, temps_end: [..] | null }
-- Returns the id of the 終わりの在庫 row (the photo of the sheet is attached to it).
create or replace function public.save_stock_sheet(p_store uuid, p_date date, p_shift text, p_sheet jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  m jsonb;
  close_id uuid;
begin
  if jsonb_typeof(p_sheet -> 'close') is distinct from 'array' or jsonb_array_length(p_sheet -> 'close') = 0 then
    raise exception 'no lines' using errcode = '22023';
  end if;
  if jsonb_typeof(p_sheet -> 'open') = 'object' and jsonb_array_length(coalesce(p_sheet -> 'open' -> 'lines', '[]')) > 0 then
    perform public.add_stock_event(p_store, p_date, p_shift, 'open', p_sheet -> 'open' -> 'lines', null,
                                   p_sheet -> 'open' ->> 'note', null, p_sheet -> 'open' ->> 'reason');
  end if;
  for m in select * from jsonb_array_elements(coalesce(p_sheet -> 'ins', '[]')) loop
    perform public.add_stock_event(p_store, p_date, p_shift, 'in', m -> 'lines', m ->> 'place', m ->> 'note');
  end loop;
  for m in select * from jsonb_array_elements(coalesce(p_sheet -> 'outs', '[]')) loop
    perform public.add_stock_event(p_store, p_date, p_shift, 'out', m -> 'lines', m ->> 'place', m ->> 'note');
  end loop;
  close_id := public.add_stock_event(p_store, p_date, p_shift, 'close', p_sheet -> 'close', null, null, null,
                                     null, null, null, true);
  if jsonb_typeof(p_sheet -> 'temps_start') = 'array' then
    perform public.add_stock_event(p_store, p_date, p_shift, 'temp_start', '[]', null, null,
                                   array(select x::numeric from jsonb_array_elements_text(p_sheet -> 'temps_start') x));
  end if;
  if jsonb_typeof(p_sheet -> 'temps_end') = 'array' then
    perform public.add_stock_event(p_store, p_date, p_shift, 'temp_end', '[]', null, null,
                                   array(select x::numeric from jsonb_array_elements_text(p_sheet -> 'temps_end') x));
  end if;
  return close_id;
end $$;
revoke execute on function public.save_stock_sheet(uuid, date, text, jsonb) from public, anon;
grant execute on function public.save_stock_sheet(uuid, date, text, jsonb) to authenticated;

-- 基準在庫 written on the paper ≠ 在庫の品目 → the system admins are told (once per sheet)
alter table public.notify_events drop constraint if exists notify_events_kind_check;
alter table public.notify_events add constraint notify_events_kind_check check (kind in ('chorei', 'chorei_note', 'patrol', 'shift_request', 'signup', 'edit', 'staff_alert', 'stock', 'sales', 'shift_change', 'visa_hours', 'incident', 'lost_item', 'stock_standard'));

-- p_rows: [{item, paper, text}] (paper = the handwritten standard in the item's unit)
create or replace function public.report_stock_standards(p_event uuid, p_rows jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  ev public.stock_events;
begin
  select * into ev from public.stock_events where id = p_event and author_id = auth.uid() and kind = 'close' and voided_at is null;
  if ev.id is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 50 then
    raise exception 'bad rows' using errcode = '22023';
  end if;
  if ev.by_test_account then
    return;
  end if;
  perform public.add_notify_event('stock_standard', 'stock_events', ev.id, false, jsonb_build_object('rows', p_rows),
                                  'stock_standard:' || ev.id);
end $$;
revoke execute on function public.report_stock_standards(uuid, jsonb) from public, anon;
grant execute on function public.report_stock_standards(uuid, jsonb) to authenticated;
