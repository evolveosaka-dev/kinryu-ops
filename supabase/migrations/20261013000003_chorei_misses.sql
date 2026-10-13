-- 朝礼できなかった: why a 朝礼 slot has no record.
--  * staff report it from the 朝礼 form (report_chorei_miss): reason busy / no_manager / alone / forgot / other (+ note)
--  * managers correct any slot in 朝礼一覧: add or change the reason of a ✗, or mark it ✓ (kind 'done' =
--    the 朝礼 was held but not recorded), or remove the row (back to ✗).
-- One row per slot (store × business date × shift). A valid chorei_records row always wins (✓).

create table public.chorei_misses (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id),
  business_date date not null,
  shift text not null check (shift in ('early', 'middle', 'late')),
  kind text not null default 'missed' check (kind in ('missed', 'done')),
  reason text check (reason in ('busy', 'no_manager', 'alone', 'forgot', 'other')),
  note text check (char_length(note) <= 1000),
  original_texts jsonb,
  source_lang text,
  reporter_id uuid not null references public.profiles (id),
  by_manager boolean not null default false,
  by_test_account boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chorei_miss_reason check (kind = 'done' or reason is not null),
  constraint chorei_miss_other_note check (reason is distinct from 'other' or coalesce(btrim(note), '') <> '')
);
create unique index chorei_misses_one_per_slot on public.chorei_misses (store_id, business_date, shift) where not by_test_account;
create index chorei_misses_date on public.chorei_misses (business_date);

create trigger chorei_misses_updated before update on public.chorei_misses
  for each row execute function public.set_updated_at();
create trigger chorei_misses_audit after update on public.chorei_misses
  for each row execute function public.write_audit();

-- reporter / flags are set on the server
create or replace function public.chorei_miss_defaults() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.reporter_id := coalesce(auth.uid(), new.reporter_id);
    new.by_test_account := coalesce((select is_test_account from public.profiles where id = new.reporter_id), false);
  end if;
  if auth.uid() is not null then
    new.by_manager := public.is_manager();
  end if;
  if new.kind = 'done' then
    new.reason := null;
  end if;
  return new;
end $$;
create trigger chorei_misses_defaults before insert or update on public.chorei_misses
  for each row execute function public.chorei_miss_defaults();

alter table public.chorei_misses enable row level security;

-- managers read and correct everything (test accounts are refused below); staff see their own reports
create policy chorei_misses_select on public.chorei_misses for select to authenticated
  using (public.is_manager() or (public.is_active() and reporter_id = auth.uid()));
create policy chorei_misses_manager_insert on public.chorei_misses for insert to authenticated
  with check (public.is_manager());
create policy chorei_misses_manager_update on public.chorei_misses for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
create policy chorei_misses_manager_delete on public.chorei_misses for delete to authenticated
  using (public.is_manager());

-- a test account (even with the manager role) writes only its own report, which is purged at night
create or replace function public.guard_test_account_misses() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_test_account() then
    return coalesce(new, old);
  end if;
  if (tg_op = 'DELETE' and old.reporter_id = auth.uid())
     or (tg_op <> 'DELETE' and new.by_test_account and (tg_op = 'INSERT' or old.reporter_id = auth.uid())) then
    return coalesce(new, old);
  end if;
  raise exception 'test account: read only (chorei_misses)' using errcode = '42501';
end $$;
create trigger test_account_read_only before insert or update or delete on public.chorei_misses
  for each row execute function public.guard_test_account_misses();

