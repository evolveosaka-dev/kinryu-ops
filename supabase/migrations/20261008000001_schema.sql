-- Kinryu Ops — core schema, helper functions, triggers and Row Level Security.
-- Business dates are Asia/Tokyo calendar dates on which a shift STARTS.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_ja text not null,
  name_en text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id),
  display_name text not null default '',
  email text,
  role text not null default 'staff' check (role in ('staff', 'manager', 'admin')),
  can_patrol boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'active', 'inactive')),
  privacy_accepted_at timestamptz,
  home_store_id uuid references public.stores (id),
  locale text not null default 'ja' check (locale in ('ja', 'en', 'si', 'ne', 'vi')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Accounts that get a role automatically at first sign-in (e.g. the first manager).
create table public.bootstrap_accounts (
  email text primary key check (email = lower(email)),
  role text not null default 'staff' check (role in ('staff', 'manager', 'admin')),
  can_patrol boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.target_bowls (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id),
  month date not null check (extract(day from month) = 1),
  shift text not null check (shift in ('early', 'middle', 'late')),
  day_type text not null check (day_type in ('weekday', 'weekend_holiday')),
  bowls int not null check (bowls >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, month, shift, day_type)
);

create table public.holidays (
  date date primary key,
  name_ja text not null
);

create table public.chorei_records (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id),
  business_date date not null,
  shift text not null check (shift in ('early', 'middle', 'late')),
  leader_id uuid not null default auth.uid() references public.profiles (id),
  participants uuid[] not null default '{}',
  participants_extra text[] not null default '{}',
  stock_none boolean not null default false,
  stock_text text,
  target_bowls int check (target_bowls >= 0),
  caution_text text,
  steps_done jsonb not null default
    '{"greeting":true,"philosophy":true,"phrases":true,"handover":true,"grooming":true,"closing":true}',
  skip_reason text,
  submitted_at timestamptz not null default now(),
  status text not null default 'valid' check (status in ('valid', 'void')),
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chorei_stock_given check (stock_none or coalesce(btrim(stock_text), '') <> ''),
  constraint chorei_skip_reason check (
    coalesce(btrim(skip_reason), '') <> '' or not jsonb_path_exists(steps_done, '$.* ? (@ == false)')
  ),
  constraint chorei_void_reason check (status = 'valid' or coalesce(btrim(void_reason), '') <> '')
);
create unique index chorei_one_per_slot on public.chorei_records (store_id, business_date, shift)
  where status = 'valid';
create index chorei_by_date on public.chorei_records (business_date desc);

create table public.chorei_notes (
  id uuid primary key default gen_random_uuid(),
  chorei_id uuid not null references public.chorei_records (id),
  author_id uuid not null default auth.uid() references public.profiles (id),
  body text not null check (btrim(body) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Same thresholds as src/domain/patrol.ts judgementOf()
create function public.patrol_judgement(total int, max_total int)
returns text language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when total is null then null
    when max_total = 25 then case when total >= 20 then 'good' when total >= 15 then 'improve' else 'coaching' end
    else case when total >= 16 then 'good' when total >= 12 then 'improve' else 'coaching' end
  end
$$;

create table public.patrol_checks (
  id uuid primary key default gen_random_uuid(),
  patroller_id uuid not null default auth.uid() references public.profiles (id),
  store_id uuid not null references public.stores (id),
  business_date date not null,
  shift text not null check (shift in ('early', 'middle', 'late')),
  patrol_type text not null check (patrol_type in ('after_shift', 'early')),
  started_at timestamptz not null,
  ended_at timestamptz,
  score_smile smallint check (score_smile between 1 and 5),
  score_voice smallint check (score_voice between 1 and 5),
  score_grooming smallint check (score_grooming between 1 and 5),
  score_clean smallint check (score_clean between 1 and 5),
  score_quality smallint check (score_quality between 1 and 5), -- null = not checked (－)
  total smallint generated always as (
    score_smile + score_voice + score_grooming + score_clean + coalesce(score_quality, 0)
  ) stored,
  max_total smallint generated always as (case when score_quality is null then 20 else 25 end) stored,
  judgement text generated always as (
    public.patrol_judgement(
      score_smile + score_voice + score_grooming + score_clean + coalesce(score_quality, 0),
      case when score_quality is null then 20 else 25 end
    )
  ) stored,
  duration_min int generated always as (
    floor(extract(epoch from (ended_at - started_at)) / 60)::int
  ) stored,
  needs_time_review boolean not null default false,
  staff_on_shift text not null default '全員',
  good_points text,
  improvements text,
  remarks text,
  follow_up_done_at timestamptz,
  follow_up_note text,
  submitted_at timestamptz,
  status text not null default 'valid' check (status in ('draft', 'valid', 'void')),
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patrol_time_order check (ended_at is null or ended_at > started_at),
  -- a finalised check must be complete
  constraint patrol_complete check (
    status <> 'valid' or (
      ended_at is not null and submitted_at is not null
      and score_smile is not null and score_voice is not null
      and score_grooming is not null and score_clean is not null
      and coalesce(btrim(good_points), '') <> '' and coalesce(btrim(improvements), '') <> ''
    )
  ),
  constraint patrol_void_reason check (status <> 'void' or coalesce(btrim(void_reason), '') <> '')
);
create index patrol_by_date on public.patrol_checks (business_date desc);
create index patrol_by_patroller on public.patrol_checks (patroller_id, business_date);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  table_name text not null,
  row_id uuid not null,
  action text not null,
  diff jsonb not null default '{}',
  at timestamptz not null default now()
);

create table public.alert_log (
  id bigint generated always as identity primary key,
  kind text not null,
  key text not null unique,
  sent_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so RLS policies can call them cheaply)
-- ---------------------------------------------------------------------------

create function public.is_active() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.profiles where id = auth.uid() and status = 'active') $$;

