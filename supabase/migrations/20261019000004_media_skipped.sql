-- 「接客中のため、写真・動画の撮影を控えました」 (owner, 2026-10-19): the 朝礼 / 巡回 forms require a photo (巡回) or a
-- photo or video (朝礼, now required too) unless the writer ticks this box. Kept on the record so managers see why a
-- report has no files. The requirement is checked by the forms only, like the photo of 巡回 before.
alter table public.chorei_records add column media_skipped boolean not null default false;
alter table public.patrol_checks add column media_skipped boolean not null default false;