-- Staff: 「朝礼できなかった」 from the form. Same date window as a 朝礼 record (today ± 1).
-- The first report of a slot wins; its reporter (or a manager) may change it.
create or replace function public.report_chorei_miss(
  p_store uuid, p_date date, p_shift text, p_reason text, p_note text default null,
  p_original jsonb default null, p_lang text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  tester boolean := public.is_test_account();
  cur public.chorei_misses;
  new_id uuid;
begin
  if not public.is_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not public.is_manager() and p_date not between public.tokyo_today() - 1 and public.tokyo_today() + 1 then
    raise exception 'business_date out of range' using errcode = '22023';
  end if;
  if exists (select 1 from public.chorei_records c where c.store_id = p_store and c.business_date = p_date
             and c.shift = p_shift and c.status = 'valid' and c.by_test_account = tester) then
    raise exception 'chorei already recorded' using errcode = '23505';
  end if;
  select * into cur from public.chorei_misses m
   where m.store_id = p_store and m.business_date = p_date and m.shift = p_shift and m.by_test_account = tester
     and (not tester or m.reporter_id = auth.uid());
  if found then
    if cur.reporter_id <> auth.uid() and not public.is_manager() then
      raise exception 'already reported' using errcode = '23505';
    end if;
    update public.chorei_misses
       set kind = 'missed', reason = p_reason, note = nullif(btrim(p_note), ''), original_texts = p_original, source_lang = p_lang
     where id = cur.id;
    return cur.id;
  end if;
  insert into public.chorei_misses (store_id, business_date, shift, kind, reason, note, original_texts, source_lang, reporter_id)
  values (p_store, p_date, p_shift, 'missed', p_reason, nullif(btrim(p_note), ''), p_original, p_lang, auth.uid())
  returning id into new_id;
  return new_id;
end $$;
revoke execute on function public.report_chorei_miss(uuid, date, text, text, text, jsonb, text) from public, anon;
grant execute on function public.report_chorei_miss(uuid, date, text, text, text, jsonb, text) to authenticated;

-- the 朝礼 form also shows whether the slot was reported as missed
create or replace function public.chorei_slot(p_store uuid, p_date date, p_shift text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  prev_date date := case when p_shift = 'early' then p_date - 1 else p_date end;
  prev_shift text := case p_shift when 'early' then 'late' when 'middle' then 'early' else 'middle' end;
  tester boolean := public.is_test_account();
  existing jsonb;
  previous jsonb;
  miss jsonb;
begin
  if not public.is_active() then
    return null;
  end if;
  select jsonb_build_object('id', c.id, 'leader', p.display_name, 'submitted_at', c.submitted_at)
    into existing
    from public.chorei_records c join public.profiles p on p.id = c.leader_id
   where c.store_id = p_store and c.business_date = p_date and c.shift = p_shift and c.status = 'valid'
     and c.by_test_account = tester
   order by c.submitted_at desc
   limit 1;
  select jsonb_build_object(
           'id', c.id, 'business_date', c.business_date, 'shift', c.shift, 'leader', p.display_name,
           'stock_none', c.stock_none, 'stock_text', c.stock_text, 'target_bowls', c.target_bowls,
           'caution_text', c.caution_text, 'submitted_at', c.submitted_at,
           'notes', coalesce((select jsonb_agg(jsonb_build_object('body', n.body, 'author', a.display_name) order by n.created_at)
                              from public.chorei_notes n join public.profiles a on a.id = n.author_id
                              where n.chorei_id = c.id and (tester or not a.is_test_account)), '[]'))
    into previous
    from public.chorei_records c join public.profiles p on p.id = c.leader_id
   where c.store_id = p_store and c.business_date = prev_date and c.shift = prev_shift and c.status = 'valid'
     and (tester or not c.by_test_account)
   order by c.by_test_account, c.submitted_at desc
   limit 1;
  select jsonb_build_object('kind', m.kind, 'reason', m.reason, 'note', m.note, 'reporter', p.display_name,
                            'mine', m.reporter_id = auth.uid(), 'at', m.updated_at)
    into miss
    from public.chorei_misses m join public.profiles p on p.id = m.reporter_id
   where m.store_id = p_store and m.business_date = p_date and m.shift = p_shift and m.by_test_account = tester
     and (not tester or m.reporter_id = auth.uid())
   limit 1;
  return jsonb_build_object('existing', existing, 'previous', previous, 'miss', miss);
end $$;

-- nightly purge also removes test accounts' reports
create or replace function public.purge_test_account_data() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  testers uuid[] := array(select id from public.profiles where is_test_account);
  chorei uuid[] := array(select id from public.chorei_records where by_test_account or leader_id = any(testers));
  patrol uuid[] := array(select id from public.patrol_checks where by_test_account or patroller_id = any(testers));
  misses uuid[] := array(select id from public.chorei_misses where by_test_account or reporter_id = any(testers));
  n int := 0;
  k int;
begin
  delete from public.attachments where chorei_id = any(chorei) or patrol_id = any(patrol) or owner_id = any(testers);
  delete from public.chorei_notes where chorei_id = any(chorei) or author_id = any(testers);
  delete from public.chorei_records where id = any(chorei);
  get diagnostics k = row_count; n := n + k;
  delete from public.patrol_checks where id = any(patrol);
  get diagnostics k = row_count; n := n + k;
  delete from public.chorei_misses where id = any(misses);
  get diagnostics k = row_count; n := n + k;
  delete from public.shift_requests where user_id = any(testers);
  delete from public.translation_log where user_id = any(testers);
  delete from public.audit_log where row_id = any(chorei || patrol || misses) or actor_id = any(testers);
  return n;
end $$;
revoke execute on function public.purge_test_account_data() from public, anon, authenticated;
