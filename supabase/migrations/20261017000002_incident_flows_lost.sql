-- クレーム・事故 Workflow V2, stages 2 and 3 (owner, 2026-10-16).
-- Stage 3: every kind runs on wf_state + incident_events with its own steps (owner's spec §9):
--   お客様クレーム   受付 → 内容確認 → 対応中 → 回答 → 解決確認 → 完了
--   ケガ・事故       発生 → 安全確保 → 管理者報告 → 原因調査 → 再発防止 → 完了
--   異物混入・食中毒の疑い (商品・衛生)  発見 → 隔離・提供停止 → 調査 → 是正 → 安全確認 → 完了
--   会計・券売機トラブル (new kind payment)  報告 → 取引確認 → 対応判断 → 返金・修正 → 照合 → 完了
--   電話の伝言       受付 → 対応中 → 完了
--   その他          報告 → 分類 → 対応中 → 確認 → 完了
-- One step forward at a time (advance); managers may go back (back, with a reason) or cancel (with a reason);
-- staff may take the on-the-spot steps (安全確保・管理者報告・隔離・提供停止); 完了 is managers only and needs
-- 再発防止 (ケガ・衛生) or 回答 (クレーム). 設備の故障 keeps its own transition table (stage 1).
-- Stage 2: 忘れ物 gets 返却待ち (owner contacted, pick-up planned), 本人確認 at the return (required), a keep-until
-- date with a reminder, and every step in its history (lost_item_comments.action).
-- Additive: no column, row or table is removed; rows of earlier kinds without wf_state keep the old handling.

alter table public.incidents drop constraint if exists incidents_kind_check;
alter table public.incidents add constraint incidents_kind_check
  check (kind in ('complaint', 'injury', 'foreign_object', 'equipment', 'food_poisoning', 'lost_item', 'phone_message', 'payment', 'other'));
alter table public.incidents drop constraint if exists incidents_wf_state_check;
alter table public.incidents add constraint incidents_wf_state_check check (wf_state in (
  'reported', 'checking', 'in_progress', 'on_hold', 'repaired', 'done', 'reopened', 'cancelled',
  'received', 'content_check', 'answered', 'resolution_check',
  'occurred', 'safety', 'reported_mgr', 'investigating', 'prevention',
  'found', 'isolated', 'corrected', 'safety_check',
  'txn_check', 'decision', 'refund_fix', 'reconcile',
  'classified', 'check'));

/** The steps of a kind (null = 設備の故障, which has its own table, or 忘れ物, which has its own page). */
create or replace function public.incident_flow(p_kind text) returns text[]
language sql immutable set search_path = ''
as $$
  select case p_kind
    when 'complaint' then array['received', 'content_check', 'in_progress', 'answered', 'resolution_check', 'done']
    when 'injury' then array['occurred', 'safety', 'reported_mgr', 'investigating', 'prevention', 'done']
    when 'foreign_object' then array['found', 'isolated', 'investigating', 'corrected', 'safety_check', 'done']
    when 'food_poisoning' then array['found', 'isolated', 'investigating', 'corrected', 'safety_check', 'done']
    when 'payment' then array['reported', 'txn_check', 'decision', 'refund_fix', 'reconcile', 'done']
    when 'phone_message' then array['received', 'in_progress', 'done']
    when 'other' then array['reported', 'classified', 'in_progress', 'check', 'done']
  end
$$;

/** Steps staff may take themselves (on the spot); every other step is a manager's. */
create or replace function public.incident_staff_steps(p_kind text) returns text[]
language sql immutable set search_path = ''
as $$
  select case p_kind
    when 'injury' then array['safety', 'reported_mgr']
    when 'foreign_object' then array['isolated']
    when 'food_poisoning' then array['isolated']
    else array[]::text[]
  end
$$;

create or replace function public.incident_wf_defaults() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.wf_state is null and new.kind = 'equipment' then
    new.wf_state := 'reported';
    new.discovered_at := coalesce(new.discovered_at, new.occurred_at);
    new.due_at := coalesce(new.due_at, public.incident_default_due(new.priority, now()));
  elsif new.wf_state is null and public.incident_flow(new.kind) is not null then
    new.wf_state := (public.incident_flow(new.kind))[1];
    -- injury / foreign object / suspected food poisoning are urgent
    if new.kind in ('injury', 'foreign_object', 'food_poisoning') and new.priority = 'normal' then
      new.priority := 'urgent';
    end if;
    new.due_at := coalesce(new.due_at, public.incident_default_due(new.priority, now()));
  end if;
  return new;
end $$;

create or replace function public.guard_incident_update() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (new.reporter_id, new.reporter_name, new.by_test_account, new.created_at, new.ai_suggestion, new.incident_no)
     is distinct from (old.reporter_id, old.reporter_name, old.by_test_account, old.created_at, old.ai_suggestion, old.incident_no) then
    raise exception 'the reporter cannot be changed' using errcode = '42501';
  end if;
  if old.wf_state is not null and coalesce(current_setting('app.incident_act', true), '') <> 'on'
     and (new.wf_state, new.assignee_id, new.due_at, new.priority, new.acknowledged_at, new.repaired_at, new.closed_at, new.closed_by, new.cancel_reason, new.status, new.resolved_at, new.kind)
         is distinct from (old.wf_state, old.assignee_id, old.due_at, old.priority, old.acknowledged_at, old.repaired_at, old.closed_at, old.closed_by, old.cancel_reason, old.status, old.resolved_at, old.kind) then
    raise exception 'use the workflow actions' using errcode = '42501';
  end if;
  new.version := old.version + 1;
  if new.wf_state is not null then
    new.status := case when new.wf_state in ('done', 'cancelled') then 'done'
                       when new.wf_state in ('reported', 'checking', 'received', 'occurred', 'found') then 'open' else 'in_progress' end;
    new.resolved_at := case when new.wf_state in ('done', 'cancelled') then coalesce(new.closed_at, old.resolved_at, now()) end;
  else
    new.resolved_at := case when new.status = 'done' then coalesce(old.resolved_at, now()) end;
  end if;
  return new;
end $$;

-- ---- incident_act: the steps of every kind (設備の故障 unchanged)

create or replace function public.incident_act(p_id uuid, p_action text, p_version int default null, p_body text default null,
                                               p_original text default null, p_source_lang text default null, p_data jsonb default '{}')
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles;
  i public.incidents;
  mgr boolean := public.is_manager();
  my_name text;
  to_state text;
  body text := nullif(btrim(coalesce(p_body, '')), '');
  allowed text[];
  assignee public.profiles;
  new_due timestamptz;
  new_priority text;
  urgent boolean;
  flow text[];
  idx int;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'active';
  if not found then
    raise exception 'not active' using errcode = '42501';
  end if;
  my_name := coalesce(nullif(btrim(me.full_name), ''), me.display_name, '—');
  -- the caller must be able to see it (RLS) and it must be a workflow incident
  select * into i from public.incidents where id = p_id and wf_state is not null for update;
  if not found or not (mgr or i.reporter_id = me.id or i.kind = 'equipment') or (i.by_test_account and not me.is_test_account) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if me.is_test_account and not i.by_test_account then
    raise exception 'test account: read only (incidents)' using errcode = '42501';
  end if;
  if p_action <> 'comment' and (p_version is null or p_version <> i.version) then
    raise exception 'conflict: updated by someone else' using errcode = '40001';
  end if;

  if p_action = 'comment' then
    if body is null then raise exception 'comment required' using errcode = '22023'; end if;
    insert into public.incident_events (incident_id, actor_id, actor_name, kind, action, from_state, body, original_body, source_lang)
    values (p_id, me.id, my_name, 'comment', 'comment', i.wf_state, body, p_original, p_source_lang);
    -- a comment does not change the record, so it never makes someone else's pending action a conflict
    return i.version;
  end if;

  if p_action = 'assign' then
    if not mgr then raise exception 'managers only' using errcode = '42501'; end if;
    if i.wf_state in ('done', 'cancelled') then raise exception 'closed' using errcode = '22023'; end if;
    if p_data ? 'assignee_id' and p_data ->> 'assignee_id' is not null then
      select * into assignee from public.profiles where id = (p_data ->> 'assignee_id')::uuid and status = 'active';
      if not found then raise exception 'assignee not found' using errcode = 'P0002'; end if;
    end if;
    new_priority := coalesce(p_data ->> 'priority', i.priority);
    if new_priority not in ('normal', 'high', 'urgent') then raise exception 'bad priority' using errcode = '22023'; end if;
    new_due := coalesce((p_data ->> 'due_at')::timestamptz, i.due_at);
    perform set_config('app.incident_act', 'on', true);
    update public.incidents
       set assignee_id = case when p_data ? 'assignee_id' then assignee.id else assignee_id end,
           assignee_name = case when p_data ? 'assignee_id' then coalesce(nullif(btrim(assignee.full_name), ''), assignee.display_name) else assignee_name end,
           priority = new_priority, due_at = new_due,
           -- assigning is the first response when the report was not taken yet
           acknowledged_at = coalesce(acknowledged_at, now()),
           wf_state = case when wf_state = 'reported' and kind = 'equipment' then 'checking' else wf_state end
     where id = p_id;
    insert into public.incident_events (incident_id, actor_id, actor_name, kind, action, from_state, to_state, body, data)
    values (p_id, me.id, my_name, 'assign', 'assign', i.wf_state, case when i.wf_state = 'reported' and i.kind = 'equipment' then 'checking' else i.wf_state end, body,
            jsonb_build_object('assignee_id', assignee.id, 'assignee_name', coalesce(nullif(btrim(assignee.full_name), ''), assignee.display_name),
                               'priority', new_priority, 'due_at', new_due,
                               'old', jsonb_build_object('assignee_name', i.assignee_name, 'priority', i.priority, 'due_at', i.due_at)));
    perform public.add_notify_event('incident', 'incidents', p_id, new_priority = 'urgent',
      jsonb_build_object('event', 'assign', 'by', my_name, 'assignee', coalesce(nullif(btrim(assignee.full_name), ''), assignee.display_name)),
      'inc|' || p_id || '|assign');
    return (select version from public.incidents where id = p_id);
  end if;

  -- every kind but 設備の故障: its own steps, one step forward at a time (stage 3)
  if i.kind <> 'equipment' then
    flow := public.incident_flow(i.kind);
    idx := array_position(flow, i.wf_state);
    if p_action = 'advance' then
      to_state := flow[idx + 1];
      if to_state is null or i.wf_state = 'cancelled' then raise exception 'no next step' using errcode = '22023'; end if;
      if not mgr and not (to_state = any(public.incident_staff_steps(i.kind))) then
        raise exception 'managers only' using errcode = '42501';
      end if;
      if to_state = 'answered' and coalesce(nullif(btrim(coalesce(p_data ->> 'resolution', '')), ''), i.resolution) is null then
        raise exception 'write the answer' using errcode = '22023';
      end if;
      if to_state = 'done' and i.kind in ('injury', 'foreign_object', 'food_poisoning')
         and coalesce(nullif(btrim(coalesce(p_data ->> 'prevention', '')), ''), i.prevention) is null then
        raise exception 'write the prevention' using errcode = '22023';
      end if;
    elsif p_action = 'back' then
      if not mgr then raise exception 'managers only' using errcode = '42501'; end if;
      to_state := p_data ->> 'to';
      if body is null then raise exception 'reason required' using errcode = '22023'; end if;
      if array_position(flow, to_state) is null or (i.wf_state <> 'cancelled' and array_position(flow, to_state) >= idx) or to_state = 'done' then
        raise exception 'not allowed to %', to_state using errcode = '22023';
      end if;
    elsif p_action = 'cancel' then
      if not mgr then raise exception 'managers only' using errcode = '42501'; end if;
      if body is null then raise exception 'reason required' using errcode = '22023'; end if;
      if i.wf_state in ('done', 'cancelled') then raise exception 'not allowed from %', i.wf_state using errcode = '22023'; end if;
      to_state := 'cancelled';
    else
      raise exception 'bad action' using errcode = '22023';
    end if;
    perform set_config('app.incident_act', 'on', true);
    update public.incidents
       set wf_state = to_state,
           acknowledged_at = case when mgr then coalesce(acknowledged_at, now()) else acknowledged_at end,
           closed_at = case when to_state = 'done' then now() when p_action = 'back' then null else closed_at end,
           closed_by = case when to_state = 'done' then me.id when p_action = 'back' then null else closed_by end,
           closed_by_name = case when to_state = 'done' then my_name when p_action = 'back' then null else closed_by_name end,
           cause = coalesce(nullif(btrim(coalesce(p_data ->> 'cause', '')), ''), cause),
           resolution = coalesce(nullif(btrim(coalesce(p_data ->> 'resolution', '')), ''), resolution),
           prevention = coalesce(nullif(btrim(coalesce(p_data ->> 'prevention', '')), ''), prevention),
           cancel_reason = case when p_action = 'cancel' then body else cancel_reason end
     where id = p_id;
    insert into public.incident_events (incident_id, actor_id, actor_name, kind, action, from_state, to_state, body, original_body, source_lang, data)
    values (p_id, me.id, my_name, 'state', p_action, i.wf_state, to_state, body, p_original, p_source_lang, coalesce(p_data, '{}'));
    if to_state in ('done', 'cancelled', 'reported_mgr') or p_action = 'back' then
      perform public.add_notify_event('incident', 'incidents', p_id, p_action = 'back' or to_state = 'reported_mgr',
        jsonb_build_object('event', case when to_state = 'done' then 'confirm_ok' when p_action = 'back' then 'reopen' when to_state = 'cancelled' then 'cancel' else 'advance' end,
                           'by', my_name, 'from', i.wf_state, 'to', to_state, 'note', body),
        'inc|' || p_id || '|' || p_action || '|' || to_state);
    end if;
    return (select version from public.incidents where id = p_id);
  end if;

  -- state changes: (action, allowed from, to, managers only?)
  select a.allowed, a.to_state into allowed, to_state from (values
    ('acknowledge', array['reported'], 'checking'),
    ('start', array['reported', 'checking', 'on_hold', 'reopened'], 'in_progress'),
    ('hold', array['checking', 'in_progress', 'reopened'], 'on_hold'),
    ('resume', array['on_hold'], 'in_progress'),
    ('repaired', array['in_progress', 'on_hold', 'reopened'], 'repaired'),
    ('confirm_ok', array['repaired'], 'done'),
    ('confirm_ng', array['repaired'], 'reopened'),
    ('reopen', array['done'], 'reopened'),
    ('cancel', array['reported', 'checking'], 'cancelled')
  ) as a(action, allowed, to_state) where a.action = p_action;
  if to_state is null then
    raise exception 'bad action' using errcode = '22023';
  end if;
  if p_action <> 'repaired' and not mgr then
    raise exception 'managers only' using errcode = '42501';
  end if;
  if not (i.wf_state = any(allowed)) then
    raise exception 'not allowed from %', i.wf_state using errcode = '22023';
  end if;
  if p_action in ('hold', 'confirm_ng', 'reopen', 'cancel') and body is null then
    raise exception 'reason required' using errcode = '22023';
  end if;
  if p_action = 'confirm_ok' and (coalesce((p_data ->> 'works')::boolean, false) is not true or nullif(btrim(coalesce(p_data ->> 'cause', '')), '') is null) then
    raise exception 'confirm that it works and write the cause' using errcode = '22023';
  end if;

  perform set_config('app.incident_act', 'on', true);
  update public.incidents
     set wf_state = to_state,
         acknowledged_at = case when p_action in ('acknowledge', 'start', 'hold') then coalesce(acknowledged_at, now()) else acknowledged_at end,
         repaired_at = case when p_action = 'repaired' then coalesce((p_data ->> 'repaired_at')::timestamptz, now()) else repaired_at end,
         closed_at = case when p_action = 'confirm_ok' then now() when p_action in ('reopen', 'confirm_ng') then null else closed_at end,
         closed_by = case when p_action = 'confirm_ok' then me.id when p_action in ('reopen', 'confirm_ng') then null else closed_by end,
         closed_by_name = case when p_action = 'confirm_ok' then my_name when p_action in ('reopen', 'confirm_ng') then null else closed_by_name end,
         cause = case when p_action = 'confirm_ok' then btrim(p_data ->> 'cause') else cause end,
         resolution = case when p_action = 'confirm_ok' then coalesce(nullif(btrim(coalesce(p_data ->> 'resolution', '')), ''), resolution) else resolution end,
         prevention = case when p_action = 'confirm_ok' then coalesce(nullif(btrim(coalesce(p_data ->> 'prevention', '')), ''), prevention) else prevention end,
         cancel_reason = case when p_action = 'cancel' then body else cancel_reason end
   where id = p_id;
  insert into public.incident_events (incident_id, actor_id, actor_name, kind, action, from_state, to_state, body, original_body, source_lang, data)
  values (p_id, me.id, my_name, 'state', p_action, i.wf_state, to_state, body, p_original, p_source_lang, coalesce(p_data, '{}'));
  -- mails: the important steps (urgent = 緊急 incidents and sent-back repairs)
  if p_action in ('hold', 'repaired', 'confirm_ok', 'confirm_ng', 'reopen', 'cancel') then
    urgent := i.priority = 'urgent' or p_action in ('confirm_ng', 'reopen');
    perform public.add_notify_event('incident', 'incidents', p_id, urgent,
      jsonb_build_object('event', p_action, 'by', my_name, 'from', i.wf_state, 'to', to_state, 'note', body),
      'inc|' || p_id || '|' || p_action);
  end if;
  return (select version from public.incidents where id = p_id);
end $$;
revoke execute on function public.incident_act(uuid, text, int, text, text, text, jsonb) from anon, public;
grant execute on function public.incident_act(uuid, text, int, text, text, text, jsonb) to authenticated;


-- ---- stage 2: 忘れ物

alter table public.lost_items drop constraint if exists lost_items_status_check;
alter table public.lost_items add constraint lost_items_status_check check (status in ('stored', 'awaiting', 'returned', 'police', 'disposed'));
alter table public.lost_items
  add column if not exists keep_until timestamptz,
  add column if not exists contact_note text check (char_length(contact_note) <= 1000),
  add column if not exists pickup_at timestamptz,
  add column if not exists id_method text check (id_method in ('id_card', 'name_features', 'phone', 'other')),
  add column if not exists id_checked boolean not null default false;
update public.lost_items set keep_until = found_at + interval '7 days' where keep_until is null;

alter table public.lost_item_comments drop constraint if exists lost_item_comments_action_check;
alter table public.lost_item_comments add constraint lost_item_comments_action_check
  check (action in ('approve', 'reject', 'dispose', 'found', 'await', 'returned', 'police'));

/** a new item: keep for 7 days (then the police reminder) and the first history line */
create or replace function public.lost_item_defaults() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.keep_until := coalesce(new.keep_until, new.found_at + interval '7 days');
  return new;
end $$;
drop trigger if exists lost_items_defaults on public.lost_items;
create trigger lost_items_defaults before insert on public.lost_items for each row execute function public.lost_item_defaults();

create or replace function public.lost_item_log_found() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.lost_item_comments (lost_item_id, author_id, author_name, action, body)
  values (new.id, new.reporter_id, new.reporter_name, 'found', null);
  return new;
end $$;
drop trigger if exists lost_items_log_found on public.lost_items;
create trigger lost_items_log_found after insert on public.lost_items for each row execute function public.lost_item_log_found();

/** 返却待ち: the owner was reached and will come (staff and managers). p_back = true → back to 保管中 (did not come). */
create or replace function public.lost_item_await(p_id uuid, p_note text default null, p_pickup_at timestamptz default null, p_back boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles;
  i public.lost_items;
  my_name text;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'active';
  if not found then
    raise exception 'not active' using errcode = '42501';
  end if;
  my_name := coalesce(nullif(btrim(me.full_name), ''), me.display_name, '—');
  select * into i from public.lost_items where id = p_id and (not by_test_account or me.is_test_account) for update;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if me.is_test_account and not i.by_test_account then
    raise exception 'test account: read only (lost_items)' using errcode = '42501';
  end if;
  if (not p_back and i.status <> 'stored') or (p_back and i.status <> 'awaiting') then
    raise exception 'not allowed now' using errcode = '22023';
  end if;
  update public.lost_items
     set status = case when p_back then 'stored' else 'awaiting' end,
         contact_note = case when p_back then contact_note else nullif(btrim(coalesce(p_note, '')), '') end,
         pickup_at = case when p_back then null else p_pickup_at end
   where id = p_id;
  insert into public.lost_item_comments (lost_item_id, author_id, author_name, action, body)
  values (p_id, me.id, my_name, 'await', case when p_back then '保管中に戻した' else '' end || coalesce(nullif(btrim(coalesce(p_note, '')), ''), ''));
end $$;
revoke execute on function public.lost_item_await(uuid, text, timestamptz, boolean) from anon, public;
grant execute on function public.lost_item_await(uuid, text, timestamptz, boolean) to authenticated;

drop function if exists public.record_lost_item_outcome(uuid, text, timestamptz, text, text, text, boolean, boolean, text, text, jsonb);
/** 返した / 警察に届けた: from 保管中 or 返却待ち (or sent back). Returning needs 本人確認 (method + confirmed). */
create or replace function public.record_lost_item_outcome(p_id uuid, p_outcome text, p_at timestamptz, p_to_name text default null,
                                                           p_to_phone text default null, p_note text default null,
                                                           p_consent_face boolean default false, p_consent_marketing boolean default false,
                                                           p_police_station text default null, p_police_number text default null,
                                                           p_original_texts jsonb default null, p_id_method text default null,
                                                           p_id_checked boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles;
  i public.lost_items;
  my_name text;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'active';
  if not found then
    raise exception 'not active' using errcode = '42501';
  end if;
  my_name := coalesce(nullif(btrim(me.full_name), ''), me.display_name, '—');
  select * into i from public.lost_items where id = p_id and (not by_test_account or me.is_test_account) for update;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if not (i.status in ('stored', 'awaiting') or i.approval = 'rejected') then
    raise exception 'already handled' using errcode = '22023';
  end if;
  if p_outcome not in ('returned', 'police') then
    raise exception 'bad outcome' using errcode = '22023';
  end if;
  if p_at > now() + interval '5 minutes' or p_at < i.found_at - interval '1 minute' then
    raise exception 'time out of range' using errcode = '22023';
  end if;
  if p_outcome = 'returned' and (not coalesce(p_id_checked, false) or p_id_method is null) then
    raise exception 'identity check required' using errcode = '22023';
  end if;
  update public.lost_items
     set status = p_outcome, approval = 'pending', outcome_at = p_at,
         outcome_to_name = nullif(btrim(coalesce(p_to_name, '')), ''), outcome_to_phone = nullif(btrim(coalesce(p_to_phone, '')), ''),
         outcome_note = nullif(btrim(coalesce(p_note, '')), ''),
         consent_face = p_outcome = 'returned' and i.owner_type = 'customer' and coalesce(p_consent_face, false),
         consent_marketing = p_outcome = 'returned' and i.owner_type = 'customer' and coalesce(p_consent_marketing, false),
         police_station = case when p_outcome = 'police' then nullif(btrim(coalesce(p_police_station, '')), '') end,
         police_number = case when p_outcome = 'police' then nullif(btrim(coalesce(p_police_number, '')), '') end,
         id_method = case when p_outcome = 'returned' then p_id_method end,
         id_checked = p_outcome = 'returned' and coalesce(p_id_checked, false),
         original_texts = coalesce(i.original_texts, '{}') || coalesce(p_original_texts, '{}'),
         outcome_by = me.id, outcome_by_name = my_name,
         decided_by = null, decided_by_name = null, decided_at = null
   where id = p_id;
  insert into public.lost_item_comments (lost_item_id, author_id, author_name, action, body)
  values (p_id, me.id, my_name, p_outcome, nullif(btrim(coalesce(p_note, '')), ''));
  perform public.add_notify_event('lost_item', 'lost_items', p_id, false, jsonb_build_object('event', p_outcome));
end $$;
revoke execute on function public.record_lost_item_outcome(uuid, text, timestamptz, text, text, text, boolean, boolean, text, text, jsonb, text, boolean) from anon, public;
grant execute on function public.record_lost_item_outcome(uuid, text, timestamptz, text, text, text, boolean, boolean, text, text, jsonb, text, boolean) to authenticated;

-- managers may also dispose of an item waiting for its owner
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
  if p_action = 'dispose' and i.status not in ('stored', 'awaiting') then
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

/** 保管期限 passed (still stored / waiting): one mail per item (daily 9:00 JST). */
create or replace function public.check_lost_items_due() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  n int := 0;
begin
  for r in select id, keep_until from public.lost_items where status in ('stored', 'awaiting') and keep_until < now() and not by_test_account loop
    insert into public.alert_log (kind, key) values ('lost_due', 'lostdue|' || r.id || '|' || r.keep_until) on conflict (key) do nothing;
    if found then
      perform public.add_notify_event('lost_item', 'lost_items', r.id, false, jsonb_build_object('event', 'overdue'), 'lost|' || r.id || '|overdue');
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.check_lost_items_due() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('check-lost-items-due', '0 0 * * *', 'select public.check_lost_items_due()');
  end if;
end $$;
