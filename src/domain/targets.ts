import { addDays, dayType, monthOf, weekdayOf } from './time'
import type { Shift } from './types'

// 目標杯数 v2 (from 2026-10): six day types and events (阪神, Halloween…) per store and shift.
// Keep the day types in sync with the SQL check on target_bowls.day_type.

export const TARGET_DAY_TYPES = ['weekday', 'friday', 'saturday', 'sunday_holiday', 'long_holiday', 'peak'] as const
export type TargetDayType = (typeof TARGET_DAY_TYPES)[number]
export const LEGACY_DAY_TYPES = ['weekday', 'weekend_holiday'] as const
/** First month with the six day types. */
export const TARGETS_V2_FROM = '2026-10-01'

export interface TargetRow {
  store_id: string
  month: string
  shift: Shift
  day_type: string
  bowls: number
}

export interface TargetEvent {
  id: string
  event_date: string
  name: string
  store_id: string | null
  early_pct: number
  middle_pct: number
  late_pct: number
  active: boolean
  note: string | null
}

/** 年末年始 (12/29–1/3) and お盆 (8/13–16). */
export function isPeak(date: string): boolean {
  const m = Number(date.slice(5, 7))
  const d = Number(date.slice(8, 10))
  return (m === 12 && d >= 29) || (m === 1 && d <= 3) || (m === 8 && d >= 13 && d <= 16)
}

const isOff = (date: string, holidays: ReadonlySet<string>) => {
  const wd = weekdayOf(date)
  return wd === 0 || wd === 6 || holidays.has(date)
}

/** The day type of a date (Japanese calendar). */
export function targetDayType(date: string, holidays: ReadonlySet<string>): TargetDayType {
  if (isPeak(date)) return 'peak'
  const next = addDays(date, 1)
  if (!isOff(date, holidays)) return isOff(next, holidays) ? 'friday' : 'weekday'
  // a day off: the last one before a working day is 日曜・祝日; inside a run of 3+ days off it is 連休中
  if (!isOff(next, holidays)) return 'sunday_holiday'
  let run = 1
  for (let d = addDays(date, -1); isOff(d, holidays); d = addDays(d, -1)) run++
  for (let d = next; isOff(d, holidays); d = addDays(d, 1)) run++
  if (run >= 3) return 'long_holiday'
  return weekdayOf(date) === 6 ? 'saturday' : 'sunday_holiday'
}

export const pctOf = (e: Pick<TargetEvent, 'early_pct' | 'middle_pct' | 'late_pct'>, shift: Shift) =>
  shift === 'early' ? e.early_pct : shift === 'middle' ? e.middle_pct : e.late_pct

/** 「土曜の目安：677杯（阪神 −20%）」 — `t` with the chorei namespace. */
export function targetHint(t: (key: string, o?: Record<string, unknown>) => string, r: TargetResult): string {
  const base = t('chorei:target.hint', { dayType: t(`chorei:target.${r.dayType}`), bowls: r.bowls })
  return r.events.length ? `${base}（${r.events.map((e) => `${e.name} ${e.pct > 0 ? '+' : ''}${e.pct}%`).join('・')}）` : base
}

export interface TargetResult {
  /** after the events */
  bowls: number
  /** before the events */
  base: number
  dayType: string
  events: { name: string; pct: number }[]
}

/** The target of one store / date / shift: six day types (legacy 平日・土日祝 as fallback), then the events. */
export function findTarget(
  targets: TargetRow[],
  events: TargetEvent[],
  storeId: string,
  date: string,
  shift: Shift,
  holidays: ReadonlySet<string>,
): TargetResult | null {
  const month = monthOf(date)
  const types = [targetDayType(date, holidays), dayType(date, holidays)]
  let row: TargetRow | undefined
  for (const t of types) {
    row = targets.find((x) => x.store_id === storeId && x.month === month && x.shift === shift && x.day_type === t)
    if (row) break
  }
  if (!row) return null
  const evs = events
    .filter((e) => e.active && e.event_date === date && (e.store_id === null || e.store_id === storeId))
    .map((e) => ({ name: e.name, pct: pctOf(e, shift) }))
    .filter((e) => e.pct !== 0)
  const factor = evs.reduce((f, e) => f * (1 + e.pct / 100), 1)
  return { bowls: Math.round(row.bowls * factor), base: row.bowls, dayType: row.day_type, events: evs }
}
