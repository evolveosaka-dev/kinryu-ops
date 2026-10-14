-- Owner, 2026-10-16:
--  1. 朝礼 records sent without 目標杯数 get it from 管理 → 設定 → 目標杯数 (the app works out the day type and
--     events, like the 朝礼 form, and calls fill_chorei_targets). No mail for this fill.
--  2. Managers correct everything staff entered: 休み・遅刻・早退の連絡 (manager_edit_shift_change) and
--     在庫・仕入 rows (replace_stock_event); the other tables were already open to managers.
--  3. Every manager comment / note is translated to Japanese after the writer confirms the Japanese;
--     the text as written is kept in manager_text_originals.

-- ---- 1. 目標杯数 for 朝礼 records without one

-- notify_on_record as before, but silent while app.quiet_notify = 'on' (set by fill_chorei_targets)
create or replace function public.notify_on_record() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  is_patrol boolean := tg_table_name = 'patrol_checks';
  changes jsonb;
begin
  if new.is_test or new.by_test_account or current_setting('app.quiet_notify', true) = 'on' then
    return new;
  end if;
  -- a new report: 朝礼 inserted, or 巡回 finalised (inserted valid or draft → valid)
  if new.status = 'valid' and (tg_op = 'INSERT' or (is_patrol and old.status = 'draft')) then
    perform public.add_notify_event(
      case when is_patrol then 'patrol' else 'chorei' end, tg_table_name, new.id,
      is_patrol and to_jsonb(new) ->> 'judgement' = 'coaching');
    return new;
  end if;
  -- a manager's edit / void of a submitted report
  if tg_op = 'UPDATE' and old.status <> 'draft' and auth.uid() is not null and public.is_manager() then
    changes := public.notify_changes(to_jsonb(old), to_jsonb(new));
    if changes <> '{}' then
      perform public.add_notify_event('edit', tg_table_name, new.id, false, jsonb_build_object(
        'action', case
          when new.status = 'void' and old.status <> 'void' then 'void'
          when changes ? 'follow_up_done_at' then 'follow_up'
          when changes ? 'started_at' or changes ? 'ended_at' or changes ? 'needs_time_review' then 'time'
          else 'update' end,
        'changes', changes));
    end if;
  end if;
  return new;
end $$;

-- p_rows: [{ "id": "<chorei_records.id>", "bowls": 187 }]; only rows still without a target change.
create or replace function public.fill_chorei_targets(p_rows jsonb) returns int
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  if not public.is_manager() then
    raise exception 'managers only' using errcode = '42501';
  end if;
  if public.is_test_account() then
    return 0;
  end if;
  perform set_config('app.quiet_notify', 'on', true);
  update public.chorei_records c
     set target_bowls = x.bowls
    from jsonb_to_recordset(coalesce(p_rows, '[]')) as x (id uuid, bowls int)
   where c.id = x.id and c.target_bowls is null and x.bowls between 0 and 100000
     and not c.by_test_account;
  get diagnostics n = row_count;
  perform set_config('app.quiet_notify', 'off', true);
  -- 修正の履歴 shows these as automatic, not as the manager's edit
  update public.audit_log set action = 'auto_target'
   where table_name = 'chorei_records' and at = now() and actor_id is not distinct from auth.uid() and diff ? 'target_bowls';
  return n;
end $$;
revoke execute on function public.fill_chorei_targets(jsonb) from public, anon;
grant execute on function public.fill_chorei_targets(jsonb) to authenticated;

-- ---- 2a. 休み・遅刻・早退の連絡: managers correct the reason, the note and the minutes