create function public.is_manager() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active' and role in ('manager', 'admin')
  )
$$;

create function public.can_patrol() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.profiles where id = auth.uid() and status = 'active' and can_patrol) $$;

create function public.my_store() returns uuid
language sql stable security definer set search_path = ''
as $$ select home_store_id from public.profiles where id = auth.uid() $$;

create function public.tokyo_today() returns date
language sql stable set search_path = ''
as $$ select (now() at time zone 'Asia/Tokyo')::date $$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create function public.set_updated_at() returns trigger
language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end $$;

create trigger stores_updated before update on public.stores for each row execute function public.set_updated_at();
create trigger profiles_updated before update on public.profiles for each row execute function public.set_updated_at();
create trigger target_bowls_updated before update on public.target_bowls for each row execute function public.set_updated_at();
create trigger chorei_updated before update on public.chorei_records for each row execute function public.set_updated_at();
create trigger chorei_notes_updated before update on public.chorei_notes for each row execute function public.set_updated_at();
create trigger patrol_updated before update on public.patrol_checks for each row execute function public.set_updated_at();

-- New auth user → profile (pending unless listed in bootstrap_accounts)
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  boot public.bootstrap_accounts;
begin
  select * into boot from public.bootstrap_accounts where email = lower(new.email);
  insert into public.profiles (id, email, display_name, role, can_patrol, status, locale)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(boot.role, 'staff'),
    coalesce(boot.can_patrol, false),
    case when boot.email is null then 'pending' else 'active' end,
    case when new.raw_user_meta_data ->> 'locale' in ('ja', 'en', 'si', 'ne', 'vi')
         then new.raw_user_meta_data ->> 'locale' else 'ja' end
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Non-managers may only change their own display name, locale, privacy acceptance,
-- and their home store while still pending.
create function public.guard_profile_update() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if public.is_manager() or auth.uid() is null then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.can_patrol is distinct from old.can_patrol
     or new.status is distinct from old.status
     or new.email is distinct from old.email
     or (new.home_store_id is distinct from old.home_store_id and old.status <> 'pending') then
    raise exception 'only managers can change role, permissions, status or store' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- 朝礼: non-managers submit for "today ± 1" only, cannot change the leader or void.
create function public.guard_chorei() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if public.is_manager() or auth.uid() is null then
    return new;
  end if;
  if new.business_date not between public.tokyo_today() - 1 and public.tokyo_today() + 1 then
    raise exception 'business_date out of range' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    new.submitted_at := now();
    new.status := 'valid';
    new.void_reason := null;
  else
    if new.leader_id is distinct from old.leader_id or new.status is distinct from old.status
       or new.submitted_at is distinct from old.submitted_at then
      raise exception 'only managers can void or reassign a record' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger chorei_guard before insert or update on public.chorei_records
  for each row execute function public.guard_chorei();

