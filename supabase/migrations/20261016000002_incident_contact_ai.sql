-- クレーム・事故の記録, part 2 (owner, 2026-10-16):
--  * お客様の名前・電話番号 (optional, to contact the customer later)
--  * 管理者への連絡: 電話 / LINE / 連絡しない; every tap on 電話する / LINEで送る is logged with who, when, to whom
--    and the writer's answer (つながった / つながらなかった / 送った / 送れなかった) → contact history for managers.
--    Contacts = emergency_contacts (管理 → 設定 → 緊急連絡先; managers edit, active staff read the active ones).
--  * その場でしたこと: the AI proposal (incident-ai, built from managers' past 対応・再発防止) is kept on the record
--    (ai_suggestion: ja, local, lang, based_on) with action_source ai | own.
--  * fix: managers may now correct the reported fields (IncidentEdit, 20261016000001); who reported stays fixed.

alter table public.incidents
  add column if not exists customer_name text check (char_length(customer_name) <= 100),
  add column if not exists customer_phone text check (char_length(customer_phone) <= 40),
  add column if not exists contact_method text check (contact_method in ('phone', 'line', 'none')),
  add column if not exists ai_suggestion jsonb,
  add column if not exists action_source text check (action_source in ('ai', 'own'));

create or replace function public.guard_incident_update() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (new.reporter_id, new.reporter_name, new.by_test_account, new.created_at, new.ai_suggestion)
     is distinct from (old.reporter_id, old.reporter_name, old.by_test_account, old.created_at, old.ai_suggestion) then
    raise exception 'the reporter cannot be changed' using errcode = '42501';
  end if;
  new.resolved_at := case when new.status = 'done' then coalesce(old.resolved_at, now()) end;
  return new;
end $$;

-- ---- 緊急連絡先

create table if not exists public.emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 50),
  phone text check (phone ~ '^[0-9+() -]{3,20}$'),
  line_ok boolean not null default true,
  note text check (char_length(note) <= 200),
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists emergency_contacts_updated on public.emergency_contacts;
create trigger emergency_contacts_updated before update on public.emergency_contacts for each row execute function public.set_updated_at();
alter table public.emergency_contacts enable row level security;
revoke all on public.emergency_contacts from anon;
drop policy if exists emergency_contacts_select on public.emergency_contacts;
create policy emergency_contacts_select on public.emergency_contacts for select to authenticated
  using (public.is_manager() or (public.is_active() and active));
drop policy if exists emergency_contacts_write on public.emergency_contacts;
create policy emergency_contacts_write on public.emergency_contacts for all to authenticated
  using (public.is_manager()) with check (public.is_manager());
grant select, insert, update, delete on public.emergency_contacts to authenticated;
drop trigger if exists test_account_read_only on public.emergency_contacts;
create trigger test_account_read_only before insert or update or delete on public.emergency_contacts
  for each row execute function public.guard_test_account_writes();

create table if not exists public.emergency_contact_log (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references public.emergency_contacts (id) on delete set null,
  contact_name text not null,
  method text not null check (method in ('phone', 'line')),
  user_id uuid references public.profiles (id) on delete set null,
  user_name text not null,
  at timestamptz not null default now(),
  result text check (result in ('reached', 'no_answer', 'sent', 'not_sent')),
  result_at timestamptz,
  incident_id uuid references public.incidents (id) on delete cascade,
  by_test_account boolean not null default false
);
create index if not exists emergency_contact_log_at on public.emergency_contact_log (at desc);
create index if not exists emergency_contact_log_incident on public.emergency_contact_log (incident_id) where incident_id is not null;
alter table public.emergency_contact_log enable row level security;
revoke all on public.emergency_contact_log from anon;
drop policy if exists emergency_contact_log_select on public.emergency_contact_log;
create policy emergency_contact_log_select on public.emergency_contact_log for select to authenticated
  using ((public.is_manager() and (not by_test_account or public.is_test_account())) or user_id = auth.uid());
grant select on public.emergency_contact_log to authenticated;

