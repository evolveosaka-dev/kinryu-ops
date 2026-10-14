-- クレーム・事故の記録 (owner, 2026-10-15; item 11 of the proposal): any active staff member records a
-- complaint / accident / foreign object / broken equipment / suspected food poisoning / lost item / other
-- with what was done on the spot and photos / videos (Drive, parentType 'incident'). Managers handle it:
-- 未対応 → 対応中 → 完了 with the person in charge, the resolution and 再発防止. Injury, foreign object and
-- suspected food poisoning mail every manager at once; the others go to the instant recipients.

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('complaint', 'injury', 'foreign_object', 'equipment', 'food_poisoning', 'lost_item', 'other')),
  store_id uuid not null references public.stores (id),
  business_date date not null,
  shift text not null check (shift in ('early', 'middle', 'late')),
  occurred_at timestamptz not null,
  description text not null check (char_length(btrim(description)) between 1 and 2000),
  action_taken text check (char_length(action_taken) <= 2000),
  original_texts jsonb,
  source_lang text,
  reporter_id uuid references public.profiles (id) on delete set null default auth.uid(),
  reporter_name text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'done')),
  owner_id uuid references public.profiles (id) on delete set null,
  owner_name text,
  resolution text check (char_length(resolution) <= 2000),
  prevention text check (char_length(prevention) <= 2000),
  resolved_at timestamptz,
  by_test_account boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index incidents_date on public.incidents (business_date desc);
create trigger incidents_updated before update on public.incidents for each row execute function public.set_updated_at();

alter table public.incidents enable row level security;
revoke all on public.incidents from anon;
-- managers (test accounts' rows only for test accounts); the reporter sees their own
create policy incidents_select on public.incidents for select to authenticated
  using ((public.is_manager() and (not by_test_account or public.is_test_account()))
         or (public.is_active() and reporter_id = auth.uid()));
-- inserts through report_incident(); managers handle (status, owner, resolution, prevention)
create policy incidents_update on public.incidents for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

/** Managers may only change the handling columns; done ⇒ resolved_at. */
create function public.guard_incident_update() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['status', 'owner_id', 'owner_name', 'resolution', 'prevention', 'resolved_at', 'updated_at'])
     is distinct from (to_jsonb(old) - array['status', 'owner_id', 'owner_name', 'resolution', 'prevention', 'resolved_at', 'updated_at']) then
    raise exception 'only the handling can be changed' using errcode = '42501';
  end if;
  new.resolved_at := case when new.status = 'done' then coalesce(old.resolved_at, now()) end;
  return new;
end $$;
create trigger incidents_guard before update on public.incidents for each row execute function public.guard_incident_update();

create function public.report_incident(p_store uuid, p_date date, p_shift text, p_occurred_at timestamptz, p_kind text,
                                       p_description text, p_action text default null, p_original_texts jsonb default null, p_source_lang text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles;
  new_id uuid;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'active';
  if not found then
    raise exception 'not active' using errcode = '42501';
  end if;
  if p_occurred_at > now() + interval '5 minutes' or p_occurred_at < now() - interval '14 days' then
    raise exception 'time out of range' using errcode = '22023';
  end if;
  insert into public.incidents (kind, store_id, business_date, shift, occurred_at, description, action_taken, original_texts, source_lang,
                                reporter_id, reporter_name, by_test_account)
  values (p_kind, p_store, p_date, p_shift, p_occurred_at, btrim(p_description), nullif(btrim(coalesce(p_action, '')), ''), p_original_texts, p_source_lang,
          me.id, coalesce(nullif(btrim(me.full_name), ''), me.display_name, '—'), me.is_test_account)
  returning id into new_id;
  perform public.add_notify_event('incident', 'incidents', new_id, p_kind in ('injury', 'foreign_object', 'food_poisoning'));
  return new_id;
end $$;
revoke execute on function public.report_incident(uuid, date, text, timestamptz, text, text, text, jsonb, text) from anon, public;
grant execute on function public.report_incident(uuid, date, text, timestamptz, text, text, text, jsonb, text) to authenticated;

-- photos / videos (Google Drive through drive-upload parentType 'incident')
alter table public.attachments add column incident_id uuid references public.incidents (id) on delete cascade;
alter table public.attachments drop constraint attachment_one_parent;
alter table public.attachments add constraint attachment_one_parent
  check (num_nonnulls(chorei_id, patrol_id, miss_id, stock_event_id, incident_id) = 1);
create index attachments_incident on public.attachments (incident_id) where incident_id is not null;

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
          or a.stock_event_id = new.stock_event_id or a.incident_id = new.incident_id);
  if (new.kind = 'image' and n >= 5) or (new.kind = 'video' and n >= 3) then
    raise exception 'attachment limit reached' using errcode = '23514';
  end if;
  return new;
end $$;

-- notifications: kind 'incident' (on for every current recipient)
alter table public.notify_events drop constraint if exists notify_events_kind_check;
alter table public.notify_events add constraint notify_events_kind_check check (kind in ('chorei', 'chorei_note', 'patrol', 'shift_request', 'signup', 'edit', 'staff_alert', 'stock', 'sales', 'shift_change', 'visa_hours', 'incident'));
alter table public.notify_recipients drop constraint if exists notify_recipients_kinds_check;
alter table public.notify_recipients add constraint notify_recipients_kinds_check check (kinds <@ array['chorei', 'chorei_note', 'patrol', 'shift_request', 'signup', 'edit', 'staff_alert', 'stock', 'sales', 'shift_change', 'visa_hours', 'incident']);
alter table public.notify_recipients alter column kinds set default array['chorei', 'chorei_note', 'patrol', 'shift_request', 'signup', 'edit', 'staff_alert', 'stock', 'sales', 'shift_change', 'visa_hours', 'incident'];
update public.notify_recipients set kinds = kinds || array['incident'] where not ('incident' = any(kinds));

