// 杯数の予測 (owner, 2026-10-15; item 9 of the proposal). Per store × shift:
//   base     = v3 (owner, 2026-10-19): the mean of two estimates, no longer the method that won the last 28 days
//              (that chased last month: C lost September to the Expo rush of 2025, A then lagged October by −12 %):
//              level = ① the same day type (targetDayType) in the 6 weeks before (12 if fewer than 2 days)
//                      × ② the last 14 days' actual ÷ their ① (0.8–1.2) — a change of level shows at once
//              yoy   = ③ the same day type within ±2 weeks of 364 days before × this year's level
//                      (the last 4 weeks ÷ the same days 364 days before, 0.5–1.5)
//              Last year's figures are taken without the effect of 前年の特殊期間 (sales_periods: 万博 2025-04-13〜10-13 …),
//              measured per store × shift as the year-on-year ratio outside ÷ inside the period (periodFit).
//              blend = (level + yoy) ÷ 2; level alone when last year has no figures (2025-05〜07 were never entered).
//              Real data 2026-07〜10-17: day error ±10.7 % / bias −0.1 % (A ±11.6 % / −2.5 %; October ±6 % vs ±12.5 %).
//   × events = the active 目標杯数 events of that day (same % as the targets)
//   × weather = one of two models (owner, 2026-10-16), the one with the smaller backtest error is used:
//              rain     = when ≥ 1 mm falls in the shift's hours, the shift's measured rain factor
//                         (median of actual ÷ base on rainy days, between 0.75 and 1.1; 1 when fewer than 5 rainy days)
//              rainTemp = temperature factor (the shift's temperature vs its average of the 6 weeks before, in
//                         5 bands) × rain factor by amount (1–3 / 3–6 / ≥ 6 mm); each = median of actual ÷ base
//                         of the past slots in that band (temperature on dry slots, rain after the temperature),
//                         between 0.7 and 1.2, 1 when fewer than 15 slots
// Weather = weather_shifts (Open-Meteo, Namba; archive = what happened, forecast ahead). The factors are measured
// before the 28 backtest days, so the backtest is a fair test. The error shown is that backtest.
import { DATA_FROM, slotKey, type Ctx } from './salesAnalysis'
import { pctOf, targetDayType, type TargetDayType } from './targets'
import { addDays } from './time'
import { SHIFTS, type Shift } from './types'

export const RAINY_MM = 1
const LOOKBACK = 42
const LOOKBACK_WIDE = 84
const MIN_RAINY_DAYS = 5

/** blend is used; the others are shown next to it in the 誤差 sheet */
export const FORECAST_METHODS = ['blend', 'level', 'yoy', 'recent'] as const
export type ForecastMethod = (typeof FORECAST_METHODS)[number]

/** Rain (mm) per `${date}|${shift}` from Open-Meteo hourly data (Asia/Tokyo local hours). */
export type RainMap = Map<string, number>

/** The weather of one business date × shift (weather_shifts). */
export interface Wx {
  temp: number | null
  min?: number | null
  max?: number | null
  /** WMO weather code, the most frequent of the shift's hours */
  code?: number | null
  mm: number
  hours: number
  source: 'archive' | 'forecast'
}

export type WxKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'showers' | 'thunder'
export const WX_ICON: Record<WxKind, string> = { clear: '☀️', partly: '🌤️', cloudy: '☁️', fog: '🌫️', drizzle: '🌦️', rain: '🌧️', snow: '❄️', showers: '🌦️', thunder: '⛈️' }

/** WMO code → kind; ≥ 1 mm of rain in the shift always reads as rain. */
export function wxKind(code: number | null | undefined, mm: number): WxKind | null {
  if (mm >= RAINY_MM && (code === null || code === undefined || code < 51)) return 'rain'
  if (code === null || code === undefined) return null
  if (code <= 1) return 'clear'
  if (code === 2) return 'partly'
  if (code === 3) return 'cloudy'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 51 && code <= 57) return 'drizzle'
  if (code >= 61 && code <= 67) return 'rain'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if (code >= 80 && code <= 82) return 'showers'
  if (code >= 95) return 'thunder'
  return 'cloudy'
}
export type WeatherMap = Map<string, Wx>

