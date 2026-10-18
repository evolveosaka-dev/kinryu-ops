// 杯数の予測 (owner, 2026-10-15; item 9 of the proposal). Per store × shift:
//   base     = one of three methods (owner, 2026-10-16), the one with the smallest backtest error is used:
//              ① recent   = average of the same day type (targetDayType) in the 6 weeks before (12 if fewer than 2 days)
//              ② lastYear = average of the same day type in the same month a year before (season only)
//              ③ seasonal = ② × (the last 6 weeks ÷ the same weeks a year before, same day type, 364 days back)
//                           = last year's season at this year's level
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
import { slotKey, type Ctx } from './salesAnalysis'
import { pctOf, targetDayType, type TargetDayType } from './targets'
import { addDays } from './time'
import { SHIFTS, type Shift } from './types'

export const RAINY_MM = 1
const LOOKBACK = 42
const LOOKBACK_WIDE = 84
const MIN_RAINY_DAYS = 5
/** ② needs this many days of the type in last year's month */
export const LAST_YEAR_MIN_DAYS = 3
/** ③ needs this many day pairs (this year / 364 days before) of the type; fewer → every day type of the 6 weeks */
export const YOY_MIN_PAIRS = 3
export const YOY_CLAMP = [0.5, 1.5] as const

export const FORECAST_METHODS = ['recent', 'lastYear', 'seasonal'] as const
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

export interface LastYearBase {
  value: number | null
  /** YYYY-MM of last year's month */
  month: string
  samples: { date: string; bowls: number }[]
  /** days of the type left out because a yearly event (same month-day) falls on them */
  skipped: { date: string; event: string }[]
}

/** Yearly events (ハロウィン 10/31, クリスマス…): their month-day, to keep them out of last year's average. */
function yearlyEventDays(ctx: Ctx): Map<string, string> {
  const m = new Map<string, string>()
  for (const e of ctx.events) if (e.active) m.set(e.event_date.slice(5), e.name)
  return m
}

/** ② the same day type in the same month a year before. */
export function lastYearBase(ctx: Ctx, typeOf: (d: string) => TargetDayType, date: string, store: string, shift: Shift): LastYearBase {
  const type = typeOf(date)
  const month = `${Number(date.slice(0, 4)) - 1}${date.slice(4, 7)}`
  const skip = yearlyEventDays(ctx)
  const samples: { date: string; bowls: number }[] = []
  const skipped: { date: string; event: string }[] = []
  for (let d = `${month}-01`; d.startsWith(month); d = addDays(d, 1)) {
    if (typeOf(d) !== type) continue
    const v = ctx.sales.get(slotKey(d, store, shift))
    if (v === undefined) continue
    const ev = skip.get(d.slice(5))
    if (ev) {
      skipped.push({ date: d, event: ev })
      continue
    }
    samples.push({ date: d, bowls: v })
  }
  return {
    value: samples.length >= LAST_YEAR_MIN_DAYS ? samples.reduce((a, x) => a + x.bowls, 0) / samples.length : null,
    month,
    samples,
    skipped,
  }
}

export interface YoyRatio {
  /** clamped ratio, null when no pair */
  value: number | null
  raw: number | null
  pairs: { date: string; actual: number; lastYear: number }[]
  /** too few pairs of the day type: every day type of the 6 weeks was used */
  allTypes: boolean
  from: string
}

/** ③ this year's level: the last 6 weeks ÷ the same weeks a year before (364 days = same weekday). */
export function yoyRatio(ctx: Ctx, typeOf: (d: string) => TargetDayType, date: string, store: string, shift: Shift): YoyRatio {
  const type = typeOf(date)
  const from = addDays(date, -LOOKBACK)
  const collect = (sameType: boolean) => {
    const pairs: { date: string; actual: number; lastYear: number }[] = []
    for (let d = from; d < date; d = addDays(d, 1)) {
      if (sameType && typeOf(d) !== type) continue
      const a = ctx.sales.get(slotKey(d, store, shift))
      const b = ctx.sales.get(slotKey(addDays(d, -364), store, shift))
      if (a !== undefined && b) pairs.push({ date: d, actual: a, lastYear: b })
    }
    return pairs
  }
  let pairs = collect(true)
  const allTypes = pairs.length < YOY_MIN_PAIRS
  if (allTypes) pairs = collect(false)
  const sumB = pairs.reduce((a, x) => a + x.lastYear, 0)
  const raw = pairs.length && sumB ? pairs.reduce((a, x) => a + x.actual, 0) / sumB : null
  return { value: raw === null ? null : Math.min(YOY_CLAMP[1], Math.max(YOY_CLAMP[0], raw)), raw, pairs, allTypes, from }
}

