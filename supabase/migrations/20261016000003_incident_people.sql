-- クレーム・事故の記録, part 3 (owner, 2026-10-16):
--  * new kind 電話の伝言 (phone_message): who called = 業者 / 金龍 / お客様 (caller_type) with their name and phone
--    (customer_name / customer_phone hold the other side's name and phone for every kind; all optional)
--  * ケガ・事故: who was hurt = スタッフ and / or お客様 (injured_who), the staff member's name (injured_staff)

alter table public.incidents drop constraint if exists incidents_kind_check;
alter table public.incidents add constraint incidents_kind_check
  check (kind in ('complaint', 'injury', 'foreign_object', 'equipment', 'food_poisoning', 'lost_item', 'phone_message', 'other'));

alter table public.incidents
  add column if not exists injured_who text[] check (injured_who <@ array['staff', 'customer']),
  add column if not exists injured_staff text check (char_length(injured_staff) <= 50),
  add column if not exists caller_type text check (caller_type in ('vendor', 'kinryu', 'customer'));

drop function if exists public.report_incident(uuid, date, text, timestamptz, text, text, text, jsonb, text, text, text, text, uuid[], jsonb, text);
create or replace function public.report_incident(p_store uuid, p_date date, p_shift text, p_occurred_at timestamptz, p_kind text,
                                                  p_description text, p_action text default null, p_original_texts jsonb default null,
                                                  p_source_lang text default null, p_customer_name text default null,
                                                  p_customer_phone text default null, p_contact_method text default null,
                                                  p_contact_logs uuid[] default null, p_ai_suggestion jsonb default null,
                                                  p_action_source text default null, p_injured_who text[] default null,
                                                  p_injured_staff text default null, p_caller_type text default null)
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
                                ai_suggestion, action_source, injured_who, injured_staff, caller_type)
  values (p_kind, p_store, p_date, p_shift, p_occurred_at, btrim(p_description), nullif(btrim(coalesce(p_action, '')), ''), p_original_texts, p_source_lang,
          me.id, coalesce(nullif(btrim(me.full_name), ''), me.display_name, '—'), me.is_test_account,
          nullif(btrim(coalesce(p_customer_name, '')), ''), nullif(btrim(coalesce(p_customer_phone, '')), ''), p_contact_method,
          p_ai_suggestion, p_action_source,
          case when p_kind = 'injury' then nullif(p_injured_who, '{}') end,
          case when p_kind = 'injury' and 'staff' = any(p_injured_who) then nullif(btrim(coalesce(p_injured_staff, '')), '') end,
          case when p_kind = 'phone_message' then p_caller_type end)
  returning id into new_id;
  update public.emergency_contact_log set incident_id = new_id
   where id = any(coalesce(p_contact_logs, '{}')) and user_id = me.id and incident_id is null;
  perform public.add_notify_event('incident', 'incidents', new_id, p_kind in ('injury', 'foreign_object', 'food_poisoning'));
  return new_id;
end $$;
revoke execute on function public.report_incident(uuid, date, text, timestamptz, text, text, text, jsonb, text, text, text, text, uuid[], jsonb, text, text[], text, text) from anon, public;
grant execute on function public.report_incident(uuid, date, text, timestamptz, text, text, text, jsonb, text, text, text, text, uuid[], jsonb, text, text[], text, text) to authenticated;
