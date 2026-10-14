import { findTarget, targetDayType, TARGET_DAY_TYPES, type TargetEvent, type TargetRow } from './targets'
import { addDays, weekdayOf } from './time'
import { SHIFTS, type Shift } from './types'

// 管理 → 分析: pure calculations on daily_sales (bowls = ラーメン + チャーシューメン, クーポン not included).

export interface Sale {
  store_id: string
  business_date: string
  shift: Shift
  bowls: number
}

export interface Ctx {
  sales: Map<string, number>
  targets: TargetRow[]
  events: TargetEvent[]
  holidays: ReadonlySet<string>
  storeIds: string[]
  shifts: Shift[]
}

/** Figures before this day are not used in any analysis (owner, 2026-10-14). */
export const DATA_FROM = '2025-01-01'

export const slotKey = (date: string, store: string, shift: string) => `${date}|${store}|${shift}`
export const indexSales = (rows: Sale[]) =>
  new Map(rows.filter((r) => r.business_date >= DATA_FROM).map((r) => [slotKey(r.business_date, r.store_id, r.shift), r.bowls]))
/** Same weekday one year before (52 weeks). */
export const lastYear = (date: string) => addDays(date, -364)

export function monthDays(month: string): string[] {
  const out: string[] = []
  const end = month.slice(0, 7)
  for (let d = `${end}-01`; d.slice(0, 7) === end; d = addDays(d, 1)) out.push(d)
  return out
}

export interface DayView {
  date: string
  dayType: string
  /** bowls of the slots that have figures */
  actual: number | null
  /** target of the same slots (with events) */
  target: number | null
  /** target of all selected slots (for days without figures) */
  targetAll: number | null
  /** same weekday last year, same slots */
  lastYear: number | null
  complete: boolean
  events: string[]
  slots: { store: string; shift: Shift; actual: number | null; target: number | null; base: number | null; lastYear: number | null; events: { name: string; pct: number }[] }[]
}

export function dayView(ctx: Ctx, date: string): DayView {
  let actual = 0, target = 0, targetAll = 0, ly = 0
  let has = 0, tgtN = 0, lyN = 0, allN = 0
  const evNames = new Set<string>()
  const slots: DayView['slots'] = []
  for (const store of ctx.storeIds)
    for (const shift of ctx.shifts) {
      const a = ctx.sales.get(slotKey(date, store, shift)) ?? null
      const t = findTarget(ctx.targets, ctx.events, store, date, shift, ctx.holidays)
      t?.events.forEach((e) => evNames.add(e.name))
      slots.push({ store, shift, actual: a, target: t?.bowls ?? null, base: t?.base ?? null, lastYear: ctx.sales.get(slotKey(lastYear(date), store, shift)) ?? null, events: t?.events ?? [] })
      if (t) {
        targetAll += t.bowls
        allN++
      }
      if (a !== null) {
        actual += a
        has++
        if (t) {
          target += t.bowls
          tgtN++
        }
        const l = ctx.sales.get(slotKey(lastYear(date), store, shift))
        if (l !== undefined) {
          ly += l
          lyN++
        }
      }
    }
  const n = ctx.storeIds.length * ctx.shifts.length
  return {
    date,
    dayType: targetDayType(date, ctx.holidays),
    actual: has ? actual : null,
    target: tgtN ? target : null,
    targetAll: allN ? targetAll : null,
    lastYear: lyN && lyN === has ? ly : null,
    complete: has === n,
    events: [...evNames],
    slots,
  }
}

export const rateOf = (a: number | null, t: number | null) => (a === null || !t ? null : Math.round((a / t) * 1000) / 10)

export interface MonthSummary {
  actual: number
  target: number
  rate: number | null
  /** this year vs same weekday last year (slots with both) */
  yoy: number | null
  lyActual: number
  forecast: number | null
  best: DayView | null
  worst: DayView | null
  daysWithData: number
}

export function monthSummary(ctx: Ctx, month: string, today: string): MonthSummary {
  const days = monthDays(month).map((d) => dayView(ctx, d))
  let actual = 0, target = 0, cur = 0, ly = 0, rest = 0
  for (const d of days) {
    if (d.actual !== null) {
      actual += d.actual
      target += d.target ?? 0
      if (d.lastYear !== null) {
        cur += d.actual
        ly += d.lastYear
      }
    } else if (d.date >= today && d.targetAll !== null) rest += d.targetAll
  }
  const complete = days.filter((d) => d.complete && d.actual !== null)
  const sorted = [...complete].sort((a, b) => a.actual! - b.actual!)
  const future = days.some((d) => d.date >= today)
  return {
    actual,
    target,
    rate: rateOf(actual, target),
    yoy: ly ? Math.round((cur / ly - 1) * 1000) / 10 : null,
    lyActual: ly,
    forecast: future ? actual + rest : null,
    best: sorted.at(-1) ?? null,
    worst: sorted[0] ?? null,
    daysWithData: days.filter((d) => d.actual !== null).length,
  }
}

export interface TypeRow {
  dayType: string
  days: number
  /** per shift: average actual / target per day */
  cells: Record<Shift, { actual: number | null; target: number | null; rate: number | null }>
  total: { actual: number | null; target: number | null; rate: number | null }
}

