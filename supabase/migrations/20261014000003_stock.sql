-- 在庫・仕入 (日報 page 2): per store × business date × shift.
-- 繰越 = the previous shift's last 終わりの在庫 (or a recount), 受入 / 払出 (店間移動) are added
-- as they happen, 終わりの在庫 is counted at the end and 使用 = 繰越 + 受入 − 払出 − 残り.
-- Several people may write in one shift; every write is one row of stock_events (the history).

alter table public.stores add column fridge_count int not null default 0 check (fridge_count between 0 and 10);
update public.stores set fridge_count = 4 where code = 'sennichimae';
update public.stores set fridge_count = 3 where code = 'midosuji';

create table public.stock_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id),
  code text not null check (code ~ '^[a-z0-9_]{1,40}$'),
  name_ja text not null check (char_length(btrim(name_ja)) between 1 and 40),
  unit text not null check (unit in ('piece', 'bag', 'box', 'stick', 'liter')),
  -- e.g. 麺 1段 = 50個, もも肉 1箱 = 4袋, パイタン 1缶 = 23.3L
  pack_size numeric(8, 1) check (pack_size > 0),
  pack_unit text check (pack_unit in ('tier', 'box', 'can')),
  -- 標準量 written next to the item on the paper sheet (used for 補充の目安)
  standard numeric(8, 1) check (standard >= 0),
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, code),
  constraint stock_items_pack check ((pack_size is null) = (pack_unit is null))
);
create trigger stock_items_updated before update on public.stock_items for each row execute function public.set_updated_at();

alter table public.stock_items enable row level security;
revoke all on public.stock_items from anon;
create policy stock_items_select on public.stock_items for select to authenticated using (public.is_active());
create policy stock_items_write on public.stock_items for all to authenticated
  using (public.is_manager()) with check (public.is_manager());
create trigger test_account_read_only before insert or update or delete on public.stock_items
  for each row execute function public.guard_test_account_writes();

create table public.stock_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id),
  business_date date not null,
  shift text not null check (shift in ('early', 'middle', 'late')),
  kind text not null check (kind in ('open', 'in', 'out', 'close', 'temp_start', 'temp_end')),
  place text,
  note text check (char_length(note) <= 200),
  -- [{ "item": "<stock_items.id>", "qty": 12.5 }]
  lines jsonb not null default '[]' check (jsonb_typeof(lines) = 'array'),
  temps numeric(4, 1)[],
  author_id uuid not null references public.profiles (id),
  author_name text not null,
  by_test_account boolean not null default false,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id),
  voided_by_name text
);
create index stock_events_slot on public.stock_events (store_id, business_date, shift, created_at);

