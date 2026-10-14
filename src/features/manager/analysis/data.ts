import { useQuery } from '@tanstack/react-query'
import { normalizedTo25 } from '../../../domain/patrol'
import { DATA_FROM, type PatrolScore, type Sale } from '../../../domain/salesAnalysis'
import { shiftRain } from '../../../domain/forecast'
import { addDays, tokyoParts } from '../../../domain/time'
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

/** Osaka (道頓堀 area) */
const LAT = 34.67
const LON = 135.5
interface Hourly {
  hourly: { time: string[]; precipitation: (number | null)[] }
}

/**
 * Rain per date × shift from Open-Meteo (free, no key): the archive from 2025 until 60 days ago, then the
 * forecast API (92 past days + 8 days ahead). Hours are Asia/Tokyo.
 */
export function useRain() {
  return useQuery({
    queryKey: ['analysis', 'rain', today()],
    staleTime: 60 * 60 * 1000,
    retry: 1,
    queryFn: async () => {
      const q = `latitude=${LAT}&longitude=${LON}&hourly=precipitation&timezone=Asia%2FTokyo`
      const archiveTo = addDays(today(), -60)
      const [archive, forecast] = await Promise.all([
        fetch(`https://archive-api.open-meteo.com/v1/archive?${q}&start_date=${DATA_FROM}&end_date=${archiveTo}`),
        fetch(`https://api.open-meteo.com/v1/forecast?${q}&past_days=92&forecast_days=8`),
      ])
      if (!archive.ok || !forecast.ok) throw new Error(`weather ${archive.status} / ${forecast.status}`)
      const a = (await archive.json()) as Hourly
      const f = (await forecast.json()) as Hourly
      // the two overlap: one value per hour (the forecast API wins)
      const byHour = new Map<string, number | null>()
      a.hourly.time.forEach((t, i) => byHour.set(t, a.hourly.precipitation[i] ?? null))
      f.hourly.time.forEach((t, i) => byHour.set(t, f.hourly.precipitation[i] ?? null))
      return shiftRain({ time: [...byHour.keys()], precipitation: [...byHour.values()] })
    },
  })
}

const today = () => tokyoParts(new Date()).date
