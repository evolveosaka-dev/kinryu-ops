-- Photo / video attachments stored in Google Drive (CLAUDE.md §14.5).

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id),
  chorei_id uuid references public.chorei_records (id),
  patrol_id uuid references public.patrol_checks (id),
  kind text not null check (kind in ('image', 'video')),
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  duration_sec numeric,
  drive_folder_id text,
  drive_file_id text,
  drive_url text,
  status text not null default 'pending' check (status in ('pending', 'uploaded', 'failed', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attachment_one_parent check (num_nonnulls(chorei_id, patrol_id) = 1),
  constraint attachment_video_limits check (
    kind <> 'video' or (size_bytes <= 100 * 1024 * 1024 and coalesce(duration_sec, 0) <= 61)
  ),
  constraint attachment_image_size check (kind <> 'image' or size_bytes <= 15 * 1024 * 1024),
  constraint attachment_uploaded_has_file check (status <> 'uploaded' or drive_file_id is not null)
);
create index attachments_chorei on public.attachments (chorei_id) where chorei_id is not null;
create index attachments_patrol on public.attachments (patrol_id) where patrol_id is not null;

create trigger attachments_updated before update on public.attachments
  for each row execute function public.set_updated_at();

-- Max 5 photos + 1 video per record (also checked in the Edge Function).
create function public.check_attachment_limits() returns trigger
language plpgsql set search_path = ''
as $$
declare
  n int;
begin
  select count(*) into n
    from public.attachments a
   where a.kind = new.kind
     and a.status in ('pending', 'uploaded')
     and a.id <> new.id
     and (a.chorei_id = new.chorei_id or a.patrol_id = new.patrol_id);
  if (new.kind = 'image' and n >= 5) or (new.kind = 'video' and n >= 1) then
    raise exception 'attachment limit reached' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger attachments_limits before insert on public.attachments
  for each row execute function public.check_attachment_limits();

alter table public.attachments enable row level security;

-- Rows are written by the Edge Function (service role). Users read their own, managers all.
create policy attachments_select on public.attachments for select to authenticated
  using (public.is_manager() or (public.is_active() and owner_id = auth.uid()));

-- Key/value store for integration state (Drive folder ids, spreadsheet id). Service role only,
-- except the spreadsheet link and last sync time, which managers may read.
create table public.app_kv (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_kv enable row level security;
create policy app_kv_manager_select on public.app_kv for select to authenticated
  using (public.is_manager() and key in ('sheets_url', 'sheets_synced_at'));

revoke all on public.attachments, public.app_kv from anon;
revoke execute on function public.check_attachment_limits() from anon, public;

-- Daily Google Sheets sync at 07:30 JST (22:30 UTC). URL and secret live in Supabase Vault
-- (names: sheets_sync_url, sheets_sync_secret) — never in this file.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net')
     and exists (select 1 from pg_extension where extname = 'pg_cron') then
    create extension if not exists pg_net;
    perform cron.schedule(
      'sync-sheets-daily',
      '30 22 * * *',
      $job$
        select net.http_post(
          url := (select decrypted_secret from vault.decrypted_secrets where name = 'sheets_sync_url'),
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sheets_sync_secret')
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 120000
        )
      $job$
    );
  end if;
end $$;