/** Shift × day type of a month: average bowls per day (over the selected stores) and the target. */
export function typeTable(ctx: Ctx, month: string): TypeRow[] {
  const days = monthDays(month)
  return TARGET_DAY_TYPES.map((dayType) => {
    const ds = days.filter((d) => targetDayType(d, ctx.holidays) === dayType)
    const cells = {} as TypeRow['cells']
    let totA = 0, totT = 0, totN = 0
    for (const shift of SHIFTS) {
      let a = 0, t = 0, n = 0
      for (const d of ds) {
        const v = dayView({ ...ctx, shifts: [shift] }, d)
        if (v.complete && v.actual !== null && v.target !== null) {
          a += v.actual
          t += v.target
          n++
        }
      }
      cells[shift] = { actual: n ? Math.round(a / n) : null, target: n ? Math.round(t / n) : null, rate: n ? rateOf(a, t) : null }
    }
    for (const d of ds) {
      const v = dayView({ ...ctx, shifts: [...SHIFTS] }, d)
      if (v.complete && v.actual !== null && v.target !== null) {
        totA += v.actual
        totT += v.target
        totN++
      }
    }
    return {
      dayType,
      days: ds.length,
      cells,
      total: { actual: totN ? Math.round(totA / totN) : null, target: totN ? Math.round(totT / totN) : null, rate: totN ? rateOf(totA, totT) : null },
    }
  }).filter((r) => r.days > 0)
}

/** Average bowls per complete day, per month. */
export function monthlyTrend(ctx: Ctx, fromMonth: string, toMonth: string): { month: string; avg: number | null; days: number }[] {
  const out: { month: string; avg: number | null; days: number }[] = []
  for (let m = `${fromMonth.slice(0, 7)}-01`; m <= toMonth; m = `${addDays(`${m.slice(0, 7)}-28`, 4).slice(0, 7)}-01`) {
    let sum = 0, n = 0
    for (const d of monthDays(m)) {
      const v = dayView({ ...ctx, targets: [], events: [] }, d)
      if (v.complete && v.actual !== null) {
        sum += v.actual
        n++
      }
    }
    out.push({ month: m, avg: n ? Math.round(sum / n) : null, days: n })
  }
  return out
}

/** ISO week of a date: the week belongs to the year of its Thursday (week 1 holds the first Thursday). */
export function isoWeek(date: string): { year: string; week: number } {
  const thu = addDays(date, 3 - ((weekdayOf(date) + 6) % 7))
  const jan1 = `${thu.slice(0, 4)}-01-01`
  const dayOfYear = Math.round((Date.parse(thu) - Date.parse(jan1)) / 86_400_000)
  return { year: thu.slice(0, 4), week: Math.floor(dayOfYear / 7) + 1 }
}

/** Average bowls per complete day, per ISO week (Monday–Sunday). */
export function weeklyTrend(ctx: Ctx, from: string, to: string): { monday: string; year: string; week: number; avg: number | null; days: number }[] {
  const out: { monday: string; year: string; week: number; avg: number | null; days: number }[] = []
  const plain = { ...ctx, targets: [], events: [] }
  for (let mon = mondayOf(from); mon <= to; mon = addDays(mon, 7)) {
    let sum = 0, n = 0
    for (let i = 0; i < 7; i++) {
      const d = addDays(mon, i)
      if (d > to) break
      const v = dayView(plain, d)
      if (v.complete && v.actual !== null) {
        sum += v.actual
        n++
      }
    }
    out.push({ monday: mon, ...isoWeek(mon), avg: n ? Math.round(sum / n) : null, days: n })
  }
  return out
}

export interface TypeYearRow {
  dayType: string
  /** per year: average bowls per complete day of that type in the month */
  cells: Record<string, { avg: number | null; days: number }>
}

/** The six day types of one month compared with the same month of the years before; years without any complete day are left out. */
export function typeYears(ctx: Ctx, month: string): { years: string[]; rows: TypeYearRow[] } {
  const plain = { ...ctx, targets: [], events: [] }
  const mm = month.slice(5, 7)
  const sums = new Map<string, { sum: number; n: number }>() // `${year}|${type}`
  const years: string[] = []
  for (let y = Number(DATA_FROM.slice(0, 4)); y <= Number(month.slice(0, 4)); y++) {
    let any = false
    for (const d of monthDays(`${y}-${mm}-01`)) {
      const v = dayView(plain, d)
      if (!v.complete || v.actual === null) continue
      any = true
      const k = `${y}|${v.dayType}`
      const s = sums.get(k) ?? { sum: 0, n: 0 }
      s.sum += v.actual
      s.n++
      sums.set(k, s)
    }
    if (any) years.push(String(y))
  }
  const rows = TARGET_DAY_TYPES.map((dayType) => ({
    dayType,
    cells: Object.fromEntries(
      years.map((y) => {
        const s = sums.get(`${y}|${dayType}`)
        return [y, { avg: s ? Math.round(s.sum / s.n) : null, days: s?.n ?? 0 }]
      }),
    ),
  })).filter((r) => years.some((y) => r.cells[y]!.days > 0))
  return { years, rows }
}