export const rainOf = (wx: WeatherMap): RainMap => new Map([...wx].map(([k, v]) => [k, v.mm]))

export const WEATHER_MODES = ['rain', 'rainTemp'] as const
export type WeatherMode = (typeof WEATHER_MODES)[number]
/** temperature bands: the shift vs its 6-week average (°C) */
export const TEMP_EDGES = [-4, -2, 2, 4] as const
/** rain bands (mm in the shift): < 1 none, 1–3, 3–6, ≥ 6 */
export const RAIN_EDGES = [1, 3, 6] as const
export const WX_MIN_SLOTS = 15
export const WX_CLAMP = [0.7, 1.2] as const
const band = (v: number, edges: readonly number[]) => edges.filter((e) => v >= e).length

export interface TempAnomaly {
  temp: number
  /** average temperature of this shift over the 6 weeks before */
  mean: number
  days: number
  anomaly: number
  band: number
}

/** How much warmer / colder the shift is than its own average of the 6 weeks before. */
export function tempAnomaly(wx: WeatherMap, date: string, shift: Shift): TempAnomaly | null {
  const t = wx.get(`${date}|${shift}`)?.temp
  if (t === null || t === undefined) return null
  const xs: number[] = []
  for (let d = addDays(date, -LOOKBACK); d < date; d = addDays(d, 1)) {
    const v = wx.get(`${d}|${shift}`)?.temp
    if (v !== null && v !== undefined) xs.push(v)
  }
  if (xs.length < 7) return null
  const mean = xs.reduce((a, x) => a + x, 0) / xs.length
  return { temp: t, mean, days: xs.length, anomaly: t - mean, band: band(t - mean, TEMP_EDGES) }
}

export interface WxBand {
  band: number
  slots: number
  median: number | null
  factor: number
}
export type WeatherFactors = Record<Shift, { temp: WxBand[]; rain: WxBand[] }> & { from: string; to: string }

/** The temperature and rain-amount factors per shift, measured on [from, to] against ① (same day type, 6 weeks) × events. */
export function weatherFactors(ctx: Ctx, typeOf: (d: string) => TargetDayType, wx: WeatherMap, from: string, to: string): WeatherFactors {
  const out = { from, to } as WeatherFactors
  const clamp = (x: number) => Math.min(WX_CLAMP[1], Math.max(WX_CLAMP[0], x))
  for (const shift of SHIFTS) {
    const rows: { ratio: number; tBand: number; rBand: number }[] = []
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const w = wx.get(`${d}|${shift}`)
      const ta = tempAnomaly(wx, d, shift)
      if (!w || !ta) continue
      for (const store of ctx.storeIds) {
        const actual = ctx.sales.get(slotKey(d, store, shift))
        if (actual === undefined) continue
        const base = baseline(ctx, typeOf, d, store, shift).value
        if (!base) continue
        rows.push({ ratio: actual / (base * eventFactor(ctx, d, store, shift).factor), tBand: ta.band, rBand: band(w.mm, RAIN_EDGES) })
      }
    }
    const temp = Array.from({ length: TEMP_EDGES.length + 1 }, (_, b) => {
      const xs = rows.filter((r) => r.rBand === 0 && r.tBand === b).map((r) => r.ratio)
      const m = xs.length ? median(xs) : null
      return { band: b, slots: xs.length, median: m, factor: xs.length >= WX_MIN_SLOTS && m !== null ? clamp(m) : 1 }
    })
    const rain = Array.from({ length: RAIN_EDGES.length }, (_, i) => {
      const b = i + 1
      const xs = rows.filter((r) => r.rBand === b).map((r) => r.ratio / temp[r.tBand]!.factor)
      const m = xs.length ? median(xs) : null
      return { band: b, slots: xs.length, median: m, factor: xs.length >= WX_MIN_SLOTS && m !== null ? clamp(m) : 1 }
    })
    out[shift] = { temp, rain }
  }
  return out
}

export interface WeatherPart {
  mode: WeatherMode
  factor: number
  /** rainTemp: the two parts */
  temp: TempAnomaly | null
  tempFactor: number
  rainBand: number
  rainFactor: number
  mm: number | null
  hours: number | null
}