-- 巡回: server-side sanity of times; patrollers cannot touch times after finalising.
create function public.guard_patrol() returns trigger
language plpgsql set search_path = ''
as $$
declare
  limit_ts timestamptz := now() + interval '5 minutes';
begin
  if new.status = 'valid' and (tg_op = 'INSERT' or old.status = 'draft') then
    new.submitted_at := coalesce(new.submitted_at, now());
    if new.ended_at - new.started_at > interval '60 minutes' then
      new.needs_time_review := true;
    end if;
  end if;

  if public.is_manager() or auth.uid() is null then
    return new;
  end if;

  if new.business_date not between public.tokyo_today() - 1 and public.tokyo_today() + 1 then
    raise exception 'business_date out of range' using errcode = '22023';
  end if;
  if new.started_at > limit_ts or new.ended_at > limit_ts then
    raise exception 'times cannot be in the future' using errcode = '22023';
  end if;
  if new.status = 'void' or new.follow_up_done_at is not null then
    raise exception 'only managers can void or close follow-ups' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.needs_time_review := new.needs_time_review and new.status = 'valid'
      and new.ended_at - new.started_at > interval '60 minutes';
    if new.started_at < now() - interval '1 day' then
      raise exception 'started_at too old' using errcode = '22023';
    end if;
  else
    if new.patroller_id is distinct from old.patroller_id then
      raise exception 'cannot change patroller' using errcode = '42501';
    end if;
    if old.status = 'valid' and (
      new.started_at is distinct from old.started_at or new.ended_at is distinct from old.ended_at
      or new.status is distinct from old.status or new.needs_time_review is distinct from old.needs_time_review
    ) then
      raise exception 'only managers can correct patrol times' using errcode = '42501';
    end if;
    if old.status = 'draft' and new.started_at is distinct from old.started_at then
      raise exception 'cannot change start time' using errcode = '42501';
    end if;
    if old.needs_time_review and not new.needs_time_review then
      raise exception 'only managers can clear the time review flag' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger patrol_guard before insert or update on public.patrol_checks
  for each row execute function public.guard_patrol();

-- Audit trail of every update
create function public.write_audit() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  changes jsonb := '{}';
  k text;
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
begin
  for k in select jsonb_object_keys(n) loop
    if k <> 'updated_at' and (o -> k) is distinct from (n -> k) then
      changes := changes || jsonb_build_object(k, jsonb_build_object('old', o -> k, 'new', n -> k));
    end if;
  end loop;
  if changes <> '{}' then
    insert into public.audit_log (actor_id, table_name, row_id, action, diff)
    values (auth.uid(), tg_table_name, new.id,
            case when n ->> 'status' = 'void' and o ->> 'status' <> 'void' then 'void' else 'update' end,
            changes);
  end if;
  return new;
end $$;

create trigger profiles_audit after update on public.profiles for each row execute function public.write_audit();
create trigger chorei_audit after update on public.chorei_records for each row execute function public.write_audit();
create trigger patrol_audit after update on public.patrol_checks for each row execute function public.write_audit();
create trigger target_bowls_audit after update on public.target_bowls for each row execute function public.write_audit();

-- ---------------------------------------------------------------------------
-- RPCs for staff (return only what the form needs, across stores)
-- ---------------------------------------------------------------------------

-- Names of active staff (for participant pickers and history display).
create function public.staff_directory()
returns table (id uuid, display_name text, home_store_id uuid, can_patrol boolean)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.display_name, p.home_store_id, p.can_patrol
  from public.profiles p
  where public.is_active() and p.status = 'active'
  order by p.display_name
$$;

