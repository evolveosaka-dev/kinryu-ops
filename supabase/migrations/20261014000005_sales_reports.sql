-- 販売日報 (日報 page 1), one per store × business date × shift; several people may save it, every save is logged.
--   食券 (ラーメン / チャーシューメン / クーポン) → 合計, compared with 目標杯数;
--   麺の照合: 食券合計 − (麺の出庫 − まかない − 廃棄) — 麺 figures come from 在庫・仕入 (snapshot sent by the app);
--   スタッフ (from the shift table, editable), 現金出納帳, 現金 counted per denomination,
--   繰越 = the previous shift's counted cash, 過不足 = counted − (繰越 + 入金 − 出金);
--   水道メーター (up to 5 digits), 連絡事項. まかない is stored but hidden in the app for now.
-- After 送信, the people who wrote it may still change it for 12 hours; afterwards managers only.
-- Each 送信 notifies the managers (kind 'sales'): at once when 麺差引 or 現金過不足 is not 0, otherwise in the 7:30 summary.

create table public.sales_reports (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id),
  business_date date not null,
  shift text not null check (shift in ('early', 'middle', 'late')),
  -- { "ramen": 154, "chashu": 26, "coupon": 0 }
  tickets jsonb not null default '{}',
  ticket_total int not null default 0,
  target_bowls int,
  -- まかない [{ "name": "…", "qty": 1 }] (hidden in the app for now)
  meals jsonb not null default '[]',
  -- [{ "name", "start": "07:00", "end": "11:00", "status": normal|late|early_leave|overtime|absent, "note" }]
  staff jsonb not null default '[]',
  -- [{ "time": "10:05", "type": in|out|refund, "detail", "name", "amount", "reason" }]
  cash_book jsonb not null default '[]',
  -- { "10000": 0, "5000": 1, … "1": 0 }
  cash_counts jsonb not null default '{}',
  cash_carried int,
  cash_carried_manual boolean not null default false,
  cash_in int not null default 0,
  cash_out int not null default 0,
  cash_expected int,
  cash_actual int,
  cash_diff int,
  cash_diff_reason text check (char_length(cash_diff_reason) <= 500),
  noodle_out numeric(8, 1),
  noodle_lost numeric(8, 1),
  noodle_meals int,
  noodle_diff numeric(8, 1),
  noodle_reason text check (char_length(noodle_reason) <= 500),
  -- { "07:00": "5903", "11:00": "", "17:00": "5915" }
  water jsonb not null default '{}',
  notes text check (char_length(notes) <= 2000),
  original_texts jsonb,
  source_lang text,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  submitted_at timestamptz,
  submitted_by uuid references public.profiles (id),
  submitted_by_name text,
  updated_by uuid references public.profiles (id),
  updated_by_name text,
  by_test_account boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, business_date, shift)
);
create trigger sales_reports_updated before update on public.sales_reports for each row execute function public.set_updated_at();

create table public.sales_report_log (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.sales_reports (id) on delete cascade,
  author_id uuid references public.profiles (id),
  author_name text not null,
  action text not null check (action in ('save', 'submit')),
  sections text[] not null default '{}',
  at timestamptz not null default now()
);
create index sales_report_log_report on public.sales_report_log (report_id, at);

alter table public.sales_reports enable row level security;
alter table public.sales_report_log enable row level security;
revoke all on public.sales_reports, public.sales_report_log from anon;
create policy sales_reports_select on public.sales_reports for select to authenticated
  using (public.is_active() and (not by_test_account or public.is_test_account()));
create policy sales_report_log_select on public.sales_report_log for select to authenticated
  using (exists (select 1 from public.sales_reports r where r.id = report_id));