/** The weather factor of one slot by a model. */
export function weatherPart(wx: WeatherMap, date: string, shift: Shift, mode: WeatherMode, rainF: RainFactors, wf: WeatherFactors | null): WeatherPart {
  const w = wx.get(`${date}|${shift}`)
  const mm = w?.mm ?? 0
  if (mode === 'rain' || !wf) {
    const f = w && mm >= RAINY_MM ? rainF[shift].factor : 1
    return { mode: 'rain', factor: f, temp: null, tempFactor: 1, rainBand: band(mm, RAIN_EDGES), rainFactor: f, mm: w?.mm ?? null, hours: w?.hours ?? null }
  }
  const ta = tempAnomaly(wx, date, shift)
  const tf = ta ? wf[shift].temp[ta.band]!.factor : 1
  const rb = band(mm, RAIN_EDGES)
  const rf = rb ? wf[shift].rain[rb - 1]!.factor : 1
  return { mode, factor: tf * rf, temp: ta, tempFactor: tf, rainBand: rb, rainFactor: rf, mm: w?.mm ?? null, hours: w?.hours ?? null }
}

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

/** 前年の特殊期間 (sales_periods): days whose figures were unusual (大阪・関西万博 2025…). */
export interface SalesPeriod {
  id: string
  name: string
  date_from: string
  date_to: string
  /** null = both stores */
  store_id: string | null
  active: boolean
  note: string | null
}

export interface PeriodUplift {
  period: SalesPeriod
  store: string
  shift: Shift
  /** this year ÷ 364 days before, when the day before was in the period / in no period */
  inside: { pairs: number; sum: number; sumLy: number }
  outside: { pairs: number; sum: number; sumLy: number }
  /** how much the period raised the figures (outside ratio ÷ inside ratio); null = too few pairs → its days are left out */
  uplift: number | null
}

/** The periods with their measured effect, as of a day (only pairs before it). */
export interface LastYearAdjust {
  periods: SalesPeriod[]
  uplift: Map<string, PeriodUplift>
}

export const NO_ADJUST: LastYearAdjust = { periods: [], uplift: new Map() }

/** events × weather of a past slot: what ② 最近のズレ takes out, so the weather is not counted twice */
export type Known = (date: string, store: string, shift: Shift) => number

/** What the base needs besides the figures. */
export interface BaseOpts {
  adj: LastYearAdjust
  /** default: the events only */
  known?: Known
}
export const NO_OPTS: BaseOpts = { adj: NO_ADJUST }
export const PERIOD_MIN_PAIRS = 20
export const PERIOD_CLAMP = [0.67, 1.5] as const

const periodOf = (periods: SalesPeriod[], date: string, store: string) =>
  periods.find((p) => p.active && date >= p.date_from && date <= p.date_to && (!p.store_id || p.store_id === store))

/** Measures each period per store × shift: the year-on-year ratio of days in it vs days in no period (before `asOf`). */
export function periodFit(ctx: Ctx, periods: SalesPeriod[], asOf: string): LastYearAdjust {
  const active = periods.filter((p) => p.active)
  const uplift = new Map<string, PeriodUplift>()
  for (const store of ctx.storeIds)
    for (const shift of SHIFTS) {
      const outside = { pairs: 0, sum: 0, sumLy: 0 }
      const inside = new Map(active.map((p) => [p.id, { pairs: 0, sum: 0, sumLy: 0 }]))
      for (let d = addDays(DATA_FROM, 364); d < asOf; d = addDays(d, 1)) {
        if (periodOf(active, d, store)) continue
        const a = ctx.sales.get(slotKey(d, store, shift))
        const ly = addDays(d, -364)
        const b = ctx.sales.get(slotKey(ly, store, shift))
        if (a === undefined || !b) continue
        const p = periodOf(active, ly, store)
        const acc = p ? inside.get(p.id)! : outside
        acc.pairs++
        acc.sum += a
        acc.sumLy += b
      }
      for (const p of active) {
        if (p.store_id && p.store_id !== store) continue
        const i = inside.get(p.id)!
        const ok = i.pairs >= PERIOD_MIN_PAIRS && outside.pairs >= PERIOD_MIN_PAIRS && i.sum > 0 && outside.sumLy > 0
        const raw = ok ? outside.sum / outside.sumLy / (i.sum / i.sumLy) : null
        uplift.set(`${p.id}|${store}|${shift}`, {
          period: p,
          store,
          shift,
          inside: i,
          outside,
          uplift: raw === null ? null : Math.min(PERIOD_CLAMP[1], Math.max(PERIOD_CLAMP[0], raw)),
        })
      }
    }
  return { periods: active, uplift }
}

