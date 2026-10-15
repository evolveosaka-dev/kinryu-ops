-- 天気 on the forecast card (owner, 2026-10-16): the weather of each shift as an icon, so the WMO weather code
-- (Open-Meteo hourly weather_code: 0 clear … 3 overcast, 45/48 fog, 51–67 drizzle / rain, 71–77 snow, 80–82 showers,
-- 95–99 thunderstorm) is kept too: the most frequent code of the shift's hours (ties → the more severe one).
alter table public.weather_shifts add column if not exists weather_code smallint;
