-- Operation starts on 2026-10-12. Everything with an earlier business date is test data:
-- kept, but labelled and excluded from the manager statistics. Keep the date in sync with
-- src/domain/operation.ts (OPERATION_START).

alter table public.chorei_records add column is_test boolean not null default false;
alter table public.patrol_checks add column is_test boolean not null default false;

create function public.set_test_flag() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.is_test := new.business_date < date '2026-10-12';
  return new;
end $$;

create trigger chorei_test_flag before insert or update of business_date on public.chorei_records
  for each row execute function public.set_test_flag();
create trigger patrol_test_flag before insert or update of business_date on public.patrol_checks
  for each row execute function public.set_test_flag();

-- label what already exists
update public.chorei_records set is_test = true where business_date < date '2026-10-12';
update public.patrol_checks set is_test = true where business_date < date '2026-10-12';
