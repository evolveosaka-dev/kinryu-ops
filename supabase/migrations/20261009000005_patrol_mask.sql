-- ① 笑顔: if anyone on shift wears a mask, the smile cannot be seen → 1 point.
alter table public.patrol_checks
  add column mask_worn boolean not null default false,
  add constraint patrol_mask_smile check (not mask_worn or score_smile = 1);