export interface BaseParts {
  method: ForecastMethod
  /** the method could not be used (missing data) and ① was used instead */
  fallback: boolean
  value: number | null
  recent: Baseline
  lastYear: LastYearBase
  yoy: YoyRatio
}

/** The base of one slot by every method; `value` = the chosen method (① when it has no data). */
export function baseParts(ctx: Ctx, typeOf: (d: string) => TargetDayType, date: string, store: string, shift: Shift, method: ForecastMethod): BaseParts {
  const recent = baseline(ctx, typeOf, date, store, shift)
  const lastYear = lastYearBase(ctx, typeOf, date, store, shift)
  const yoy = yoyRatio(ctx, typeOf, date, store, shift)
  const by: Record<ForecastMethod, number | null> = {
    recent: recent.value,
    lastYear: lastYear.value,
    seasonal: lastYear.value !== null && yoy.value !== null ? lastYear.value * yoy.value : null,
  }
  const own = by[method]
  return { method, fallback: own === null && method !== 'recent', value: own ?? recent.value, recent, lastYear, yoy }
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
  method: ForecastMethod = 'seasonal',
  weather?: WeatherInput,
): SlotForecast {
  const parts = baseParts(ctx, typeOf, date, store, shift, method)
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
  /** the chosen method's forecast */
  forecast: number
  actual: number
  /** |forecast − actual| ÷ actual, in % */
  errorPct: number
  /** every method's forecast (null = no data for it) */
  by: Record<ForecastMethod, number | null>
}

export interface Backtest {
  /** error of the chosen method */
  error: number | null
  slots: number
  rows: BacktestRow[]
  from: string
  /** mean absolute error in % per method, on the slots every method could forecast */
  methods: Record<ForecastMethod, { error: number | null; slots: number }>
  chosen: ForecastMethod
  /** the chosen base with each weather model, on the same slots */
  weather: Record<WeatherMode, { error: number | null; slots: number }>
  weatherChosen: WeatherMode
}

/**
 * Every method on the days before `today` that have figures. The method with the smallest error on the slots
 * all three could forecast is the one used (③ when tied or nothing to compare).
 */
