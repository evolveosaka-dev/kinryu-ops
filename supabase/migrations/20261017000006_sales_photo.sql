-- 販売日報 from a photo of the paper 日報 (1ページ表) (2026-10-16, owner): the Edge Function sales-read reads the
-- photo, the app fills the 販売日報 form with it, and the photo is kept with the report (Drive, like the 在庫 sheet).

alter table public.attachments add column if not exists sales_report_id uuid references public.sales_reports (id) on delete cascade;
alter table public.attachments drop constraint if exists attachment_one_parent;
alter table public.attachments add constraint attachment_one_parent
  check (num_nonnulls(chorei_id, patrol_id, miss_id, stock_event_id, incident_id, lost_item_id, sales_report_id) = 1);
create index if not exists attachments_sales_report on public.attachments (sales_report_id) where sales_report_id is not null;
