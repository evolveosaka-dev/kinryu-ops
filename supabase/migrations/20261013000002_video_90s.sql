-- Videos: up to 90 s and 150 MB (was 60 s / 100 MB). Keep in sync with src/lib/media.ts and drive-upload.
alter table public.attachments drop constraint attachment_video_limits;
alter table public.attachments add constraint attachment_video_limits check (
  kind <> 'video' or (size_bytes <= 150 * 1024 * 1024 and coalesce(duration_sec, 0) <= 91)
);
