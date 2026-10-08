import type { DayType, Shift } from './types'

// Japan has no DST, so Asia/Tokyo is always UTC+9.
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

export interface TokyoParts {
  date: string // YYYY-MM-DD
  hour: number
  minute: number
  weekday: number // 0 = Sunday
}

export function tokyoParts(at: Date): TokyoParts {
  const t = new Date(at.getTime() + JST_OFFSET_MS)
  return {
    date: t.toISOString().slice(0, 10),
    hour: t.getUTCHours(),
    minute: t.getUTCMinutes(),
    weekday: t.getUTCDay(),
  }
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

export const MEETING_TIME: Record<Shift, string> = { early: '07:00', middle: '17:00', late: '23:00' }

/**
 * Shift suggested from the current Tokyo time.
 * 6:00–15:59 → 早番, 16:00–21:59 → 中番, 22:00–5:59 → 遅番.
 */
export function detectShift(at: Date): Shift {
  const { hour } = tokyoParts(at)
  if (hour >= 6 && hour < 16) return 'early'
  if (hour >= 16 && hour < 22) return 'middle'
  return 'late'
}

/** A shift belongs to the calendar date on which it starts (遅番 after midnight → previous day). */
export function businessDateFor(at: Date, shift: Shift): string {
  const { date, hour } = tokyoParts(at)
  return shift === 'late' && hour < 12 ? addDays(date, -1) : date
}

export function currentSlot(at: Date): { businessDate: string; shift: Shift } {
  const shift = detectShift(at)
  return { shift, businessDate: businessDateFor(at, shift) }
}

/** The slot immediately before (source of the handover). */
export function previousSlot(businessDate: string, shift: Shift): { businessDate: string; shift: Shift } {
  if (shift === 'early') return { businessDate: addDays(businessDate, -1), shift: 'late' }
  if (shift === 'middle') return { businessDate, shift: 'early' }
  return { businessDate, shift: 'middle' }
}

export function dayType(date: string, holidays: ReadonlySet<string>): DayType {
  const wd = weekdayOf(date)
  return wd === 0 || wd === 6 || holidays.has(date) ? 'weekend_holiday' : 'weekday'
}

/** First day of the month, as stored in target_bowls.month. */
export function monthOf(date: string): string {
  return `${date.slice(0, 7)}-01`
}

/** HH:mm in Tokyo time. */
export function formatTokyoTime(at: Date): string {
  const { hour, minute } = tokyoParts(at)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** M/D(曜) style short date, locale-independent numbers. */
export function formatShortDate(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`
}
