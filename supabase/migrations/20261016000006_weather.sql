-- 天気 (owner, 2026-10-16): the weather of Namba per business date × shift, kept in the database for the forecast and
-- its explanations: average / min / max temperature, rain (mm) and rain hours (hours with ≥ 0.5 mm), from Open-Meteo
-- (archive = what happened, forecast = up to 16 days ahead; an archive row replaces the forecast of that slot).
-- Filled from 2025-01-01 (sales data start) by sync-sheets action 'weather' every day at 4:45 JST and on demand.

create table if not exists public.weather_shifts (
  business_date date not null,
  shift text not null check (shift in ('early', 'middle', 'late')),
  temp_avg numeric(4, 1),
  temp_min numeric(4, 1),
  temp_max numeric(4, 1),
  precip_mm numeric(5, 1) not null default 0,
  rain_hours smallint not null default 0,
  hours smallint not null,
  source text not null check (source in ('archive', 'forecast')),
  fetched_at timestamptz not null default now(),
  primary key (business_date, shift)
);
alter table public.weather_shifts enable row level security;
revoke all on public.weather_shifts from anon;
drop policy if exists weather_shifts_select on public.weather_shifts;
create policy weather_shifts_select on public.weather_shifts for select to authenticated using (public.is_manager());
grant select on public.weather_shifts to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('weather-sync', '45 19 * * *', $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'sheets_sync_url'),
        headers := jsonb_build_object('Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sheets_sync_secret')),
        body := '{"action":"weather"}'::jsonb,
        timeout_milliseconds := 120000)
    $job$);
  end if;
end $$;
