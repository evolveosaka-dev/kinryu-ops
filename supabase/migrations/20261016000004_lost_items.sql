-- 忘れ物・落とし物 (owner, 2026-10-16): a lost item is recorded by any staff member (what, where found, where it is
-- kept, whose: お客様 / スタッフ / 不明 + name / phone), every active staff member can see the list (so anyone can answer
-- a customer's call), and the outcome (返却 / 警察に届けた) is recorded by staff and approved by a manager.
-- Managers comment, approve or send back, and dispose (処分). Returning to a customer needs a photo of the handover;
-- the customer's face may be in it only with their consent (consent_face), and the photo may be used for the
-- store's promotion only with a second consent (consent_marketing) — the owner's marketing point.
-- Photos: attachments.lost_item_id with phase found | return (drive-upload parentType lost_found / lost_return).

create table if not exists public.lost_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id),
  business_date date not null,
  shift text not null check (shift in ('early', 'middle', 'late')),
  found_at timestamptz not null,
  found_place text check (char_length(found_place) <= 200),
  description text not null check (char_length(btrim(description)) between 1 and 1000),
  storage_place text check (char_length(storage_place) <= 200),
  owner_type text not null check (owner_type in ('customer', 'staff', 'unknown')),
  owner_name text check (char_length(owner_name) <= 100),
  owner_phone text check (char_length(owner_phone) <= 40),
  original_texts jsonb,
  source_lang text,
  reporter_id uuid references public.profiles (id) on delete set null default auth.uid(),
  reporter_name text not null,
  -- stored → returned / police (staff, needs approval) or disposed (managers)
  status text not null default 'stored' check (status in ('stored', 'returned', 'police', 'disposed')),
  approval text check (approval in ('pending', 'approved', 'rejected')),
  outcome_at timestamptz,
  outcome_to_name text check (char_length(outcome_to_name) <= 100),
  outcome_to_phone text check (char_length(outcome_to_phone) <= 40),
  outcome_note text check (char_length(outcome_note) <= 1000),
  consent_face boolean not null default false,
  consent_marketing boolean not null default false,
  police_station text check (char_length(police_station) <= 100),
  police_number text check (char_length(police_number) <= 50),
  outcome_by uuid references public.profiles (id) on delete set null,
  outcome_by_name text,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  by_test_account boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lost_items_found on public.lost_items (found_at desc);
drop trigger if exists lost_items_updated on public.lost_items;
create trigger lost_items_updated before update on public.lost_items for each row execute function public.set_updated_at();

alter table public.lost_items enable row level security;
revoke all on public.lost_items from anon;
drop policy if exists lost_items_select on public.lost_items;
create policy lost_items_select on public.lost_items for select to authenticated
  using (public.is_active() and (not by_test_account or public.is_test_account()));
-- staff write through the RPCs below; managers may also correct the row directly
drop policy if exists lost_items_update on public.lost_items;
create policy lost_items_update on public.lost_items for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
grant select, update on public.lost_items to authenticated;

create or replace function public.guard_lost_item_update() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (new.reporter_id, new.reporter_name, new.by_test_account, new.created_at)
     is distinct from (old.reporter_id, old.reporter_name, old.by_test_account, old.created_at) then
    raise exception 'the reporter cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists lost_items_guard on public.lost_items;
create trigger lost_items_guard before update on public.lost_items for each row execute function public.guard_lost_item_update();

