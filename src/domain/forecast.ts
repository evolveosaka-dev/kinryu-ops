// 杯数の予測 (owner, 2026-10-15; item 9 of the proposal). Per store × shift:
//   base     = average bowls of the same day type (targetDayType) in the 6 weeks before (12 weeks if fewer than 2 days)
//   × events = the active 目標杯数 events of that day (same % as the targets)
//   × rain   = when ≥ 1 mm of rain is forecast in the shift's hours, the shift's measured rain factor
//              (median of actual ÷ base on rainy days since 2025, between 0.75 and 1.1; 1 when fewer than 5 rainy days)
// The error shown to managers is a backtest: the same method on the last 28 days with the rain that fell.
import { slotKey, type Ctx } from './salesAnalysis'
import { pctOf, targetDayType, type TargetDayType } from './targets'
import { addDays } from './time'
import { SHIFTS, type Shift } from './types'

export const RAINY_MM = 1
const LOOKBACK = 42
const LOOKBACK_WIDE = 84
const MIN_RAINY_DAYS = 5

/** Rain (mm) per `${date}|${shift}` from Open-Meteo hourly data (Asia/Tokyo local hours). */
export type RainMap = Map<string, number>

export function shiftRain(hourly: { time: string[]; precipitation: (number | null)[] }): RainMap {
  const out: RainMap = new Map()
  hourly.time.forEach((t, i) => {
    const mm = hourly.precipitation[i] ?? 0
    const date = t.slice(0, 10)
    const h = Number(t.slice(11, 13))
    const [d, shift]: [string, Shift] = h >= 7 && h < 17 ? [date, 'early'] : h >= 17 && h < 23 ? [date, 'middle'] : h >= 23 ? [date, 'late'] : [addDays(date, -1), 'late']
    const k = `${d}|${shift}`
    out.set(k, (out.get(k) ?? 0) + mm)
  })
  return out
}

/** targetDayType, remembered (the backtest asks for the same days many times). */
export function dayTypeCache(holidays: ReadonlySet<string>) {
  const m = new Map<string, TargetDayType>()
  return (date: string) => {
    let v = m.get(date)
    if (!v) m.set(date, (v = targetDayType(date, holidays)))
    return v
  }
}

export interface Baseline {
  value: number | null
  days: number
  /** the days averaged (date, bowls), oldest first */
  samples: { date: string; bowls: number }[]
  /** first day looked at: 6 weeks back, or 12 when the 6 weeks had fewer than 2 days */
  from: string
  weeks: 6 | 12
}

export function baseline(ctx: Ctx, typeOf: (d: string) => TargetDayType, date: string, store: string, shift: Shift): Baseline {
  const type = typeOf(date)
  for (const back of [LOOKBACK, LOOKBACK_WIDE]) {
    const samples: { date: string; bowls: number }[] = []
    for (let d = addDays(date, -back); d < date; d = addDays(d, 1)) {
      if (typeOf(d) !== type) continue
      const v = ctx.sales.get(slotKey(d, store, shift))
      if (v !== undefined) samples.push({ date: d, bowls: v })
    }
    if (samples.length >= 2 || (back === LOOKBACK_WIDE && samples.length))
      return {
        value: samples.reduce((a, s) => a + s.bowls, 0) / samples.length,
        days: samples.length,
        samples,
        from: addDays(date, -back),
        weeks: back === LOOKBACK ? 6 : 12,
      }
  }
  return { value: null, days: 0, samples: [], from: addDays(date, -LOOKBACK_WIDE), weeks: 12 }
}

