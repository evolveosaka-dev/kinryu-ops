-- 管理 → 朝礼一覧, a ✗ slot:
--  * ✓ = a manager records the 朝礼 afterwards with the 朝礼 form: submitted_at is the meeting time of
--    that slot, entered_by_manager marks it, manager_note holds the manager's remark.
--  * a reason (chorei_misses) can carry photos / videos: attachments.miss_id.

alter table public.chorei_records
  add column manager_note text check (char_length(manager_note) <= 2000),
  add column entered_by_manager boolean not null default false;

-- only managers set these two
create or replace function public.guard_chorei_manager_fields() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if auth.uid() is null or public.is_manager() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.entered_by_manager := false;
    new.manager_note := null;
  else
    new.entered_by_manager := old.entered_by_manager;
    new.manager_note := old.manager_note;
  end if;
  return new;
end $$;
create trigger chorei_manager_fields before insert or update on public.chorei_records
  for each row execute function public.guard_chorei_manager_fields();

alter table public.attachments
  add column miss_id uuid references public.chorei_misses (id) on delete cascade;
alter table public.attachments drop constraint attachment_one_parent;
alter table public.attachments add constraint attachment_one_parent check (num_nonnulls(chorei_id, patrol_id, miss_id) = 1);
create index attachments_miss on public.attachments (miss_id) where miss_id is not null;

-- Max 5 photos + 1 video per record or report.
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
  if (new.kind = 'image' and n >= 5) or (new.kind = 'video' and n >= 1) then
    raise exception 'attachment limit reached' using errcode = '23514';
  end if;
  return new;
end $$;