create table if not exists public.lost_item_comments (
  id uuid primary key default gen_random_uuid(),
  lost_item_id uuid not null references public.lost_items (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null default auth.uid(),
  author_name text not null,
  -- approve / reject / dispose decisions are kept as comments too
  action text check (action in ('approve', 'reject', 'dispose')),
  body text check (char_length(body) <= 1000),
  original_body text,
  source_lang text,
  created_at timestamptz not null default now()
);
create index if not exists lost_item_comments_item on public.lost_item_comments (lost_item_id, created_at);
alter table public.lost_item_comments enable row level security;
revoke all on public.lost_item_comments from anon;
drop policy if exists lost_item_comments_select on public.lost_item_comments;
create policy lost_item_comments_select on public.lost_item_comments for select to authenticated
  using (exists (select 1 from public.lost_items i where i.id = lost_item_id));
grant select on public.lost_item_comments to authenticated;

create or replace function public.my_display_name() returns text
language sql stable security definer set search_path = ''
as $$ select coalesce(nullif(btrim(full_name), ''), display_name, '—') from public.profiles where id = auth.uid() $$;
revoke execute on function public.my_display_name() from anon, public;
grant execute on function public.my_display_name() to authenticated;

/** 記録する: any active staff member. */
create or replace function public.report_lost_item(p_store uuid, p_found_at timestamptz, p_description text, p_found_place text default null,
                                                   p_storage_place text default null, p_owner_type text default 'unknown',
                                                   p_owner_name text default null, p_owner_phone text default null,
                                                   p_original_texts jsonb default null, p_source_lang text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles;
  t timestamp := p_found_at at time zone 'Asia/Tokyo';
  slot_shift text;
  slot_date date;
  new_id uuid;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'active';
  if not found then
    raise exception 'not active' using errcode = '42501';
  end if;
  if p_found_at > now() + interval '5 minutes' or p_found_at < now() - interval '14 days' then
    raise exception 'time out of range' using errcode = '22023';
  end if;
  -- the shift the time belongs to (早番 7–17, 中番 17–23, 遅番 23–7 = the day before)
  slot_shift := case when extract(hour from t) >= 7 and extract(hour from t) < 17 then 'early'
                     when extract(hour from t) >= 17 and extract(hour from t) < 23 then 'middle' else 'late' end;
  slot_date := case when extract(hour from t) < 7 then (t::date - 1) else t::date end;
  insert into public.lost_items (store_id, business_date, shift, found_at, found_place, description, storage_place, owner_type,
                                 owner_name, owner_phone, original_texts, source_lang, reporter_id, reporter_name, by_test_account)
  values (p_store, slot_date, slot_shift, p_found_at, nullif(btrim(coalesce(p_found_place, '')), ''), btrim(p_description),
          nullif(btrim(coalesce(p_storage_place, '')), ''), p_owner_type,
          case when p_owner_type <> 'unknown' then nullif(btrim(coalesce(p_owner_name, '')), '') end,
          case when p_owner_type <> 'unknown' then nullif(btrim(coalesce(p_owner_phone, '')), '') end,
          p_original_texts, p_source_lang, me.id, coalesce(nullif(btrim(me.full_name), ''), me.display_name, '—'), me.is_test_account)
  returning id into new_id;
  perform public.add_notify_event('lost_item', 'lost_items', new_id, false, jsonb_build_object('event', 'found'));
  return new_id;
end $$;
revoke execute on function public.report_lost_item(uuid, timestamptz, text, text, text, text, text, text, jsonb, text) from anon, public;
grant execute on function public.report_lost_item(uuid, timestamptz, text, text, text, text, text, text, jsonb, text) to authenticated;

/** 返した / 警察に届けた: any active staff member, while stored or sent back; waits for a manager's approval. */
create or replace function public.record_lost_item_outcome(p_id uuid, p_outcome text, p_at timestamptz, p_to_name text default null,
                                                           p_to_phone text default null, p_note text default null,
                                                           p_consent_face boolean default false, p_consent_marketing boolean default false,
                                                           p_police_station text default null, p_police_number text default null,
                                                           p_original_texts jsonb default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles;
  i public.lost_items;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'active';
  if not found then
    raise exception 'not active' using errcode = '42501';
  end if;
  select * into i from public.lost_items where id = p_id and (not by_test_account or me.is_test_account) for update;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if not (i.status = 'stored' or i.approval = 'rejected') then
    raise exception 'already handled' using errcode = '22023';
  end if;
  if p_outcome not in ('returned', 'police') then
    raise exception 'bad outcome' using errcode = '22023';
  end if;
  if p_at > now() + interval '5 minutes' or p_at < i.found_at - interval '1 minute' then
    raise exception 'time out of range' using errcode = '22023';
  end if;
  update public.lost_items
     set status = p_outcome, approval = 'pending', outcome_at = p_at,
         outcome_to_name = nullif(btrim(coalesce(p_to_name, '')), ''), outcome_to_phone = nullif(btrim(coalesce(p_to_phone, '')), ''),
         outcome_note = nullif(btrim(coalesce(p_note, '')), ''),
         consent_face = p_outcome = 'returned' and i.owner_type = 'customer' and coalesce(p_consent_face, false),
         consent_marketing = p_outcome = 'returned' and i.owner_type = 'customer' and coalesce(p_consent_marketing, false),
         police_station = case when p_outcome = 'police' then nullif(btrim(coalesce(p_police_station, '')), '') end,
         police_number = case when p_outcome = 'police' then nullif(btrim(coalesce(p_police_number, '')), '') end,
         original_texts = coalesce(i.original_texts, '{}') || coalesce(p_original_texts, '{}'),
         outcome_by = me.id, outcome_by_name = coalesce(nullif(btrim(me.full_name), ''), me.display_name, '—'),
         decided_by = null, decided_by_name = null, decided_at = null
   where id = p_id;
  perform public.add_notify_event('lost_item', 'lost_items', p_id, false, jsonb_build_object('event', p_outcome));
end $$;
revoke execute on function public.record_lost_item_outcome(uuid, text, timestamptz, text, text, text, boolean, boolean, text, text, jsonb) from anon, public;
grant execute on function public.record_lost_item_outcome(uuid, text, timestamptz, text, text, text, boolean, boolean, text, text, jsonb) to authenticated;

/** Managers: approve / send back a recorded outcome, dispose a stored item, or just comment. */
create or replace function public.manage_lost_item(p_id uuid, p_action text, p_body text default null, p_original text default null,
                                                   p_source_lang text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  i public.lost_items;
  my_name text := public.my_display_name();
begin
  if not public.is_manager() then
    raise exception 'managers only' using errcode = '42501';
  end if;
  select * into i from public.lost_items where id = p_id for update;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if p_action in ('approve', 'reject') and i.approval is distinct from 'pending' then
    raise exception 'nothing to approve' using errcode = '22023';
  end if;
  if p_action = 'reject' and nullif(btrim(coalesce(p_body, '')), '') is null then
    raise exception 'comment required' using errcode = '22023';
  end if;
  if p_action = 'dispose' and i.status <> 'stored' then
    raise exception 'only stored items' using errcode = '22023';
  end if;
  if p_action = 'comment' and nullif(btrim(coalesce(p_body, '')), '') is null then
    raise exception 'comment required' using errcode = '22023';
  end if;
  if p_action not in ('approve', 'reject', 'dispose', 'comment') then
    raise exception 'bad action' using errcode = '22023';
  end if;
  if p_action = 'approve' then
    update public.lost_items set approval = 'approved', decided_by = auth.uid(), decided_by_name = my_name, decided_at = now() where id = p_id;
  elsif p_action = 'reject' then
    update public.lost_items set approval = 'rejected', decided_by = auth.uid(), decided_by_name = my_name, decided_at = now() where id = p_id;
  elsif p_action = 'dispose' then
    update public.lost_items
       set status = 'disposed', approval = 'approved', outcome_at = now(), outcome_note = nullif(btrim(coalesce(p_body, '')), ''),
           outcome_by = auth.uid(), outcome_by_name = my_name, decided_by = auth.uid(), decided_by_name = my_name, decided_at = now()
     where id = p_id;
  end if;
  if p_action <> 'comment' or nullif(btrim(coalesce(p_body, '')), '') is not null then
    insert into public.lost_item_comments (lost_item_id, author_name, action, body, original_body, source_lang)
    values (p_id, my_name, nullif(p_action, 'comment'), nullif(btrim(coalesce(p_body, '')), ''), p_original, p_source_lang);
  end if;
end $$;
revoke execute on function public.manage_lost_item(uuid, text, text, text, text) from anon, public;
grant execute on function public.manage_lost_item(uuid, text, text, text, text) to authenticated;

-- ---- photos

alter table public.attachments add column if not exists lost_item_id uuid references public.lost_items (id) on delete cascade;
alter table public.attachments add column if not exists phase text check (phase in ('found', 'return'));
alter table public.attachments drop constraint if exists attachment_one_parent;
alter table public.attachments add constraint attachment_one_parent
  check (num_nonnulls(chorei_id, patrol_id, miss_id, stock_event_id, incident_id, lost_item_id) = 1);
create index if not exists attachments_lost_item on public.attachments (lost_item_id) where lost_item_id is not null;
-- staff see the photo count of lost items (links stay for managers in the app)
drop policy if exists attachments_select on public.attachments;
create policy attachments_select on public.attachments for select to authenticated
  using (public.is_manager() or (public.is_active() and (owner_id = auth.uid() or lost_item_id is not null)));

-- ---- notifications: kind 'lost_item' (on for every current recipient)

alter table public.notify_events drop constraint if exists notify_events_kind_check;
alter table public.notify_events add constraint notify_events_kind_check check (kind in ('chorei', 'chorei_note', 'patrol', 'shift_request', 'signup', 'edit', 'staff_alert', 'stock', 'sales', 'shift_change', 'visa_hours', 'incident', 'lost_item'));
alter table public.notify_recipients drop constraint if exists notify_recipients_kinds_check;
alter table public.notify_recipients add constraint notify_recipients_kinds_check
  check (kinds <@ array['chorei', 'chorei_note', 'patrol', 'shift_request', 'signup', 'edit', 'staff_alert', 'stock', 'sales', 'shift_change', 'visa_hours', 'incident', 'report', 'lost_item']);
alter table public.notify_recipients alter column kinds set default array['chorei', 'chorei_note', 'patrol', 'shift_request', 'signup', 'edit', 'staff_alert', 'stock', 'sales', 'shift_change', 'visa_hours', 'incident', 'report', 'lost_item'];
update public.notify_recipients set kinds = kinds || array['lost_item'] where not ('lost_item' = any(kinds));

-- ---- test accounts: read only on real lost items, their own are purged at night

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
    when 'lost_items' then 'reporter_id'
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

drop trigger if exists test_account_read_only on public.lost_items;
create trigger test_account_read_only before insert or update or delete on public.lost_items
  for each row execute function public.guard_test_account_writes();

-- Max 5 photos + 3 videos per record (lost items too: found + return photos together)
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
          or a.stock_event_id = new.stock_event_id or a.incident_id = new.incident_id or a.lost_item_id = new.lost_item_id);
  if (new.kind = 'image' and n >= 5) or (new.kind = 'video' and n >= 3) then
    raise exception 'attachment limit reached' using errcode = '23514';
  end if;
  return new;
end $$;

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
  lost uuid[] := array(select id from public.lost_items where by_test_account or reporter_id = any(testers));
  n int := 0;
  k int;
  s record;
begin
  delete from public.attachments where chorei_id = any(chorei) or patrol_id = any(patrol) or miss_id = any(misses) or stock_event_id = any(stock) or incident_id = any(inc_ids) or lost_item_id = any(lost) or owner_id = any(testers);
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
  delete from public.emergency_contact_log where by_test_account or user_id = any(testers) or incident_id = any(inc_ids);
  delete from public.incidents where id = any(inc_ids);
  get diagnostics k = row_count; n := n + k;
  delete from public.lost_items where id = any(lost);
  get diagnostics k = row_count; n := n + k;
  delete from public.shift_requests where user_id = any(testers);
  delete from public.translation_log where user_id = any(testers);
  delete from public.audit_log where row_id = any(chorei || patrol || misses || stock || sales || changes || inc_ids || lost) or actor_id = any(testers);
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