/** A tap on 電話する / LINEで送る (just before the phone / LINE app opens). */
create or replace function public.log_emergency_contact(p_contact uuid, p_method text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles;
  c public.emergency_contacts;
  new_id uuid;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'active';
  if not found then
    raise exception 'not active' using errcode = '42501';
  end if;
  select * into c from public.emergency_contacts where id = p_contact and active;
  if not found then
    raise exception 'contact not found' using errcode = 'P0002';
  end if;
  if p_method not in ('phone', 'line') or (p_method = 'phone' and c.phone is null) or (p_method = 'line' and not c.line_ok) then
    raise exception 'bad method' using errcode = '22023';
  end if;
  insert into public.emergency_contact_log (contact_id, contact_name, method, user_id, user_name, by_test_account)
  values (c.id, c.name, p_method, me.id, coalesce(nullif(btrim(me.full_name), ''), me.display_name, '—'), me.is_test_account)
  returning id into new_id;
  return new_id;
end $$;
revoke execute on function public.log_emergency_contact(uuid, text) from anon, public;
grant execute on function public.log_emergency_contact(uuid, text) to authenticated;

/** The writer's answer after coming back (own rows, within 12 h). */
create or replace function public.set_emergency_contact_result(p_id uuid, p_result text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_result not in ('reached', 'no_answer', 'sent', 'not_sent') then
    raise exception 'bad result' using errcode = '22023';
  end if;
  update public.emergency_contact_log set result = p_result, result_at = now()
   where id = p_id and user_id = auth.uid() and at > now() - interval '12 hours';
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
end $$;
revoke execute on function public.set_emergency_contact_result(uuid, text) from anon, public;
grant execute on function public.set_emergency_contact_result(uuid, text) to authenticated;

-- ---- report_incident with the new fields

drop function if exists public.report_incident(uuid, date, text, timestamptz, text, text, text, jsonb, text);
create or replace function public.report_incident(p_store uuid, p_date date, p_shift text, p_occurred_at timestamptz, p_kind text,
                                                  p_description text, p_action text default null, p_original_texts jsonb default null,
                                                  p_source_lang text default null, p_customer_name text default null,
                                                  p_customer_phone text default null, p_contact_method text default null,
                                                  p_contact_logs uuid[] default null, p_ai_suggestion jsonb default null,
                                                  p_action_source text default null)
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
  if p_action_source = 'own' and nullif(btrim(coalesce(p_action, '')), '') is null then
    raise exception 'action required' using errcode = '22023';
  end if;
  insert into public.incidents (kind, store_id, business_date, shift, occurred_at, description, action_taken, original_texts, source_lang,
                                reporter_id, reporter_name, by_test_account, customer_name, customer_phone, contact_method,
                                ai_suggestion, action_source)
  values (p_kind, p_store, p_date, p_shift, p_occurred_at, btrim(p_description), nullif(btrim(coalesce(p_action, '')), ''), p_original_texts, p_source_lang,
          me.id, coalesce(nullif(btrim(me.full_name), ''), me.display_name, '—'), me.is_test_account,
          nullif(btrim(coalesce(p_customer_name, '')), ''), nullif(btrim(coalesce(p_customer_phone, '')), ''), p_contact_method,
          p_ai_suggestion, p_action_source)
  returning id into new_id;
  update public.emergency_contact_log set incident_id = new_id
   where id = any(coalesce(p_contact_logs, '{}')) and user_id = me.id and incident_id is null;
  perform public.add_notify_event('incident', 'incidents', new_id, p_kind in ('injury', 'foreign_object', 'food_poisoning'));
  return new_id;
end $$;
revoke execute on function public.report_incident(uuid, date, text, timestamptz, text, text, text, jsonb, text, text, text, text, uuid[], jsonb, text) from anon, public;
grant execute on function public.report_incident(uuid, date, text, timestamptz, text, text, text, jsonb, text, text, text, text, uuid[], jsonb, text) to authenticated;

-- ---- test accounts: their contact log goes with the nightly purge

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
  delete from public.emergency_contact_log where by_test_account or user_id = any(testers) or incident_id = any(inc_ids);
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
