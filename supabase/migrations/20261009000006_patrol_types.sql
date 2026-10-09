-- 巡回の種類: 勤務前 / 勤務中 / 勤務後 / ランダム.
-- The old 'early' type (30 min before a 7:00 shift) is a 勤務前 patrol.
alter table public.patrol_checks drop constraint patrol_checks_patrol_type_check;
update public.patrol_checks set patrol_type = 'before_shift' where patrol_type = 'early';
alter table public.patrol_checks
  add constraint patrol_checks_patrol_type_check
  check (patrol_type in ('before_shift', 'in_shift', 'after_shift', 'random'));