-- What the 朝礼 form needs for a slot: the existing record (if any) and the previous shift's handover.
create function public.chorei_slot(p_store uuid, p_date date, p_shift text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  prev_date date := case when p_shift = 'early' then p_date - 1 else p_date end;
  prev_shift text := case p_shift when 'early' then 'late' when 'middle' then 'early' else 'middle' end;
  existing jsonb;
  previous jsonb;
begin
  if not public.is_active() then
    return null;
  end if;
  select jsonb_build_object('id', c.id, 'leader', p.display_name, 'submitted_at', c.submitted_at)
    into existing
    from public.chorei_records c join public.profiles p on p.id = c.leader_id
   where c.store_id = p_store and c.business_date = p_date and c.shift = p_shift and c.status = 'valid';
  select jsonb_build_object(
           'id', c.id, 'business_date', c.business_date, 'shift', c.shift, 'leader', p.display_name,
           'stock_none', c.stock_none, 'stock_text', c.stock_text, 'target_bowls', c.target_bowls,
           'caution_text', c.caution_text, 'submitted_at', c.submitted_at,
           'notes', coalesce((select jsonb_agg(jsonb_build_object('body', n.body, 'author', a.display_name) order by n.created_at)
                              from public.chorei_notes n join public.profiles a on a.id = n.author_id
                              where n.chorei_id = c.id), '[]'))
    into previous
    from public.chorei_records c join public.profiles p on p.id = c.leader_id
   where c.store_id = p_store and c.business_date = prev_date and c.shift = prev_shift and c.status = 'valid';
  return jsonb_build_object('existing', existing, 'previous', previous);
end $$;

-- Add a note to an existing 朝礼 record (any active user, instead of a duplicate record).
create function public.add_chorei_note(p_chorei uuid, p_body text)
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
  insert into public.chorei_notes (chorei_id, author_id, body) values (p_chorei, auth.uid(), p_body)
  returning id into new_id;
  return new_id;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.stores enable row level security;
alter table public.profiles enable row level security;
alter table public.bootstrap_accounts enable row level security;
alter table public.target_bowls enable row level security;
alter table public.holidays enable row level security;
alter table public.chorei_records enable row level security;
alter table public.chorei_notes enable row level security;
alter table public.patrol_checks enable row level security;
alter table public.audit_log enable row level security;
alter table public.alert_log enable row level security;

-- stores: every signed-in user may read (needed to choose a home store while pending)
create policy stores_select on public.stores for select to authenticated using (true);
create policy stores_write on public.stores for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_manager());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_manager())
  with check (id = auth.uid() or public.is_manager());

-- bootstrap_accounts: managers only
create policy bootstrap_manage on public.bootstrap_accounts for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- reference data
create policy target_bowls_select on public.target_bowls for select to authenticated using (public.is_active());
create policy target_bowls_write on public.target_bowls for all to authenticated
  using (public.is_manager()) with check (public.is_manager());
create policy holidays_select on public.holidays for select to authenticated using (public.is_active());
create policy holidays_write on public.holidays for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- chorei_records
create policy chorei_select on public.chorei_records for select to authenticated
  using (
    public.is_manager()
    or (public.is_active() and leader_id = auth.uid())
    or (public.is_active() and store_id = public.my_store() and business_date >= public.tokyo_today() - 7)
  );
create policy chorei_insert on public.chorei_records for insert to authenticated
  with check (public.is_active() and leader_id = auth.uid());
create policy chorei_update on public.chorei_records for update to authenticated
  using (public.is_manager() or (public.is_active() and leader_id = auth.uid() and submitted_at > now() - interval '2 hours'))
  with check (public.is_manager() or (leader_id = auth.uid()));

-- chorei_notes (inserted through add_chorei_note)
create policy chorei_notes_select on public.chorei_notes for select to authenticated
  using (exists (select 1 from public.chorei_records c where c.id = chorei_id));
create policy chorei_notes_update on public.chorei_notes for update to authenticated
  using (public.is_manager() or (author_id = auth.uid() and created_at > now() - interval '2 hours'))
  with check (public.is_manager() or author_id = auth.uid());

-- patrol_checks
create policy patrol_select on public.patrol_checks for select to authenticated
  using (public.is_manager() or (public.is_active() and patroller_id = auth.uid()));
create policy patrol_insert on public.patrol_checks for insert to authenticated
  with check (public.can_patrol() and patroller_id = auth.uid());
create policy patrol_update on public.patrol_checks for update to authenticated
  using (
    public.is_manager()
    or (public.can_patrol() and patroller_id = auth.uid()
        and (status = 'draft' or submitted_at > now() - interval '24 hours'))
  )
  with check (public.is_manager() or patroller_id = auth.uid());
create policy patrol_delete_draft on public.patrol_checks for delete to authenticated
  using (patroller_id = auth.uid() and status = 'draft');

-- logs: read by managers, written by triggers / service role only
create policy audit_select on public.audit_log for select to authenticated using (public.is_manager());
create policy alert_select on public.alert_log for select to authenticated using (public.is_manager());

-- anon must not see or call anything
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to service_role;
grant execute on all functions in schema public to authenticated;
