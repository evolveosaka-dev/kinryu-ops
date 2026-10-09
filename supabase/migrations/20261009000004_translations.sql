-- Free text written in other languages is translated to Japanese before it is sent
-- (Edge Function `translate`, Claude Haiku 4.5). Japanese goes into the normal columns;
-- the original text is kept for reference.

alter table public.chorei_records
  add column original_texts jsonb,   -- {"caution_text": "…original…", …} only for translated fields
  add column source_lang text;        -- e.g. 'vi', 'si', 'ne', 'en'
alter table public.patrol_checks
  add column original_texts jsonb,
  add column source_lang text;
alter table public.chorei_notes
  add column original_body text;

-- Notes may now carry the original text too.
drop function public.add_chorei_note(uuid, text);
create function public.add_chorei_note(p_chorei uuid, p_body text, p_original text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  new_id uuid;
begin
  if not public.is_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.chorei_records where id = p_chorei and status = 'valid') then
    raise exception 'record not found' using errcode = 'P0002';
  end if;
  insert into public.chorei_notes (chorei_id, author_id, body, original_body)
  values (p_chorei, auth.uid(), p_body, nullif(btrim(p_original), ''))
  returning id into new_id;
  return new_id;
end $$;
revoke execute on function public.add_chorei_note(uuid, text, text) from anon, public;
grant execute on function public.add_chorei_note(uuid, text, text) to authenticated, service_role;

-- One row per translation call: rate limiting (per user per hour) and cost monitoring.
create table public.translation_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id),
  chars int not null,
  input_tokens int,
  output_tokens int,
  model text,
  at timestamptz not null default now()
);
create index translation_log_user_at on public.translation_log (user_id, at desc);
alter table public.translation_log enable row level security;
create policy translation_log_select on public.translation_log for select to authenticated using (public.is_manager());
revoke all on public.translation_log from anon;