create function public.save_sales_report(p_store uuid, p_date date, p_shift text, p_data jsonb, p_submit boolean default false)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles;
  old public.sales_reports;
  r public.sales_reports;
  today date := (now() at time zone 'Asia/Tokyo')::date;
  prev_date date;
  prev_shift text;
  prev_actual int;
  my_name text;
  changed text[] := '{}';
  sec text;
  x jsonb;
  new_id uuid;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'active';
  if me.id is null then
    raise exception 'active users only' using errcode = '42501';
  end if;
  if not public.is_manager() and p_date not between today - 1 and today + 1 then
    raise exception 'date out of range' using errcode = '22023';
  end if;
  if p_shift not in ('early', 'middle', 'late') or not exists (select 1 from public.stores where id = p_store and active) then
    raise exception 'bad slot' using errcode = '22023';
  end if;
  my_name := coalesce(nullif(btrim(me.display_name), ''), me.full_name, '—');

  -- validation of the parts
  if exists (select 1 from jsonb_each(coalesce(p_data -> 'tickets', '{}')) t
             where t.key not in ('ramen', 'chashu', 'coupon') or jsonb_typeof(t.value) <> 'number' or (t.value)::numeric not between 0 and 10000
                or (t.value)::numeric <> trunc((t.value)::numeric)) then
    raise exception 'bad tickets' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_each(coalesce(p_data -> 'cash_counts', '{}')) c
             where c.key not in ('10000', '5000', '2000', '1000', '500', '100', '50', '10', '5', '1')
                or jsonb_typeof(c.value) <> 'number' or (c.value)::numeric not between 0 and 100000 or (c.value)::numeric <> trunc((c.value)::numeric)) then
    raise exception 'bad cash counts' using errcode = '22023';
  end if;
  for x in select * from jsonb_array_elements(coalesce(p_data -> 'cash_book', '[]')) loop
    if coalesce(x ->> 'type', '') not in ('in', 'out', 'refund') or jsonb_typeof(x -> 'amount') <> 'number'
       or (x ->> 'amount')::numeric not between 1 and 10000000 or (x ->> 'amount')::numeric <> trunc((x ->> 'amount')::numeric)
       or (x ->> 'type' = 'refund' and nullif(btrim(coalesce(x ->> 'reason', '')), '') is null) then
      raise exception 'bad cash book' using errcode = '22023';
    end if;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p_data -> 'staff', '[]')) loop
    if nullif(btrim(coalesce(x ->> 'name', '')), '') is null
       or coalesce(x ->> 'status', '') not in ('normal', 'late', 'early_leave', 'overtime', 'absent') then
      raise exception 'bad staff' using errcode = '22023';
    end if;
  end loop;
  if exists (select 1 from jsonb_each_text(coalesce(p_data -> 'water', '{}')) w where w.value <> '' and w.value !~ '^\d{1,5}$') then
    raise exception 'bad water meter' using errcode = '22023';
  end if;

  select * into old from public.sales_reports where store_id = p_store and business_date = p_date and shift = p_shift;
  if old.id is not null and old.by_test_account <> public.is_test_account() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if old.status = 'submitted' and not public.is_manager()
     and (old.submitted_at < now() - interval '12 hours'
          or not exists (select 1 from public.sales_report_log l where l.report_id = old.id and l.author_id = me.id)) then
    raise exception 'locked: only managers can change it now' using errcode = '42501';
  end if;

  -- 繰越 = the previous shift's counted cash; typed by hand only when there is none
  prev_date := case when p_shift = 'early' then p_date - 1 else p_date end;
  prev_shift := case p_shift when 'early' then 'late' when 'middle' then 'early' else 'middle' end;
  select cash_actual into prev_actual from public.sales_reports
   where store_id = p_store and business_date = prev_date and shift = prev_shift and by_test_account = public.is_test_account();

  r.store_id := p_store;
  r.business_date := p_date;
  r.shift := p_shift;
  r.tickets := coalesce(p_data -> 'tickets', '{}');
  r.ticket_total := coalesce((select sum((v)::int) from jsonb_each_text(r.tickets) t(k, v)), 0);
  r.target_bowls := (p_data ->> 'target_bowls')::int;
  r.meals := coalesce(p_data -> 'meals', '[]');
  r.staff := coalesce(p_data -> 'staff', '[]');
  r.cash_book := coalesce(p_data -> 'cash_book', '[]');
  r.cash_counts := coalesce(p_data -> 'cash_counts', '{}');
  r.cash_carried_manual := prev_actual is null;
  r.cash_carried := coalesce(prev_actual, (p_data ->> 'cash_carried')::int);
  r.cash_in := coalesce((select sum((e ->> 'amount')::int) from jsonb_array_elements(r.cash_book) e where e ->> 'type' = 'in'), 0);
  r.cash_out := coalesce((select sum((e ->> 'amount')::int) from jsonb_array_elements(r.cash_book) e where e ->> 'type' in ('out', 'refund')), 0);
  r.cash_expected := case when r.cash_carried is null then null else r.cash_carried + r.cash_in - r.cash_out end;
  r.cash_actual := case when r.cash_counts = '{}' then null
                        else (select sum(k::int * (v)::int) from jsonb_each_text(r.cash_counts) t(k, v)) end;
  r.cash_diff := r.cash_actual - r.cash_expected;
  r.cash_diff_reason := nullif(btrim(coalesce(p_data ->> 'cash_diff_reason', '')), '');
  r.noodle_out := (p_data ->> 'noodle_out')::numeric;
  r.noodle_lost := (p_data ->> 'noodle_lost')::numeric;
  r.noodle_meals := (p_data ->> 'noodle_meals')::int;
  r.noodle_diff := case when r.noodle_out is null then null
                        else r.ticket_total - (r.noodle_out - coalesce(r.noodle_meals, 0) - coalesce(r.noodle_lost, 0)) end;
  r.noodle_reason := nullif(btrim(coalesce(p_data ->> 'noodle_reason', '')), '');
  r.water := coalesce(p_data -> 'water', '{}');
  r.notes := nullif(btrim(coalesce(p_data ->> 'notes', '')), '');
  r.original_texts := nullif(p_data -> 'original_texts', 'null'::jsonb);
  r.source_lang := p_data ->> 'source_lang';

  if p_submit then
    if r.tickets = '{}' or r.cash_actual is null or r.cash_carried is null then
      raise exception 'tickets and cash are required' using errcode = '22023';
    end if;
    if r.cash_diff <> 0 and r.cash_diff_reason is null then
      raise exception 'cash difference needs a reason' using errcode = '22023';
    end if;
    if coalesce(r.noodle_diff, 0) <> 0 and r.noodle_reason is null then
      raise exception 'noodle difference needs a reason' using errcode = '22023';
    end if;
  end if;

  -- which parts changed (for the history)
  foreach sec in array array['tickets', 'meals', 'staff', 'cash_book', 'cash', 'noodle', 'water', 'notes'] loop
    if old.id is null
       or (sec = 'tickets' and r.tickets is distinct from old.tickets)
       or (sec = 'meals' and r.meals is distinct from old.meals)
       or (sec = 'staff' and r.staff is distinct from old.staff)
       or (sec = 'cash_book' and r.cash_book is distinct from old.cash_book)
       or (sec = 'cash' and (r.cash_counts, r.cash_carried, r.cash_diff_reason) is distinct from (old.cash_counts, old.cash_carried, old.cash_diff_reason))
       or (sec = 'noodle' and (r.noodle_out, r.noodle_lost, r.noodle_reason) is distinct from (old.noodle_out, old.noodle_lost, old.noodle_reason))
       or (sec = 'water' and r.water is distinct from old.water)
       or (sec = 'notes' and r.notes is distinct from old.notes) then
      if old.id is not null or (sec = 'tickets' and r.tickets <> '{}') or (sec = 'meals' and r.meals <> '[]') or (sec = 'staff' and r.staff <> '[]')
         or (sec = 'cash_book' and r.cash_book <> '[]') or (sec = 'cash' and r.cash_counts <> '{}') or (sec = 'noodle' and r.noodle_out is not null)
         or (sec = 'water' and r.water <> '{}') or (sec = 'notes' and r.notes is not null) then
        changed := changed || sec;
      end if;
    end if;
  end loop;

  insert into public.sales_reports as s (
    store_id, business_date, shift, tickets, ticket_total, target_bowls, meals, staff, cash_book, cash_counts,
    cash_carried, cash_carried_manual, cash_in, cash_out, cash_expected, cash_actual, cash_diff, cash_diff_reason,
    noodle_out, noodle_lost, noodle_meals, noodle_diff, noodle_reason, water, notes, original_texts, source_lang,
    status, submitted_at, submitted_by, submitted_by_name, updated_by, updated_by_name, by_test_account)
  values (
    r.store_id, r.business_date, r.shift, r.tickets, r.ticket_total, r.target_bowls, r.meals, r.staff, r.cash_book, r.cash_counts,
    r.cash_carried, r.cash_carried_manual, r.cash_in, r.cash_out, r.cash_expected, r.cash_actual, r.cash_diff, r.cash_diff_reason,
    r.noodle_out, r.noodle_lost, r.noodle_meals, r.noodle_diff, r.noodle_reason, r.water, r.notes, r.original_texts, r.source_lang,
    case when p_submit then 'submitted' else 'draft' end,
    case when p_submit then now() end, case when p_submit then me.id end, case when p_submit then my_name end,
    me.id, my_name, public.is_test_account())
  on conflict (store_id, business_date, shift) do update set
    tickets = excluded.tickets, ticket_total = excluded.ticket_total, target_bowls = excluded.target_bowls, meals = excluded.meals,
    staff = excluded.staff, cash_book = excluded.cash_book, cash_counts = excluded.cash_counts,
    cash_carried = excluded.cash_carried, cash_carried_manual = excluded.cash_carried_manual, cash_in = excluded.cash_in,
    cash_out = excluded.cash_out, cash_expected = excluded.cash_expected, cash_actual = excluded.cash_actual,
    cash_diff = excluded.cash_diff, cash_diff_reason = excluded.cash_diff_reason, noodle_out = excluded.noodle_out,
    noodle_lost = excluded.noodle_lost, noodle_meals = excluded.noodle_meals, noodle_diff = excluded.noodle_diff,
    noodle_reason = excluded.noodle_reason, water = excluded.water, notes = excluded.notes,
    original_texts = excluded.original_texts, source_lang = excluded.source_lang,
    -- once sent it stays sent; a later 送信 records the new sender and time
    status = case when p_submit then 'submitted' else s.status end,
    submitted_at = case when p_submit then now() else s.submitted_at end,
    submitted_by = case when p_submit then me.id else s.submitted_by end,
    submitted_by_name = case when p_submit then my_name else s.submitted_by_name end,
    updated_by = me.id, updated_by_name = my_name
  returning id into new_id;

  if p_submit or cardinality(changed) > 0 then
    insert into public.sales_report_log (report_id, author_id, author_name, action, sections)
    values (new_id, me.id, my_name, case when p_submit then 'submit' else 'save' end, changed);
  end if;
  if p_submit and not public.is_test_account() then
    -- a later 送信 of the same report replaces a mail still waiting
    perform public.add_notify_event('sales', 'sales_reports', new_id,
      coalesce(r.noodle_diff, 0) <> 0 or coalesce(r.cash_diff, 0) <> 0, '{}', 'sales:' || new_id);
  end if;
  return new_id;
end $$;

revoke execute on function public.save_sales_report(uuid, date, text, jsonb, boolean) from anon, public;
grant execute on function public.save_sales_report(uuid, date, text, jsonb, boolean) to authenticated;

-- notifications: kind 'sales' (on for every current recipient)
alter table public.notify_events drop constraint if exists notify_events_kind_check;
alter table public.notify_events add constraint notify_events_kind_check
  check (kind in ('chorei', 'chorei_note', 'patrol', 'shift_request', 'signup', 'edit', 'staff_alert', 'stock', 'sales'));
alter table public.notify_recipients drop constraint if exists notify_recipients_kinds_check;
alter table public.notify_recipients add constraint notify_recipients_kinds_check
  check (kinds <@ array['chorei', 'chorei_note', 'patrol', 'shift_request', 'signup', 'edit', 'staff_alert', 'stock', 'sales']);
alter table public.notify_recipients alter column kinds
  set default array['chorei', 'chorei_note', 'patrol', 'shift_request', 'signup', 'edit', 'staff_alert', 'stock', 'sales'];
update public.notify_recipients set kinds = kinds || array['sales'] where not ('sales' = any(kinds));