export interface PatrolScore {
  business_date: string
  store_id: string
  shift: Shift
  score25: number
}

export interface WeekView {
  monday: string
  avg: number | null
  lyAvg: number | null
  /** this year / last year − 1 (%) */
  yoy: number | null
  patrol: number | null
  patrols: number
}

/** Monday of the ISO week. */
export const mondayOf = (date: string) => addDays(date, -((weekdayOf(date) + 6) % 7))

/** Weekly average per day this year vs the same weekdays last year, and the patrol average of the week. */
export function weekly(ctx: Ctx, from: string, to: string, patrols: PatrolScore[]): WeekView[] {
  const out: WeekView[] = []
  for (let mon = mondayOf(from); mon <= to; mon = addDays(mon, 7)) {
    let cur = 0, ly = 0, n = 0, curAll = 0, nAll = 0
    for (let i = 0; i < 7; i++) {
      const d = addDays(mon, i)
      if (d > to) break
      const v = dayView({ ...ctx, targets: [], events: [] }, d)
      if (v.complete && v.actual !== null) {
        curAll += v.actual
        nAll++
        if (v.lastYear !== null) {
          cur += v.actual
          ly += v.lastYear
          n++
        }
      }
    }
    const ps = patrols.filter((p) => p.business_date >= mon && p.business_date <= addDays(mon, 6) && ctx.storeIds.includes(p.store_id) && ctx.shifts.includes(p.shift))
    out.push({
      monday: mon,
      avg: nAll ? Math.round(curAll / nAll) : null,
      lyAvg: n ? Math.round(ly / n) : null,
      yoy: n && ly ? Math.round((cur / ly - 1) * 1000) / 10 : null,
      patrol: ps.length ? Math.round((ps.reduce((s, p) => s + p.score25, 0) / ps.length) * 10) / 10 : null,
      patrols: ps.length,
    })
  }
  return out
}

/** 達成率 of the patrolled slots by patrol score band (does a better patrol go with better sales?). */
export function patrolBands(ctx: Ctx, patrols: PatrolScore[]) {
  const bands = [
    { key: 'good', min: 20, max: 26 },
    { key: 'improve', min: 15, max: 20 },
    { key: 'coaching', min: 0, max: 15 },
  ]
  return bands.map((b) => {
    let a = 0, t = 0, n = 0
    for (const p of patrols) {
      if (p.score25 < b.min || p.score25 >= b.max || !ctx.storeIds.includes(p.store_id) || !ctx.shifts.includes(p.shift)) continue
      const actual = ctx.sales.get(slotKey(p.business_date, p.store_id, p.shift))
      const tg = findTarget(ctx.targets, ctx.events, p.store_id, p.business_date, p.shift, ctx.holidays)
      if (actual === undefined || !tg) continue
      a += actual
      t += tg.bowls
      n++
    }
    return { key: b.key, slots: n, rate: rateOf(n ? a : null, t) }
  })
}

export interface EventEffect {
  name: string
  storeId: string | null
  from: string
  to: string
  active: boolean
  /** per shift: the % set and the % measured (actual / target before the event − 1) */
  shifts: { shift: Shift; set: number; measured: number | null; slots: number }[]
}

/** Each event (consecutive days, same name / store / %): measured effect vs the % that was set. */
export function eventEffects(ctx: Ctx, events: TargetEvent[]): EventEffect[] {
  const sorted = [...events].sort((a, b) => a.name.localeCompare(b.name) || String(a.store_id).localeCompare(String(b.store_id)) || a.event_date.localeCompare(b.event_date))
  const groups: { e: TargetEvent; dates: string[] }[] = []
  for (const e of sorted) {
    const g = groups.at(-1)
    if (g && g.e.name === e.name && g.e.store_id === e.store_id && g.e.early_pct === e.early_pct && g.e.middle_pct === e.middle_pct && g.e.late_pct === e.late_pct && addDays(g.dates.at(-1)!, 1) === e.event_date) g.dates.push(e.event_date)
    else groups.push({ e, dates: [e.event_date] })
  }
  return groups
    .filter((g) => g.e.store_id === null || ctx.storeIds.includes(g.e.store_id))
    .map(({ e, dates }) => ({
      name: e.name,
      storeId: e.store_id,
      from: dates[0]!,
      to: dates.at(-1)!,
      active: e.active,
      shifts: SHIFTS.map((shift) => {
        const set = shift === 'early' ? e.early_pct : shift === 'middle' ? e.middle_pct : e.late_pct
        let a = 0, base = 0, n = 0
        for (const d of dates)
          for (const store of e.store_id ? [e.store_id] : ctx.storeIds) {
            const actual = ctx.sales.get(slotKey(d, store, shift))
            const t = findTarget(ctx.targets, [], store, d, shift, ctx.holidays)
            if (actual === undefined || !t) continue
            a += actual
            base += t.bowls
            n++
          }
        return { shift, set, measured: n && base ? Math.round((a / base - 1) * 1000) / 10 : null, slots: n }
      }),
    }))
}