export function backtest(
  ctx: Ctx,
  typeOf: (d: string) => TargetDayType,
  rain: RainMap,
  factors: RainFactors,
  today: string,
  days = 28,
  weather?: { wx: WeatherMap; factors: WeatherFactors },
): Backtest {
  const raw: (Omit<BacktestRow, 'forecast' | 'errorPct'> & { base: Record<ForecastMethod, number | null>; ev: number; wf: Record<WeatherMode, number> })[] = []
  for (let d = addDays(today, -days); d < today; d = addDays(d, 1))
    for (const store of ctx.storeIds)
      for (const shift of ctx.shifts) {
        const actual = ctx.sales.get(slotKey(d, store, shift))
        if (!actual) continue
        const parts = baseParts(ctx, typeOf, d, store, shift, 'recent')
        const ev = eventFactor(ctx, d, store, shift).factor
        const mm = rain.get(`${d}|${shift}`) ?? 0
        const rf = mm >= RAINY_MM ? factors[shift].factor : 1
        const ly = parts.lastYear.value
        const own: Record<ForecastMethod, number | null> = {
          recent: parts.recent.value,
          lastYear: ly,
          seasonal: ly !== null && parts.yoy.value !== null ? ly * parts.yoy.value : null,
        }
        const by = Object.fromEntries(FORECAST_METHODS.map((m) => [m, own[m] === null ? null : Math.round(own[m]! * ev * rf)])) as Record<ForecastMethod, number | null>
        const wf = { rain: rf, rainTemp: weather ? weatherPart(weather.wx, d, shift, 'rainTemp', factors, weather.factors).factor : rf }
        raw.push({ date: d, store, shift, actual, by, base: own, ev, wf })
      }
  const comparable = raw.filter((r) => FORECAST_METHODS.every((m) => r.by[m] !== null))
  const errOf = (m: ForecastMethod, rows: typeof raw) => {
    const xs = rows.filter((r) => r.by[m] !== null)
    return { error: xs.length ? Math.round((xs.reduce((a, r) => a + Math.abs(r.by[m]! - r.actual) / r.actual, 0) / xs.length) * 1000) / 10 : null, slots: xs.length }
  }
  const methods = Object.fromEntries(FORECAST_METHODS.map((m) => [m, errOf(m, comparable)])) as Backtest['methods']
  const ranked = FORECAST_METHODS.filter((m) => methods[m].error !== null).sort((a, b) => methods[a].error! - methods[b].error! || (a === 'seasonal' ? -1 : b === 'seasonal' ? 1 : 0))
  const chosen = ranked[0] ?? 'seasonal'
  // the chosen method on every slot (① where it has no data, as the forecast does)
  const rows: BacktestRow[] = raw.flatMap((r) => {
    const f = r.by[chosen] ?? r.by.recent
    return f === null ? [] : [{ ...r, forecast: f, errorPct: Math.round((Math.abs(f - r.actual) / r.actual) * 1000) / 10 }]
  })
  // the chosen base with each weather model
  const wErr = (mode: WeatherMode) => {
    const xs = raw.flatMap((r) => {
      const b = r.base[chosen] ?? r.base.recent
      return b === null ? [] : [Math.abs(Math.round(b * r.ev * r.wf[mode]) - r.actual) / r.actual]
    })
    return { error: xs.length ? Math.round((xs.reduce((a, x) => a + x, 0) / xs.length) * 1000) / 10 : null, slots: xs.length }
  }
  const weatherErr = { rain: wErr('rain'), rainTemp: weather ? wErr('rainTemp') : { error: null, slots: 0 } }
  const weatherChosen: WeatherMode =
    weatherErr.rainTemp.error !== null && weatherErr.rain.error !== null && weatherErr.rainTemp.error < weatherErr.rain.error ? 'rainTemp' : 'rain'
  // the rows shown = the chosen base × the chosen weather model
  const shown = rows.map((r) => {
    const x = raw.find((y) => y.date === r.date && y.store === r.store && y.shift === r.shift)!
    const b = x.base[chosen] ?? x.base.recent
    const f = b === null ? r.forecast : Math.round(b * x.ev * x.wf[weatherChosen])
    return { ...r, forecast: f, errorPct: Math.round((Math.abs(f - r.actual) / r.actual) * 1000) / 10 }
  })
  const error = shown.length ? Math.round((shown.reduce((a, r) => a + r.errorPct, 0) / shown.length) * 10) / 10 : null
  return { error, slots: shown.length, rows: shown, from: addDays(today, -days), methods, chosen, weather: weatherErr, weatherChosen }
}

/** Everything a forecast made on `asOf` uses: rain / weather factors measured before its 28 backtest days, the backtest, the chosen models. */
export interface ForecastModel {
  rain: RainMap
  factors: RainFactors
  wf: WeatherFactors
  check: Backtest
  wIn: WeatherInput
}

/** The forecast as it is made on `asOf`: only figures before that day are used (the forecast card uses today). */
export function forecastModel(ctx: Ctx, typeOf: (d: string) => TargetDayType, wx: WeatherMap, asOf: string, dataFrom: string): ForecastModel {
  const rain = rainOf(wx)
  // the factors are measured before the 28 backtest days, so the backtest is a fair test of them
  const fitTo = addDays(asOf, -29)
  const factors = rainFactors(ctx, typeOf, rain, dataFrom, fitTo)
  const wf = weatherFactors(ctx, typeOf, wx, dataFrom, fitTo)
  const check = backtest(ctx, typeOf, rain, factors, asOf, 28, { wx, factors: wf })
  return { rain, factors, wf, check, wIn: { wx, rain: factors, factors: wf, mode: check.weatherChosen } }
}
