-- 在庫・仕入: a reason for 繰越 recounts, a new kind 'loss' (廃棄・破損) with a reason and optional photos,
-- and both in the 7:30 summary mail (notify kind 'stock').
-- 使用 = 繰越 + 受入 − 払出 − 廃棄 − 残り.

alter table public.stock_events drop constraint stock_events_kind_check;
alter table public.stock_events add constraint stock_events_kind_check
  check (kind in ('open', 'in', 'out', 'loss', 'close', 'temp_start', 'temp_end'));
alter table public.stock_events
  add column reason text check (reason in ('miscount', 'unrecorded', 'unknown', 'no_record', 'dropped', 'spoiled', 'quality', 'mistake', 'other')),
  -- the note as written when it was translated to Japanese
  add column note_original text check (char_length(note_original) <= 1000),
  add column source_lang text;
-- rows written before this migration have no reason
alter table public.stock_events add constraint stock_events_reason_needed
  check (kind not in ('open', 'loss') or reason is not null) not valid;

drop function public.add_stock_event(uuid, date, text, text, jsonb, text, text, numeric[]);

create function public.add_stock_event(
  p_store uuid, p_date date, p_shift text, p_kind text,
  p_lines jsonb default '[]', p_place text default null, p_note text default null, p_temps numeric[] default null,
  p_reason text default null, p_note_original text default null, p_source_lang text default null
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
      if p_place is null or p_place not in ('honten', 'sennichimae', 'midosuji', 'ebisubashi', 'warehouse', 'vendor') or p_place = own_code then
        raise exception 'bad place' using errcode = '22023';
      end if;
    elsif p_kind = 'out' then
      if p_place is null or p_place not in ('midosuji', 'sennichimae', 'ebisubashi', 'other') or p_place = own_code then
        raise exception 'bad place' using errcode = '22023';
      end if;
      if p_place = 'other' and p_note is null then
        raise exception 'note required for other' using errcode = '22023';
      end if;
    else
      p_place := null;
      if p_kind = 'close' and n <> (select count(*) from public.stock_items where store_id = p_store and active) then
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

revoke execute on function public.add_stock_event(uuid, date, text, text, jsonb, text, text, numeric[], text, text, text) from anon, public;
grant execute on function public.add_stock_event(uuid, date, text, text, jsonb, text, text, numeric[], text, text, text) to authenticated;

-- photos / videos of a 廃棄・破損 row (Google Drive, through drive-upload parentType 'stock')
alter table public.attachments
  add column stock_event_id uuid references public.stock_events (id) on delete cascade;
alter table public.attachments drop constraint attachment_one_parent;
alter table public.attachments add constraint attachment_one_parent
  check (num_nonnulls(chorei_id, patrol_id, miss_id, stock_event_id) = 1);
create index attachments_stock on public.attachments (stock_event_id) where stock_event_id is not null;

-- Max 5 photos + 3 videos per record or report. Keep in sync with src/lib/media.ts MAX_VIDEOS.
create or replace function public.check_attachment_limits() returns trigger
language plpgsql set search_path = ''
as $$
declare
  n int;
begin
  select count(*) into n
    from public.attachments a
   where a.kind = new.kind
     and a.status in ('pending', 'uploaded')
     and a.id <> new.id
     and (a.chorei_id = new.chorei_id or a.patrol_id = new.patrol_id or a.miss_id = new.miss_id
          or a.stock_event_id = new.stock_event_id);
  if (new.kind = 'image' and n >= 5) or (new.kind = 'video' and n >= 3) then
    raise exception 'attachment limit reached' using errcode = '23514';
  end if;
  return new;
end $$;

-- notifications: kind 'stock' (繰越 recount, 廃棄・破損), only in the 7:30 summary; on for every current recipient
alter table public.notify_events drop constraint if exists notify_events_kind_check;
alter table public.notify_events add constraint notify_events_kind_check
  check (kind in ('chorei', 'chorei_note', 'patrol', 'shift_request', 'signup', 'edit', 'staff_alert', 'stock'));
alter table public.notify_recipients drop constraint if exists notify_recipients_kinds_check;
alter table public.notify_recipients add constraint notify_recipients_kinds_check
  check (kinds <@ array['chorei', 'chorei_note', 'patrol', 'shift_request', 'signup', 'edit', 'staff_alert', 'stock']);
alter table public.notify_recipients alter column kinds
  set default array['chorei', 'chorei_note', 'patrol', 'shift_request', 'signup', 'edit', 'staff_alert', 'stock'];
update public.notify_recipients set kinds = kinds || array['stock'] where not ('stock' = any(kinds));

create function public.notify_stock_event() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.kind in ('open', 'loss') and not new.by_test_account then
    perform public.add_notify_event('stock', 'stock_events', new.id);
  end if;
  return new;
end $$;
create trigger stock_events_notify after insert on public.stock_events
  for each row execute function public.notify_stock_event();
