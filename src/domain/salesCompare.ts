// 実績・予測・前年 of one day (owner, 2026-10-19; 管理 → ダッシュボード): per store × shift
//   実績 = daily_sales (販売日報, else the 販売杯数 workbook read from Office 365 at 6:00)
//   予測 = the forecast as it was made the day before: forecastModel as of that day, so only figures before it count
//   前年 = the same weekday a year before (364 days back), as everywhere in 分析
import { forecastModel, forecastSlot, type ForecastModel, type SlotForecast, type WeatherMap } from './forecast'
import { lastYear, slotKey, type Ctx } from './salesAnalysis'
import type { TargetDayType } from './targets'
import { addDays } from './time'
import type { Shift } from './types'

export interface CompareRow {
  store: string
  shift: Shift
  actual: number | null
  forecast: SlotForecast
  lastYear: number | null
}

export interface CompareSum {
  actual: number | null
  forecast: number | null
  lastYear: number | null
}

export interface CompareDay {
  date: string
  lastYearDate: string
  rows: CompareRow[]
  /** per store, then 'all'; a column is null when one of its slots has no figure */
  sums: Record<string, CompareSum> & { all: CompareSum }
  model: ForecastModel
}

const sumOf = (xs: (number | null)[]) => (xs.length && xs.every((x) => x !== null) ? xs.reduce<number>((a, x) => a + x!, 0) : null)

function sums(rows: CompareRow[]): CompareSum {
  return { actual: sumOf(rows.map((r) => r.actual)), forecast: sumOf(rows.map((r) => r.forecast.value)), lastYear: sumOf(rows.map((r) => r.lastYear)) }
}

export function compareDay(ctx: Ctx, typeOf: (d: string) => TargetDayType, wx: WeatherMap, date: string, dataFrom: string): CompareDay {
  const model = forecastModel(ctx, typeOf, wx, date, dataFrom)
  const ly = lastYear(date)
  const rows = ctx.storeIds.flatMap((store) =>
    ctx.shifts.map((shift) => ({
      store,
      shift,
      actual: ctx.sales.get(slotKey(date, store, shift)) ?? null,
      forecast: forecastSlot(ctx, typeOf, date, store, shift, model.rain, model.factors, model.check.chosen, model.wIn),
      lastYear: ctx.sales.get(slotKey(ly, store, shift)) ?? null,
    })),
  )
  const out: Record<string, CompareSum> & { all: CompareSum } = { all: sums(rows) }
  for (const s of ctx.storeIds) out[s] = sums(rows.filter((r) => r.store === s))
  return { date, lastYearDate: ly, rows, sums: out, model }
}

/** The latest day up to `upTo` with at least one actual figure (null when none in the 60 days before). */
export function latestActual(ctx: Ctx, upTo: string): string | null {
  for (let d = upTo, i = 0; i < 60; d = addDays(d, -1), i++) if (ctx.storeIds.some((s) => ctx.shifts.some((sh) => ctx.sales.has(slotKey(d, s, sh))))) return d
  return null
}
