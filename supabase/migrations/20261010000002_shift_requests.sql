-- シフト希望提出: one request per staff member per month (replaces the Google Form).
-- days: {"2026-11-01": {"early": "full" | "morning" | "afternoon", "early_until_1730": true,
--                       "middle": "ok" | "from_1730", "late": "ok" | "from_2200"}, ...}
-- answers: the extra questions (free text and choices), see src/domain/shiftRequest.ts

create table public.shift_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id),
  month date not null check (extract(day from month) = 1),
  shifts text[] not null check (shifts <@ array['early', 'middle', 'late']::text[] and cardinality(shifts) > 0),
  days jsonb not null default '{}',
  answers jsonb not null default '{}',
  original_texts jsonb,
  source_lang text,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, month)
);

create trigger shift_requests_updated before update on public.shift_requests
  for each row execute function public.set_updated_at();

alter table public.shift_requests enable row level security;

-- Staff manage their own request for the current or a future month; managers read everything.
create policy shift_requests_select on public.shift_requests for select to authenticated
  using (public.is_manager() or (public.is_active() and user_id = auth.uid()));
create policy shift_requests_insert on public.shift_requests for insert to authenticated
  with check (public.is_active() and user_id = auth.uid() and month >= date_trunc('month', public.tokyo_today())::date);
create policy shift_requests_update on public.shift_requests for update to authenticated
  using (public.is_manager() or (public.is_active() and user_id = auth.uid() and month >= date_trunc('month', public.tokyo_today())::date))
  with check (public.is_manager() or user_id = auth.uid());
revoke all on public.shift_requests from anon;