export interface LyValue {
  /** the figure as it was */
  raw: number
  /** the figure without the period's effect; null = in a period that could not be measured (left out) */
  value: number | null
  period: string | null
  uplift: number | null
}

/** A past figure without its period's effect (undefined = no figure). */
export function lyValue(ctx: Ctx, adj: LastYearAdjust, date: string, store: string, shift: Shift): LyValue | undefined {
  const raw = ctx.sales.get(slotKey(date, store, shift))
  if (raw === undefined) return undefined
  const p = periodOf(adj.periods, date, store)
  if (!p) return { raw, value: raw, period: null, uplift: null }
  const u = adj.uplift.get(`${p.id}|${store}|${shift}`)?.uplift ?? null
  return { raw, value: u === null ? null : raw / u, period: p.name, uplift: u }
}

export const LEVEL_DAYS = 14
export const LEVEL_MIN_DAYS = 7
export const LEVEL_CLAMP = [0.8, 1.2] as const

export interface LevelFactor {
  /** clamped, 1 when too few days */
  value: number
  raw: number | null
  /** expected = ① avg × events × weather of that day */
  rows: { date: string; actual: number; avg: number; known: number; expected: number }[]
  from: string
}

/**
 * ② 最近のズレ: the last 14 days' actual ÷ what was expected from ① × events × weather (all day types),
 * so a change of level shows at once without counting the weather twice.
 */
export function levelFactor(ctx: Ctx, typeOf: (d: string) => TargetDayType, date: string, store: string, shift: Shift, known?: Known): LevelFactor {
  const from = addDays(date, -LEVEL_DAYS)
  const rows: LevelFactor['rows'] = []
  for (let d = from; d < date; d = addDays(d, 1)) {
    const a = ctx.sales.get(slotKey(d, store, shift))
    if (a === undefined) continue
    const avg = baseline(ctx, typeOf, d, store, shift).value
    if (!avg) continue
    const k = known ? known(d, store, shift) : eventFactor(ctx, d, store, shift).factor
    rows.push({ date: d, actual: a, avg, known: k, expected: avg * k })
  }
  const sa = rows.reduce((x, r) => x + r.actual, 0)
  const sb = rows.reduce((x, r) => x + r.expected, 0)
  const raw = rows.length >= LEVEL_MIN_DAYS && sb ? sa / sb : null
  return { value: raw === null ? 1 : Math.min(LEVEL_CLAMP[1], Math.max(LEVEL_CLAMP[0], raw)), raw, rows, from }
}

export const NEAR_DAYS = 14
export const NEAR_MIN_DAYS = 2

export interface LastYearNear {
  value: number | null
  /** 364 days before (same weekday) */
  center: string
  samples: { date: string; bowls: number; value: number; period: string | null; uplift: number | null }[]
  /** left out: yearly event days (②'s events cover them) and period days that could not be measured */
  skipped: { date: string; why: string }[]
}

/** Yearly events (ハロウィン 10/31, クリスマス…): their month-day, to keep them out of last year's average. */
function yearlyEventDays(ctx: Ctx): Map<string, string> {
  const m = new Map<string, string>()
  for (const e of ctx.events) if (e.active) m.set(e.event_date.slice(5), e.name)
  return m
}