alter table public.stock_events enable row level security;
revoke all on public.stock_events from anon;
-- operational data: every active user reads it (test accounts' rows only for test accounts); writes via RPC only
create policy stock_events_select on public.stock_events for select to authenticated
  using (public.is_active() and (not by_test_account or public.is_test_account()));

create function public.add_stock_event(
  p_store uuid, p_date date, p_shift text, p_kind text,
  p_lines jsonb default '[]', p_place text default null, p_note text default null, p_temps numeric[] default null
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

  if p_kind in ('temp_start', 'temp_end') then
    if coalesce(array_length(p_temps, 1), 0) <> fridges or fridges = 0
       or exists (select 1 from unnest(p_temps) x where x is null or x < -30 or x > 40) then
      raise exception 'one temperature per fridge (-30…40)' using errcode = '22023';
    end if;
    norm := '[]';
    p_place := null;
  elsif p_kind in ('open', 'in', 'out', 'close') then
    p_temps := null;
    if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
      raise exception 'no lines' using errcode = '22023';
    end if;
    select jsonb_agg(jsonb_build_object('item', i.id, 'qty', round((l ->> 'qty')::numeric, 1)) order by i.sort_order), count(*)
      into norm, n
      from jsonb_array_elements(p_lines) l
      join public.stock_items i on i.id = (l ->> 'item')::uuid and i.store_id = p_store and i.active
     where (l ->> 'qty')::numeric between 0 and 100000;
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

  insert into public.stock_events (store_id, business_date, shift, kind, place, note, lines, temps, author_id, author_name, by_test_account)
  values (p_store, p_date, p_shift, p_kind, p_place, p_note, norm, p_temps, me.id,
          coalesce(nullif(btrim(me.display_name), ''), me.full_name, '—'), public.is_test_account())
  returning id into new_id;
  return new_id;
end $$;

-- the writer within 12 hours, or a manager, may cancel a row (it stays in the history)
create function public.void_stock_event(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  e public.stock_events;
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'active';
  select * into e from public.stock_events where id = p_id and voided_at is null;
  if me.id is null or e.id is null
     or not (public.is_manager() or (e.author_id = me.id and e.created_at > now() - interval '12 hours'))
     or (e.by_test_account and not public.is_test_account()) or (public.is_test_account() and not e.by_test_account) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.stock_events
     set voided_at = now(), voided_by = me.id, voided_by_name = coalesce(nullif(btrim(me.display_name), ''), me.full_name, '—')
   where id = p_id;
end $$;

revoke execute on function public.add_stock_event(uuid, date, text, text, jsonb, text, text, numeric[]) from anon, public;
grant execute on function public.add_stock_event(uuid, date, text, text, jsonb, text, text, numeric[]) to authenticated;
revoke execute on function public.void_stock_event(uuid) from anon, public;
grant execute on function public.void_stock_event(uuid) to authenticated;

-- Items from the paper sheets (千日前店 2025-09-12, 御堂筋店 2025-09-10). Standards differ per store; 米 only at 千日前店.
insert into public.stock_items (store_id, code, name_ja, unit, pack_size, pack_unit, standard, sort_order)
select s.id, v.code, v.name_ja, v.unit, v.pack_size, v.pack_unit,
       case s.code when 'sennichimae' then v.std_s else v.std_m end, v.sort_order
from public.stores s
cross join (values
  ('noodle',      '麺',                  'piece',  50,   'tier', 750,  500,  10),
  ('kimchi',      'キムチ',              'bag',    null, null,   4,    3,    20),
  ('nira',        'ニラ',                'bag',    null, null,   6,    5,    30),
  ('negi',        'ねぎ',                'bag',    null, null,   15,   15,   40),
  ('moyashi',     'もやし',              'bag',    null, null,   null, null, 50),
  ('momo',        'もも肉',              'bag',    4,    'box',  null, null, 60),
  ('tonkotsu',    '豚骨',                'box',    null, null,   null, null, 70),
  ('momiji',      'もみじ',              'bag',    2,    'box',  null, null, 80),
  ('garlic',      'にんにく',            'bag',    null, null,   null, null, 90),
  ('seasoning',   'チャーシュー用調味料', 'bag',    null, null,   2,    1,    100),
  ('renge',       'レンゲ',              'stick',  null, null,   null, null, 110),
  ('haku',        'ハク',                'bag',    10,   'box',  10,   10,   120),
  ('paitan',      'パイタン',            'liter',  23.3, 'can',  46.0, 40.0, 130),
  ('rice',        '米',                  'bag',    6,    'box',  null, null, 140),
  ('detergent',   '洗剤',            'stick',  null, null,   null, null, 150),
  ('sesame_oil',  'ゴマ油',              'stick',  null, null,   null, null, 160),
  ('gloves',      '手袋',                'box',    null, null,   null, null, 170),
  ('wrap',        'ラップ',              'stick',  null, null,   null, null, 180),
  ('tissue',      'ティッシュ',          'box',    null, null,   null, null, 190)
) as v (code, name_ja, unit, pack_size, pack_unit, std_s, std_m, sort_order)
where s.code in ('sennichimae', 'midosuji')
  and not (v.code = 'rice' and s.code = 'midosuji');
