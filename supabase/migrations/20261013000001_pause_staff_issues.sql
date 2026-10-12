-- Pause 面談指導の通知 (スタッフ別) for now: no staff_alert events from new patrols.
-- Resume with: alter table public.patrol_checks enable trigger patrol_staff_issues;
alter table public.patrol_checks disable trigger patrol_staff_issues;