/** ③ 前年: the same day type within ±2 weeks of 364 days before, without the periods' effect. */
export function lastYearNear(ctx: Ctx, typeOf: (d: string) => TargetDayType, adj: LastYearAdjust, date: string, store: string, shift: Shift): LastYearNear {
  const type = typeOf(date)
  const center = addDays(date, -364)
  const skip = yearlyEventDays(ctx)
  const samples: LastYearNear['samples'] = []
  const skipped: LastYearNear['skipped'] = []
  for (let d = addDays(center, -NEAR_DAYS); d <= addDays(center, NEAR_DAYS); d = addDays(d, 1)) {
    if (typeOf(d) !== type) continue
    const v = lyValue(ctx, adj, d, store, shift)
    if (!v) continue
    const ev = skip.get(d.slice(5))
    if (ev) skipped.push({ date: d, why: ev })
    else if (v.value === null) skipped.push({ date: d, why: v.period! })
    else samples.push({ date: d, bowls: v.raw, value: v.value, period: v.period, uplift: v.uplift })
  }
  return {
    value: samples.length >= NEAR_MIN_DAYS ? samples.reduce((a, x) => a + x.value, 0) / samples.length : null,
    center,
    samples,
    skipped,
  }
}

export const YOY_DAYS = 28
export const YOY_MIN_PAIRS = 7
export const YOY_CLAMP = [0.5, 1.5] as const

export interface YoyRatio {
  /** clamped ratio, null when too few pairs */
  value: number | null
  raw: number | null
  pairs: { date: string; actual: number; lastYear: number; lastYearRaw: number; period: string | null; uplift: number | null }[]
  from: string
}

/** ③ 今年の水準: the last 4 weeks ÷ the same days 364 days before (same weekday), without the periods' effect. */
export function yoyRatio(ctx: Ctx, adj: LastYearAdjust, date: string, store: string, shift: Shift): YoyRatio {
  const from = addDays(date, -YOY_DAYS)
  const pairs: YoyRatio['pairs'] = []
  for (let d = from; d < date; d = addDays(d, 1)) {
    const a = ctx.sales.get(slotKey(d, store, shift))
    const b = lyValue(ctx, adj, addDays(d, -364), store, shift)
    if (a !== undefined && b && b.value) pairs.push({ date: d, actual: a, lastYear: b.value, lastYearRaw: b.raw, period: b.period, uplift: b.uplift })
  }
  const sumB = pairs.reduce((a, x) => a + x.lastYear, 0)
  const raw = pairs.length >= YOY_MIN_PAIRS && sumB ? pairs.reduce((a, x) => a + x.actual, 0) / sumB : null
  return { value: raw === null ? null : Math.min(YOY_CLAMP[1], Math.max(YOY_CLAMP[0], raw)), raw, pairs, from }
}

export interface BaseParts {
  method: ForecastMethod
  /** the method could not be used (missing data) and another was used instead */
  fallback: boolean
  /** what was used */
  used: ForecastMethod
  value: number | null
  recent: Baseline
  level: LevelFactor
  near: LastYearNear
  yoy: YoyRatio
  by: Record<ForecastMethod, number | null>
}

/**
 * The base of one slot by every method; `value` = the chosen one.
 *   recent = ① 直近6週の平均
 *   level  = ① × ② 最近のズレ (14 days)
 *   yoy    = ③ 前年の同じ時期 × 今年の水準 (periods taken out)
 *   blend  = (level + yoy) ÷ 2 — level alone when last year has no figures (e.g. 2025-05〜07, not entered)
 */
