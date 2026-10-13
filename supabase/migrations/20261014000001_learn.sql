-- 学ぶ (ホーム): 仕事のマニュアル (steps with photos) and 見本動画 (YouTube, unlisted), written by managers.
-- Japanese is the original; learn-translate (Edge Function) fills `translations` for en / vi / ne / si.
-- Photos are in the private Storage bucket "learn" (signed URLs, signed-in active users only).

create table public.learn_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('manual', 'video')),
  category text not null check (category in ('shift', 'position', 'service', 'trouble', 'hygiene', 'other')),
  title text not null check (char_length(btrim(title)) between 1 and 100),
  summary text check (char_length(summary) <= 1000),
  -- [{ "text": "…", "image": "<storage path>" | null }]
  steps jsonb not null default '[]' check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) <= 30),
  mistakes text check (char_length(mistakes) <= 2000),
  video_url text check (char_length(video_url) <= 300),
  -- { "en": { "title", "summary", "steps": ["…"], "mistakes" }, "vi": …, "ne": …, "si": … }
  translations jsonb not null default '{}',
  translated_at timestamptz,
  -- set when the Japanese text changes: a translation older than this is not shown
  content_updated_at timestamptz not null default now(),
  recommended boolean not null default false,
  published boolean not null default false,
  sort_order int not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learn_video_needs_url check (kind <> 'video' or video_url is not null)
);
create index learn_items_list on public.learn_items (kind, category, sort_order, created_at);

create trigger learn_items_updated before update on public.learn_items for each row execute function public.set_updated_at();

create or replace function public.learn_items_stamp() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.content_updated_at := now();
  elsif (new.title, new.summary, new.mistakes) is distinct from (old.title, old.summary, old.mistakes)
     or (select coalesce(jsonb_agg(s -> 'text'), '[]') from jsonb_array_elements(new.steps) s)
        is distinct from (select coalesce(jsonb_agg(s -> 'text'), '[]') from jsonb_array_elements(old.steps) s) then
    new.content_updated_at := now();
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
create trigger learn_items_stamp before insert or update on public.learn_items
  for each row execute function public.learn_items_stamp();

alter table public.learn_items enable row level security;
revoke all on public.learn_items from anon;

-- everyone active reads what is published; managers also see drafts and write
create policy learn_items_select on public.learn_items for select to authenticated
  using (public.is_manager() or (published and public.is_active()));
create policy learn_items_write on public.learn_items for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- a test account (role manager, read only) cannot change them either
create trigger test_account_read_only before insert or update or delete on public.learn_items
  for each row execute function public.guard_test_account_writes();

do $$
begin
  if to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('learn', 'learn', false, 5 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
    create policy learn_read on storage.objects for select to authenticated
      using (bucket_id = 'learn' and public.is_active());
    create policy learn_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'learn' and public.is_manager() and not public.is_test_account());
    create policy learn_update on storage.objects for update to authenticated
      using (bucket_id = 'learn' and public.is_manager() and not public.is_test_account());
    create policy learn_delete on storage.objects for delete to authenticated
      using (bucket_id = 'learn' and public.is_manager() and not public.is_test_account());
  end if;
end $$;