create or replace function public.manager_edit_shift_change(
  p_id uuid, p_reason text, p_note text default null, p_note_original text default null, p_source_lang text default null,
  p_late_min int default null, p_leave_min int default null
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  c public.shift_changes;
begin
  if not public.is_manager() then
    raise exception 'managers only' using errcode = '42501';
  end if;
  if public.is_test_account() then
    raise exception 'test account: read only (shift_changes)' using errcode = '42501';
  end if;
  select * into c from public.shift_changes where id = p_id for update;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if p_reason not in ('sick', 'family', 'transport', 'personal', 'paid_leave', 'store', 'other') then
    raise exception 'bad reason' using errcode = '22023';
  end if;
  if c.kind = 'late' and (p_late_min is null or p_late_min not between 1 and 600) then
    raise exception 'bad late minutes' using errcode = '22023';
  end if;
  if c.kind = 'early_leave' then
    if p_leave_min is null or p_leave_min <= c.start_min or p_leave_min >= c.end_min then
      raise exception 'bad leave time' using errcode = '22023';
    end if;
    -- an approved 早退 has already changed the shift table
    if c.status <> 'open' and p_leave_min <> c.leave_min then
      raise exception 'leave time can change only before approval' using errcode = '22023';
    end if;
  end if;
  p_note := nullif(btrim(coalesce(p_note, '')), '');
  update public.shift_changes
     set reason = p_reason,
         note = p_note,
         note_original = case when p_note is null then null
                              when p_note is distinct from c.note then nullif(btrim(coalesce(p_note_original, '')), '')
                              else c.note_original end,
         source_lang = case when p_note is distinct from c.note then p_source_lang else c.source_lang end,
         late_min = case when c.kind = 'late' then p_late_min end,
         leave_min = case when c.kind = 'early_leave' then p_leave_min end
   where id = p_id;
  insert into public.audit_log (actor_id, table_name, row_id, action, diff)
  select auth.uid(), 'shift_changes', p_id, 'update', d
    from (select public.notify_changes(to_jsonb(c), to_jsonb(s)) d from public.shift_changes s where s.id = p_id) x
   where d <> '{}';
end $$;
revoke execute on function public.manager_edit_shift_change(uuid, text, text, text, text, int, int) from public, anon;
grant execute on function public.manager_edit_shift_change(uuid, text, text, text, text, int, int) to authenticated;

-- ---- 2b. 在庫・仕入: a manager replaces a row (same slot and kind, new figures). The old row is cancelled,
-- the new one keeps the writer and the time, and says who corrected it.

alter table public.stock_events
  add column if not exists replaces uuid references public.stock_events (id),
  add column if not exists edited_by uuid references public.profiles (id),
  add column if not exists edited_by_name text;

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
                                   p_reason, p_note_original, p_source_lang);
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

-- ---- 3. manager comments / notes: the text as written before the Japanese translation

create table if not exists public.manager_text_originals (
  id uuid primary key default gen_random_uuid(),
  table_name text not null check (table_name in ('chorei_comments', 'patrol_comments', 'chorei_records', 'patrol_checks',
                                                 'shift_changes', 'attendance_overrides', 'chorei_misses', 'incidents', 'staff_interviews')),
  -- uuid rows by id, attendance_overrides by event_key
  row_key text not null,
  field text not null check (field ~ '^[a-z_]{1,40}$'),
  original text not null check (char_length(original) between 1 and 2000),
  source_lang text,
  author_id uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists manager_text_originals_row on public.manager_text_originals (table_name, row_key, created_at desc);

alter table public.manager_text_originals enable row level security;
revoke all on public.manager_text_originals from anon;
drop policy if exists manager_text_originals_select on public.manager_text_originals;
create policy manager_text_originals_select on public.manager_text_originals for select to authenticated using (public.is_manager());
drop policy if exists manager_text_originals_insert on public.manager_text_originals;
create policy manager_text_originals_insert on public.manager_text_originals for insert to authenticated
  with check (public.is_manager() and author_id = auth.uid());
grant select, insert on public.manager_text_originals to authenticated;
drop trigger if exists test_account_read_only on public.manager_text_originals;
create trigger test_account_read_only before insert or update or delete on public.manager_text_originals
  for each row execute function public.guard_test_account_writes();
