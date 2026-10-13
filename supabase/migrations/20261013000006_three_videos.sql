-- Max 5 photos + 3 videos per record or report (was 1 video). Keep in sync with src/lib/media.ts MAX_VIDEOS.
create or replace function public.check_attachment_limits() returns trigger
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
     and (a.chorei_id = new.chorei_id or a.patrol_id = new.patrol_id or a.miss_id = new.miss_id);
  if (new.kind = 'image' and n >= 5) or (new.kind = 'video' and n >= 3) then
    raise exception 'attachment limit reached' using errcode = '23514';
  end if;
  return new;
end $$;
