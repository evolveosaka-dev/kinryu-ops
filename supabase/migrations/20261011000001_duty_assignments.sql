-- 朝礼・巡回の担当: which patrol member leads which 朝礼 and does which 巡回 (from the
-- 担当表 workbook, sheet ⑦日別スケジュール). The app shows each member their own duties on ホーム.
-- Times are minutes from 00:00 of the business date, like shift_assignments (遅番 23:30 → 1410,
-- 7:30 the next morning → 1890). The rows themselves contain staff names and are loaded by
-- managers / SQL outside this public repository.

create table public.duty_assignments (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  shift text not null check (shift in ('early', 'middle', 'late')),
  store_id uuid not null references public.stores (id),
  roster_name text not null,
  kind text not null check (kind in ('chorei', 'patrol')),
  -- at: 7:00 sharp · about: 11:30ごろ · range: 17:30〜18:00 · during: any free time in the window
  time_mode text not null check (time_mode in ('at', 'about', 'range', 'during')),
  start_min int not null check (start_min between 0 and 2880),
  end_min int not null check (end_min > start_min and end_min <= 2880),
  -- own: at the store where they work · arrival: when they arrive (absent at the set time)
  -- move: walk over from the other store · continue: an early shift that runs past 17:00
  -- extend: working longer than the shift (②の案)
  method text not null check (method in ('own', 'arrival', 'move', 'continue', 'extend')),
  is_plan boolean not null default false,
  staff text,
  created_at timestamptz not null default now(),
  unique (business_date, shift, store_id, roster_name, kind)
);
create index duty_assignments_person on public.duty_assignments (roster_name, business_date);

alter table public.duty_assignments enable row level security;
revoke all on public.duty_assignments from anon;

create policy duty_assignments_select on public.duty_assignments for select to authenticated
  using (public.is_manager() or roster_name = public.my_roster_name());
create policy duty_assignments_write on public.duty_assignments for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- My duties in a date range, with done = the 朝礼 of that slot is recorded (by anyone) /
-- I sent a 巡回チェック for that store and shift.
create function public.my_duties(p_from date, p_to date)
returns table (
  id uuid, business_date date, shift text, store_id uuid, kind text, time_mode text,
  start_min int, end_min int, method text, is_plan boolean, staff text, done boolean
)
language sql stable security definer set search_path = ''
as $$
  select d.id, d.business_date, d.shift, d.store_id, d.kind, d.time_mode, d.start_min, d.end_min,
         d.method, d.is_plan, d.staff,
         case d.kind
           when 'chorei' then exists (
             select 1 from public.chorei_records c
              where c.store_id = d.store_id and c.business_date = d.business_date
                and c.shift = d.shift and c.status = 'valid')
           else exists (
             select 1 from public.patrol_checks p
              where p.patroller_id = auth.uid() and p.store_id = d.store_id
                and p.business_date = d.business_date and p.shift = d.shift and p.status = 'valid')
         end
    from public.duty_assignments d
   where d.roster_name = public.my_roster_name()
     and d.business_date between p_from and p_to
   order by d.business_date, d.start_min, d.kind
$$;

revoke execute on function public.my_duties(date, date) from anon, public;
grant execute on function public.my_duties(date, date) to authenticated;
