import { useQuery } from '@tanstack/react-query'
import { normalizedTo25 } from '../../../domain/patrol'
import { DATA_FROM, type PatrolScore, type Sale } from '../../../domain/salesAnalysis'
import type { WeatherMap } from '../../../domain/forecast'
import { tokyoParts } from '../../../domain/time'
import type { Shift } from '../../../domain/types'
import { unwrap } from '../../../lib/queries'
import { supabase } from '../../../lib/supabase'

/** PostgREST returns at most 1000 rows per request. */
async function pages<T>(get: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; ; i += 1000) {
    const rows = unwrap<T[]>(await get(i, i + 999))
    out.push(...rows)
    if (rows.length < 1000) return out
  }
}

/** Every daily_sales row (managers): bowls = ラーメン + チャーシューメン. */
export function useDailySales() {
  return useQuery({
    queryKey: ['analysis', 'daily_sales'],
    staleTime: 5 * 60 * 1000,
    queryFn: () =>
      pages<Sale>((a, b) => supabase.from('daily_sales').select('store_id, business_date, shift, bowls').order('business_date').order('store_id').order('shift').range(a, b)),
  })
}

/** Valid patrols with their score on 25 (test records left out). */
export function useAnalysisPatrols() {
  return useQuery({
    queryKey: ['analysis', 'patrols'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const rows = await pages<{ business_date: string; store_id: string; shift: Shift; total: number | null; max_total: number | null }>((a, b) =>
        supabase.from('patrol_checks').select('business_date, store_id, shift, total, max_total').eq('status', 'valid').eq('is_test', false).order('business_date').range(a, b),
      )
      return rows
        .filter((r) => r.total !== null && r.max_total !== null)
        .map<PatrolScore>((r) => ({ business_date: r.business_date, store_id: r.store_id, shift: r.shift, score25: normalizedTo25(r.total!, r.max_total!) }))
    },
  })
}

export interface ReportFigures {
  business_date: string
  store_id: string
  shift: Shift
  status: string
  noodle_diff: number | null
  cash_diff: number | null
  tickets: { coupon?: number }
}

/** 販売日報 of a month (for the day detail). */
export function useMonthReports(from: string, to: string) {
  return useQuery({
    queryKey: ['analysis', 'reports', from, to],
    staleTime: 60 * 1000,
    queryFn: async () =>
      unwrap<ReportFigures[]>(
        await supabase.from('sales_reports').select('business_date, store_id, shift, status, noodle_diff, cash_diff, tickets').gte('business_date', from).lte('business_date', to),
      ),
  })
}

/**
 * The weather per business date × shift (weather_shifts: Open-Meteo, Namba, saved every day at 4:45 by
 * sync-sheets action 'weather'; archive = what happened, forecast = ahead). Read in pages of 1000 rows.
 */
export function useWeather() {
  return useQuery({
    queryKey: ['analysis', 'weather', today()],
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const rows: { business_date: string; shift: string; temp_avg: number | null; precip_mm: number; rain_hours: number; source: 'archive' | 'forecast' }[] = []
      for (let from = 0; ; from += 1000) {
        const page = unwrap<typeof rows>(
          await supabase
            .from('weather_shifts')
            .select('business_date, shift, temp_avg, precip_mm, rain_hours, source')
            .gte('business_date', DATA_FROM)
            .order('business_date')
            .order('shift')
            .range(from, from + 999),
        )
        rows.push(...page)
        if (page.length < 1000) break
      }
      if (!rows.length) throw new Error('no weather yet')
      const map: WeatherMap = new Map()
      for (const r of rows) map.set(`${r.business_date}|${r.shift}`, { temp: r.temp_avg === null ? null : Number(r.temp_avg), mm: Number(r.precip_mm), hours: r.rain_hours, source: r.source })
      return map
    },
  })
}

const today = () => tokyoParts(new Date()).date