-- test accounts: own test incidents only; purged at night
create or replace function public.guard_test_account_writes() returns trigger
language plpgsql set search_path = ''
as $$
declare
  me text := auth.uid()::text;
  owner_col text := case tg_table_name
    when 'chorei_records' then 'leader_id'
    when 'patrol_checks' then 'patroller_id'
    when 'chorei_notes' then 'author_id'
    when 'shift_requests' then 'user_id'
    when 'profiles' then 'id'
    when 'shift_changes' then 'requester_id'
    when 'shift_offers' then 'user_id'
    when 'incidents' then 'reporter_id'
  end;
  free_profile_cols text[] := array['locale', 'display_name', 'privacy_accepted_at', 'updated_at'];
begin
  if me is null or not public.is_test_account() then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'shift_assignments'
     and (tg_op = 'INSERT' or (to_jsonb(old) ->> 'roster_name') = public.my_roster_name())
     and (tg_op = 'DELETE' or (to_jsonb(new) ->> 'roster_name') = public.my_roster_name()) then
    return coalesce(new, old);
  end if;
  if owner_col is not null
     and (tg_op = 'INSERT' or to_jsonb(old) ->> owner_col = me)
     and (tg_op = 'DELETE' or to_jsonb(new) ->> owner_col = me)
     and (tg_table_name <> 'profiles' or tg_op = 'UPDATE' and (to_jsonb(new) - free_profile_cols) = (to_jsonb(old) - free_profile_cols)) then
    return coalesce(new, old);
  end if;
  raise exception 'test account: read only (%)', tg_table_name using errcode = '42501';
end $$;

create trigger test_account_read_only before insert or update or delete on public.incidents
  for each row execute function public.guard_test_account_writes();

create or replace function public.purge_test_account_data() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  testers uuid[] := array(select id from public.profiles where is_test_account);
  chorei uuid[] := array(select id from public.chorei_records where by_test_account or leader_id = any(testers));
  patrol uuid[] := array(select id from public.patrol_checks where by_test_account or patroller_id = any(testers));
  misses uuid[] := array(select id from public.chorei_misses where by_test_account or reporter_id = any(testers));
  stock uuid[] := array(select id from public.stock_events where by_test_account);
  sales uuid[] := array(select id from public.sales_reports where by_test_account);
  changes uuid[] := array(select id from public.shift_changes where is_test or requester_id = any(testers));
  inc_ids uuid[] := array(select id from public.incidents where by_test_account or reporter_id = any(testers));
  n int := 0;
  k int;
  s record;
begin
  delete from public.attachments where chorei_id = any(chorei) or patrol_id = any(patrol) or miss_id = any(misses) or stock_event_id = any(stock) or incident_id = any(inc_ids) or owner_id = any(testers);
  delete from public.chorei_notes where chorei_id = any(chorei) or author_id = any(testers);
  delete from public.chorei_records where id = any(chorei);
  get diagnostics k = row_count; n := n + k;
  delete from public.patrol_checks where id = any(patrol);
  get diagnostics k = row_count; n := n + k;
  delete from public.chorei_misses where id = any(misses);
  get diagnostics k = row_count; n := n + k;
  delete from public.stock_events where id = any(stock);
  get diagnostics k = row_count; n := n + k;
  delete from public.sales_reports where id = any(sales);
  get diagnostics k = row_count; n := n + k;
  delete from public.shift_offers where change_id = any(changes) or user_id = any(testers);
  delete from public.shift_changes where id = any(changes);
  get diagnostics k = row_count; n := n + k;
  delete from public.incidents where id = any(inc_ids);
  get diagnostics k = row_count; n := n + k;
  delete from public.shift_requests where user_id = any(testers);
  delete from public.translation_log where user_id = any(testers);
  delete from public.audit_log where row_id = any(chorei || patrol || misses || stock || sales || changes || inc_ids) or actor_id = any(testers);
  -- the test schedule again: a copy of the source person's shifts and duties
  for s in select * from public.test_shadows loop
    delete from public.shift_assignments where roster_name = s.test_roster;
    insert into public.shift_assignments (month, business_date, shift, roster_name, store_mark, store_id, start_min, end_min, raw, original_end_min)
    select month, business_date, shift, s.test_roster, store_mark, store_id, start_min, end_min, raw, original_end_min
    from public.shift_assignments where roster_name = s.source_roster;
    delete from public.duty_assignments where roster_name = s.test_roster;
    insert into public.duty_assignments (business_date, shift, store_id, roster_name, kind, time_mode, start_min, end_min, method, is_plan, staff)
    select business_date, shift, store_id, s.test_roster, kind, time_mode, start_min, end_min, method, is_plan, staff
    from public.duty_assignments where roster_name = s.source_roster;
  end loop;
  return n;
end $$;
revoke execute on function public.purge_test_account_data() from public, anon, authenticated;