export function baseParts(ctx: Ctx, typeOf: (d: string) => TargetDayType, date: string, store: string, shift: Shift, method: ForecastMethod, opts: BaseOpts = NO_OPTS): BaseParts {
  const adj = opts.adj
  const recent = baseline(ctx, typeOf, date, store, shift)
  const level = levelFactor(ctx, typeOf, date, store, shift, opts.known)
  const near = lastYearNear(ctx, typeOf, adj, date, store, shift)
  const yoy = yoyRatio(ctx, adj, date, store, shift)
  const lv = recent.value === null ? null : recent.value * level.value
  const yy = near.value !== null && yoy.value !== null ? near.value * yoy.value : null
  const by: Record<ForecastMethod, number | null> = { blend: lv !== null && yy !== null ? (lv + yy) / 2 : null, level: lv, yoy: yy, recent: recent.value }
  const used: ForecastMethod = by[method] !== null ? method : method === 'recent' ? 'recent' : lv !== null ? 'level' : yy !== null ? 'yoy' : 'recent'
  return { method, fallback: used !== method, used, value: by[used], recent, level, near, yoy, by }
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

function median(xs: number[]) {
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
  detail: { baseline: Baseline; parts: BaseParts; eventFactor: number; weather: WeatherPart }
}

/** What the forecast needs about the weather: the map, the two models' factors and the model in use. */
export interface WeatherInput {
  wx: WeatherMap
  rain: RainFactors
  factors: WeatherFactors | null
  mode: WeatherMode
}

export function forecastSlot(
  ctx: Ctx,
  typeOf: (d: string) => TargetDayType,
  date: string,
  store: string,
  shift: Shift,
  rain: RainMap,
  factors: RainFactors,
  method: ForecastMethod = 'blend',
  weather?: WeatherInput,
  opts: BaseOpts = NO_OPTS,
): SlotForecast {
  const parts = baseParts(ctx, typeOf, date, store, shift, method, opts)
  const b = { ...parts.recent, value: parts.value }
  const ev = eventFactor(ctx, date, store, shift)
  const mm = rain.has(`${date}|${shift}`) ? rain.get(`${date}|${shift}`)! : null
  const wp = weather
    ? weatherPart(weather.wx, date, shift, weather.mode, weather.rain, weather.factors)
    : { mode: 'rain' as const, factor: mm !== null && mm >= RAINY_MM ? factors[shift].factor : 1, temp: null, tempFactor: 1, rainBand: 0, rainFactor: 1, mm, hours: null }
  const rf = wp.factor
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
    detail: { baseline: parts.recent, parts, eventFactor: ev.factor, weather: wp },
  }
}

export interface BacktestRow {
  date: string
  store: string
  shift: Shift
  /** blend × events × the chosen weather model */
  forecast: number
  actual: number
  /** |forecast − actual| ÷ actual, in % */
  errorPct: number
  /** every method's forecast with the same events and weather (null = no data for it) */
  by: Record<ForecastMethod, number | null>
}

export interface MethodScore {
  /** mean of |forecast − actual| ÷ actual, in % */
  error: number | null
  /** Σ forecast ÷ Σ actual − 1, in % (− = the forecast was too low) */
  bias: number | null
  slots: number
}

export interface Backtest {
  /** error of what is shown (blend × events × chosen weather) */
  error: number | null
  bias: number | null
  slots: number
  rows: BacktestRow[]
  from: string
  /** every method on the slots all of them could forecast */
  methods: Record<ForecastMethod, MethodScore>
  chosen: ForecastMethod
  /** blend with each weather model, on the same slots */
  weather: Record<WeatherMode, { error: number | null; slots: number }>
  weatherChosen: WeatherMode
}

const score = (xs: { f: number; a: number }[]): MethodScore => {
  if (!xs.length) return { error: null, bias: null, slots: 0 }
  const sa = xs.reduce((s, x) => s + x.a, 0)
  return {
    error: Math.round((xs.reduce((s, x) => s + Math.abs(x.f - x.a) / x.a, 0) / xs.length) * 1000) / 10,
    bias: Math.round((xs.reduce((s, x) => s + x.f, 0) / sa - 1) * 1000) / 10,
    slots: xs.length,
  }
}

/**
 * Every method on the 28 days before `today` that have figures, each day using only figures before it.
 * blend is what the forecast uses (fixed since v3); the others are shown for comparison. The weather model with the
 * smaller error on blend is used.
 */
