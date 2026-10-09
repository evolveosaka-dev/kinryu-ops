// シフトスケジュール: parsing the shift workbook cells and working with assignments.
import { addDays, tokyoParts } from './time'
import type { Shift } from './types'

export interface Assignment {
  business_date: string
  shift: Shift
  store_mark: string
  start_min: number // minutes from 00:00 of business_date (may exceed 1440)
  end_min: number
}

export const STORE_BY_MARK: Record<string, { ja: string; short: string; code?: 'midosuji' | 'sennichimae' }> = {
  '①': { ja: '御堂筋店', short: '御堂筋', code: 'midosuji' },
  '③': { ja: '戎橋店', short: '戎橋' },
  '④': { ja: '道頓堀店', short: '道頓堀' },
  '⑤': { ja: '千日前店', short: '千日前', code: 'sennichimae' },
}

/** "①11-17.5" → ① 11:00–17:30; "⑤23-7" → 23:00–07:00 next day. */
export function parseCell(raw: string): { store_mark: string; start_min: number; end_min: number } | null {
  const m = /^\s*([①②③④⑤])\s*(\d{1,2}(?:\.\d+)?)\s*-\s*(\d{1,2}(?:\.\d+)?)\s*$/.exec(raw)
  if (!m) return null
  const start = Math.round(Number(m[2]) * 60)
  let end = Math.round(Number(m[3]) * 60)
  if (end <= start) end += 24 * 60
  if (start > 24 * 60 || end - start > 24 * 60) return null
  return { store_mark: m[1]!, start_min: start, end_min: end }
}

export const formatMin = (min: number) => `${Math.floor(min / 60) % 24}:${String(min % 60).padStart(2, '0')}`
export const formatRange = (a: Pick<Assignment, 'start_min' | 'end_min'>) => `${formatMin(a.start_min)}–${formatMin(a.end_min)}`

const JST = 9 * 3600_000
export const startAt = (a: Assignment) => new Date(Date.parse(`${a.business_date}T00:00:00Z`) - JST + a.start_min * 60_000)
export const endAt = (a: Assignment) => new Date(Date.parse(`${a.business_date}T00:00:00Z`) - JST + a.end_min * 60_000)

export const sortAssignments = <T extends Assignment>(xs: T[]) => [...xs].sort((a, b) => startAt(a).getTime() - startAt(b).getTime())

/** The shift in progress, or else the next one to start. */
export function nextShift<T extends Assignment>(xs: T[], now: Date): { assignment: T; inProgress: boolean } | null {
  for (const a of sortAssignments(xs)) {
    if (endAt(a) <= now) continue
    return { assignment: a, inProgress: startAt(a) <= now }
  }
  return null
}

/** Days from today (Tokyo) to the shift's business date: 0 = today. */
export function daysUntil(a: Assignment, now: Date): number {
  const today = tokyoParts(now).date
  return Math.round((Date.parse(`${a.business_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400_000)
}

/**
 * Back-to-back shifts (one ends when the next starts, e.g. 中番 17-23 + 遅番 23-7) are chained;
 * returns, for each assignment, the total length in minutes of its chain.
 */
export function chainMinutes<T extends Assignment>(xs: T[]): Map<T, number> {
  const sorted = sortAssignments(xs)
  const out = new Map<T, number>()
  let chain: T[] = []
  const flush = () => {
    const total = chain.reduce((s, a) => s + a.end_min - a.start_min, 0)
    for (const a of chain) out.set(a, total)
    chain = []
  }
  for (const a of sorted) {
    const prev = chain.at(-1)
    if (prev && endAt(prev).getTime() === startAt(a).getTime()) chain.push(a)
    else {
      if (chain.length) flush()
      chain = [a]
    }
  }
  if (chain.length) flush()
  return out
}

export const LONG_CHAIN_MIN = 12 * 60

/** Monday-to-Sunday dates of the week containing `date`. */
export function weekDates(date: string): string[] {
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay()
  const monday = addDays(date, wd === 0 ? -6 : 1 - wd)
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}
