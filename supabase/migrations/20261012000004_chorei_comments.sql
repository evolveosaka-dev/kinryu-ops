-- コメント on a 朝礼 record: written by managers, read by the managers and the leader who sent it.
-- The leader sees unread comments on ホーム / 履歴 until they open their history (read_at).
-- A test account may comment only on its own test records (purged with them every night).

create table public.chorei_comments (
  id uuid primary key default gen_random_uuid(),
  chorei_id uuid not null references public.chorei_records (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  -- kept with the comment: staff cannot read other people's profiles
  author_name text not null default '',
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index chorei_comments_chorei on public.chorei_comments (chorei_id, created_at);
create index chorei_comments_unread on public.chorei_comments (chorei_id) where read_at is null;

alter table public.chorei_comments enable row level security;
create policy chorei_comments_select on public.chorei_comments for select to authenticated
  using (public.is_manager()
         or exists (select 1 from public.chorei_records c where c.id = chorei_id and c.leader_id = auth.uid()));
create policy chorei_comments_delete on public.chorei_comments for delete to authenticated
  using (public.is_manager() and author_id = auth.uid());
grant select, delete on public.chorei_comments to authenticated;

create or replace function public.add_chorei_comment(p_chorei uuid, p_body text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  body text := btrim(coalesce(p_body, ''));
  rec public.chorei_records;
  new_id uuid;
begin
  if not public.is_manager() then
    raise exception 'managers only' using errcode = '42501';
  end if;
  if char_length(body) not between 1 and 1000 then
    raise exception 'comment must be 1–1000 characters' using errcode = '22023';
  end if;
  select * into rec from public.chorei_records where id = p_chorei and status = 'valid';
  if rec.id is null then
    raise exception 'record not found' using errcode = 'P0002';
  end if;
  if public.is_test_account() and not (rec.by_test_account and rec.leader_id = auth.uid()) then
    raise exception 'test account: read only (chorei_comments)' using errcode = '42501';
  end if;
  insert into public.chorei_comments (chorei_id, author_id, author_name, body)
  select p_chorei, p.id, coalesce(nullif(p.display_name, ''), p.full_name, ''), body
  from public.profiles p where p.id = auth.uid()
  returning id into new_id;
  return new_id;
end $$;
revoke execute on function public.add_chorei_comment(uuid, text) from public, anon;
grant execute on function public.add_chorei_comment(uuid, text) to authenticated;

-- Unread comments on the records I led (ホーム card, 履歴 badge).
create or replace function public.unread_chorei_comments() returns int
language sql stable security definer set search_path = ''
as $$
  select count(*)::int from public.chorei_comments m join public.chorei_records c on c.id = m.chorei_id
  where c.leader_id = auth.uid() and m.read_at is null and m.author_id <> auth.uid()
$$;
revoke execute on function public.unread_chorei_comments() from public, anon;
grant execute on function public.unread_chorei_comments() to authenticated;

create or replace function public.mark_chorei_comments_read() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  update public.chorei_comments m set read_at = now()
  from public.chorei_records c
  where c.id = m.chorei_id and c.leader_id = auth.uid() and m.read_at is null
    and (not public.is_test_account() or m.author_id = auth.uid());
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.mark_chorei_comments_read() from public, anon;
grant execute on function public.mark_chorei_comments_read() to authenticated;

-- test accounts: own comments only (same rule as the other tables)
create or replace function public.guard_test_account_writes() returns trigger
language plpgsql set search_path = ''
as $$
declare
  me text := auth.uid()::text;
  owner_col text := case tg_table_name
    when 'chorei_records' then 'leader_id'
    when 'patrol_checks' then 'patroller_id'
    when 'chorei_notes' then 'author_id'
    when 'chorei_comments' then 'author_id'
    when 'shift_requests' then 'user_id'
    when 'profiles' then 'id'
  end;
  free_profile_cols text[] := array['locale', 'display_name', 'privacy_accepted_at', 'updated_at'];
begin
  if me is null or not public.is_test_account() then
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
create trigger test_account_read_only before insert or update or delete on public.chorei_comments
  for each row execute function public.guard_test_account_writes();

-- 履歴 → 全店舗: comments are shown to managers and to the record's leader only.
create or replace function public.store_chorei_month(p_store uuid, p_month date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  m date := date_trunc('month', p_month)::date;
  manager boolean := public.is_manager();
  tester boolean := public.is_test_account();
begin
  if not public.is_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'business_date', c.business_date, 'shift', c.shift, 'submitted_at', c.submitted_at,
             'leader', coalesce(nullif(l.display_name, ''), l.full_name, ''),
             'participants', coalesce((select array_agg(coalesce(nullif(p.display_name, ''), p.full_name, '')) from public.profiles p where p.id = any(c.participants)), '{}')
                             || c.participants_extra,
             'stock_none', c.stock_none, 'stock_text', c.stock_text, 'target_bowls', c.target_bowls,
             'caution_text', c.caution_text, 'steps_done', c.steps_done, 'skip_reason', c.skip_reason,
             'original_texts', c.original_texts, 'is_test', c.is_test,
             'notes', coalesce((select jsonb_agg(jsonb_build_object('body', n.body, 'author', coalesce(nullif(a.display_name, ''), a.full_name, ''), 'created_at', n.created_at) order by n.created_at)
                                from public.chorei_notes n join public.profiles a on a.id = n.author_id
                                where n.chorei_id = c.id and (tester or not a.is_test_account)), '[]'),
             'comments', case when manager or c.leader_id = auth.uid() then
                           coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'body', k.body, 'author_id', k.author_id, 'author_name', k.author_name,
                                                                         'created_at', k.created_at, 'read_at', k.read_at) order by k.created_at)
                                     from public.chorei_comments k where k.chorei_id = c.id), '[]')
                         else '[]' end,
             'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'status', x.status, 'drive_url', case when manager then x.drive_url end))
                                      from public.attachments x where x.chorei_id = c.id and x.status = 'uploaded'), '[]'))
           order by c.business_date desc, array_position(array['late', 'middle', 'early'], c.shift))
    from public.chorei_records c join public.profiles l on l.id = c.leader_id
    where c.store_id = p_store and c.business_date >= m and c.business_date < (m + interval '1 month')::date
      and c.status = 'valid'
      and (not c.is_test or (tester and c.by_test_account))
  ), '[]');
end $$;