export function backtest(
  ctx: Ctx,
  typeOf: (d: string) => TargetDayType,
  rain: RainMap,
  factors: RainFactors,
  today: string,
  days = 28,
  weather?: { wx: WeatherMap; factors: WeatherFactors },
  opts: BaseOpts = NO_OPTS,
): Backtest {
  const chosen: ForecastMethod = 'blend'
  const raw: { date: string; store: string; shift: Shift; actual: number; base: number | null; own: Record<ForecastMethod, number | null>; ev: number; wf: Record<WeatherMode, number> }[] = []
  for (let d = addDays(today, -days); d < today; d = addDays(d, 1))
    for (const store of ctx.storeIds)
      for (const shift of ctx.shifts) {
        const actual = ctx.sales.get(slotKey(d, store, shift))
        if (!actual) continue
        const parts = baseParts(ctx, typeOf, d, store, shift, chosen, opts)
        const ev = eventFactor(ctx, d, store, shift).factor
        const mm = rain.get(`${d}|${shift}`) ?? 0
        const rf = mm >= RAINY_MM ? factors[shift].factor : 1
        const wf = { rain: rf, rainTemp: weather ? weatherPart(weather.wx, d, shift, 'rainTemp', factors, weather.factors).factor : rf }
        raw.push({ date: d, store, shift, actual, base: parts.value, own: parts.by, ev, wf })
      }
  const fc = (b: number | null, r: (typeof raw)[number], mode: WeatherMode) => (b === null ? null : Math.round(b * r.ev * r.wf[mode]))
  const wErr = (mode: WeatherMode) => {
    const s = score(raw.flatMap((r) => (r.base === null ? [] : [{ f: fc(r.base, r, mode)!, a: r.actual }])))
    return { error: s.error, slots: s.slots }
  }
  const weatherErr = { rain: wErr('rain'), rainTemp: weather ? wErr('rainTemp') : { error: null, slots: 0 } }
  const weatherChosen: WeatherMode =
    weatherErr.rainTemp.error !== null && weatherErr.rain.error !== null && weatherErr.rainTemp.error < weatherErr.rain.error ? 'rainTemp' : 'rain'
  const rows: BacktestRow[] = raw.flatMap((r) => {
    const f = fc(r.base, r, weatherChosen)
    if (f === null) return []
    const by = Object.fromEntries(FORECAST_METHODS.map((m) => [m, fc(r.own[m], r, weatherChosen)])) as Record<ForecastMethod, number | null>
    return [{ date: r.date, store: r.store, shift: r.shift, actual: r.actual, forecast: f, errorPct: Math.round((Math.abs(f - r.actual) / r.actual) * 1000) / 10, by }]
  })
  const comparable = rows.filter((r) => FORECAST_METHODS.every((m) => r.by[m] !== null))
  const methods = Object.fromEntries(FORECAST_METHODS.map((m) => [m, score(comparable.map((r) => ({ f: r.by[m]!, a: r.actual })))])) as Backtest['methods']
  const all = score(rows.map((r) => ({ f: r.forecast, a: r.actual })))
  const error = rows.length ? Math.round((rows.reduce((a, r) => a + r.errorPct, 0) / rows.length) * 10) / 10 : null
  return { error, bias: all.bias, slots: rows.length, rows, from: addDays(today, -days), methods, chosen, weather: weatherErr, weatherChosen }
}

/** Everything a forecast made on `asOf` uses: rain / weather factors measured before its 28 backtest days, the periods' effect, the backtest. */
export interface ForecastModel {
  rain: RainMap
  factors: RainFactors
  wf: WeatherFactors
  opts: BaseOpts
  check: Backtest
  wIn: WeatherInput
}

/** The forecast as it is made on `asOf`: only figures before that day are used (the forecast card uses today). */
export function forecastModel(ctx: Ctx, typeOf: (d: string) => TargetDayType, wx: WeatherMap, asOf: string, dataFrom: string, periods: SalesPeriod[] = []): ForecastModel {
  const rain = rainOf(wx)
  // the factors are measured before the 28 backtest days, so the backtest is a fair test of them
  const fitTo = addDays(asOf, -29)
  const factors = rainFactors(ctx, typeOf, rain, dataFrom, fitTo)
  const wf = weatherFactors(ctx, typeOf, wx, dataFrom, fitTo)
  // ② takes out events × weather (rain × temperature model) of the past days
  const known: Known = (d, store, shift) => eventFactor(ctx, d, store, shift).factor * weatherPart(wx, d, shift, 'rainTemp', factors, wf).factor
  const opts: BaseOpts = { adj: periodFit(ctx, periods, asOf), known }
  const check = backtest(ctx, typeOf, rain, factors, asOf, 28, { wx, factors: wf }, opts)
  return { rain, factors, wf, opts, check, wIn: { wx, rain: factors, factors: wf, mode: check.weatherChosen } }
}

/** One slot as forecast by a model. */
export const modelSlot = (ctx: Ctx, typeOf: (d: string) => TargetDayType, m: ForecastModel, date: string, store: string, shift: Shift) =>
  forecastSlot(ctx, typeOf, date, store, shift, m.rain, m.factors, m.check.chosen, m.wIn, m.opts)
