-- 販売杯数 per store × business date × shift (the Excel 「金龍売り上げ杯数」 ★拝数入力シート columns G–L).
-- bowls = ラーメン + チャーシューメン (the Excel's definition); クーポン is kept apart.
-- Past figures are loaded from the Excel (source 'excel', data not in this repo); every 販売日報 that is sent —
-- and every later change of a sent one — writes its figures here (source 'report'), replacing the Excel value.

create table public.daily_sales (
  store_id uuid not null references public.stores (id),
  business_date date not null,
  shift text not null check (shift in ('early', 'middle', 'late')),
  bowls int not null check (bowls between 0 and 100000),
  coupons int check (coupons between 0 and 100000),
  source text not null check (source in ('excel', 'report')),
  report_id uuid references public.sales_reports (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (store_id, business_date, shift)
);
create index daily_sales_date on public.daily_sales (business_date);

alter table public.daily_sales enable row level security;
revoke all on public.daily_sales from anon;
-- managers read; writes only by the trigger below or by SQL (service role)
create policy daily_sales_select on public.daily_sales for select to authenticated using (public.is_manager());

create function public.sync_daily_sales() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'submitted' and not new.by_test_account then
    insert into public.daily_sales (store_id, business_date, shift, bowls, coupons, source, report_id, updated_at)
    values (new.store_id, new.business_date, new.shift,
            coalesce((new.tickets ->> 'ramen')::int, 0) + coalesce((new.tickets ->> 'chashu')::int, 0),
            (new.tickets ->> 'coupon')::int, 'report', new.id, now())
    on conflict (store_id, business_date, shift) do update
      set bowls = excluded.bowls, coupons = excluded.coupons, source = 'report',
          report_id = excluded.report_id, updated_at = now();
  end if;
  return new;
end $$;
create trigger sales_reports_daily_sales after insert or update on public.sales_reports
  for each row execute function public.sync_daily_sales();

-- reports already sent before this migration
insert into public.daily_sales (store_id, business_date, shift, bowls, coupons, source, report_id)
select store_id, business_date, shift,
       coalesce((tickets ->> 'ramen')::int, 0) + coalesce((tickets ->> 'chashu')::int, 0),
       (tickets ->> 'coupon')::int, 'report', id
from public.sales_reports
where status = 'submitted' and not by_test_account
on conflict (store_id, business_date, shift) do nothing;
