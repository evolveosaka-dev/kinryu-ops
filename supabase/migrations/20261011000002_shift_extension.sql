-- 勤務延長: a shift worked longer than in the shift table (e.g. ②案 of the 担当表: 30 min more
-- to lead the 朝礼 and patrol at the other store). original_end_min keeps the shift-table end so the
-- app can tell the staff member 「17:30 → 18:00 延長」. Set by scripts/duties-from-plan.mjs;
-- a re-import of the month (import_shift_month) replaces the rows and clears it.
alter table public.shift_assignments add column if not exists original_end_min int;
alter table public.shift_assignments drop constraint if exists shift_assignments_extension;
alter table public.shift_assignments add constraint shift_assignments_extension
  check (original_end_min is null or original_end_min < end_min);