export function eventFactor(ctx: Ctx, date: string, store: string, shift: Shift): { factor: number; names: string[] } {
  let factor = 1
  const names: string[] = []
  for (const e of ctx.events) {
    if (!e.active || e.event_date !== date || (e.store_id && e.store_id !== store)) continue
    const pct = pctOf(e, shift)
    if (!pct) continue
    factor *= 1 + pct / 100
    names.push(`${e.name} ${pct > 0 ? '+' : ''}${pct}%`)
  }
  return { factor, names }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

export interface RainSample {
  date: string
  store: string
  mm: number
  actual: number
  /** baseline × events */
  expected: number
  ratio: number
}

export type RainFactors = Record<Shift, { factor: number; days: number; median: number | null; samples: RainSample[] }>

export const RAIN_MIN_DAYS = MIN_RAINY_DAYS
export const RAIN_CLAMP = [0.75, 1.1] as const

/** How much rain changes each shift, measured on the rainy days of [from, to]. */
export function rainFactors(ctx: Ctx, typeOf: (d: string) => TargetDayType, rain: RainMap, from: string, to: string): RainFactors {
  const out = {} as RainFactors
  for (const shift of SHIFTS) {
    const samples: RainSample[] = []
    const days = new Set<string>()
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const mm = rain.get(`${d}|${shift}`) ?? 0
      if (mm < RAINY_MM) continue
      for (const store of ctx.storeIds) {
        const actual = ctx.sales.get(slotKey(d, store, shift))
        if (actual === undefined) continue
        const base = baseline(ctx, typeOf, d, store, shift).value
        if (!base) continue
        const expected = base * eventFactor(ctx, d, store, shift).factor
        samples.push({ date: d, store, mm: Math.round(mm * 10) / 10, actual, expected, ratio: actual / expected })
        days.add(d)
      }
    }
    const m = samples.length ? median(samples.map((s) => s.ratio)) : null
    out[shift] = {
      factor: days.size >= MIN_RAINY_DAYS && m !== null ? Math.min(RAIN_CLAMP[1], Math.max(RAIN_CLAMP[0], m)) : 1,
      days: days.size,
      median: m,
      samples,
    }
  }
  return out
}

export interface SlotForecast {
  date: string
  store: string
  shift: Shift
  value: number | null
  base: number | null
  baseDays: number
  events: string[]
  rainMm: number | null
  rainFactor: number
  /** the parts, unrounded, for the explanation */
  detail: { baseline: Baseline; eventFactor: number }
}

export function forecastSlot(ctx: Ctx, typeOf: (d: string) => TargetDayType, date: string, store: string, shift: Shift, rain: RainMap, factors: RainFactors): SlotForecast {
  const b = baseline(ctx, typeOf, date, store, shift)
  const ev = eventFactor(ctx, date, store, shift)
  const mm = rain.has(`${date}|${shift}`) ? rain.get(`${date}|${shift}`)! : null
  const rf = mm !== null && mm >= RAINY_MM ? factors[shift].factor : 1
  return {
    date,
    store,
    shift,
    value: b.value === null ? null : Math.round(b.value * ev.factor * rf),
    base: b.value === null ? null : Math.round(b.value),
    baseDays: b.days,
    events: ev.names,
    rainMm: mm === null ? null : Math.round(mm * 10) / 10,
    rainFactor: rf,
    detail: { baseline: b, eventFactor: ev.factor },
  }
}

export interface BacktestRow {
  date: string
  store: string
  shift: Shift
  forecast: number
  actual: number
  /** |forecast − actual| ÷ actual, in % */
  errorPct: number
}

/** Mean absolute error in % of the method on the days before `today` that have figures. */
export function backtest(
  ctx: Ctx,
  typeOf: (d: string) => TargetDayType,
  rain: RainMap,
  factors: RainFactors,
  today: string,
  days = 28,
): { error: number | null; slots: number; rows: BacktestRow[]; from: string } {
  let sum = 0
  let n = 0
  const rows: BacktestRow[] = []
  for (let d = addDays(today, -days); d < today; d = addDays(d, 1))
    for (const store of ctx.storeIds)
      for (const shift of ctx.shifts) {
        const actual = ctx.sales.get(slotKey(d, store, shift))
        if (!actual) continue
        const f = forecastSlot(ctx, typeOf, d, store, shift, rain, factors).value
        if (f === null) continue
        sum += Math.abs(f - actual) / actual
        n++
        rows.push({ date: d, store, shift, forecast: f, actual, errorPct: Math.round((Math.abs(f - actual) / actual) * 1000) / 10 })
      }
  return { error: n ? Math.round((sum / n) * 1000) / 10 : null, slots: n, rows, from: addDays(today, -days) }
}
