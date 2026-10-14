// 休み・遅刻・早退の連絡 and 代わり募集 (migration 20261014000008): pure helpers, unit-tested.
import { chainMinutes, endAt, startAt, type Assignment } from './schedule'
import { addDays } from './time'
import type { Shift } from './types'

export const CHANGE_KINDS = ['absence', 'late', 'early_leave'] as const
export type ChangeKind = (typeof CHANGE_KINDS)[number]

// keep in sync with report_shift_change (SQL) and send-notifications CHANGE_REASON
export const CHANGE_REASONS = ['sick', 'family', 'transport', 'personal', 'paid_leave', 'store', 'other'] as const
export type ChangeReason = (typeof CHANGE_REASONS)[number]
/** 店の都合 is set by managers only; 有給 only for a day off. */
export const reasonsFor = (kind: ChangeKind, manager: boolean): ChangeReason[] =>
  CHANGE_REASONS.filter((r) => (r !== 'store' || manager) && (r !== 'paid_leave' || kind === 'absence'))

export const REASON_ICON: Record<ChangeReason, string> = { sick: '🤒', family: '👪', transport: '🚃', personal: '📌', paid_leave: '🏖️', store: '🏪', other: '✏️' }
export const KIND_ICON: Record<ChangeKind, string> = { absence: '🛌', late: '⏰', early_leave: '🏃' }

export const LATE_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120]
/** Under 2 hours before the start: also phone the manager. */
export const CALL_WITHIN_MIN = 120

export type ChangeStatus = 'open' | 'approved' | 'rejected' | 'cancelled'

export interface ShiftChange {
  id: string
  kind: ChangeKind
  roster_name: string
  requester_id: string | null
  business_date: string
  shift: Shift
  store_id: string | null
  store_mark: string
  start_min: number
  end_min: number
  late_min: number | null
  leave_min: number | null
  reason: ChangeReason
  note: string | null
  note_original: string | null
  recruit: boolean
  swap_ok: boolean
  reported_at: string
  notice_min: number
  status: ChangeStatus
  cover_name: string | null
  give_date: string | null
  give_shift: Shift | null
  decided_at: string | null
  manager_note: string | null
  by_manager: boolean
}

export interface ShiftOffer {
  id: string
  change_id: string
  roster_name: string
  give_date: string | null
  give_shift: Shift | null
  note: string | null
  status: 'offered' | 'accepted' | 'declined' | 'withdrawn'
  created_at: string
}

/** Row of shift_recruits(): no reason, only what others may see. */
export interface Recruit {
  id: string
  kind: ChangeKind
  status: ChangeStatus
  roster_name: string
  business_date: string
  shift: Shift
  store_mark: string
  start_min: number
  end_min: number
  swap_ok: boolean
  offers: number
  my_offer_id: string | null
  my_offer_status: ShiftOffer['status'] | null
  my_give_date: string | null
  my_give_shift: Shift | null
  assigned: boolean
}

/** The part of the shift a replacement would work (from the leave time for 早退). */
export const coverPart = (c: Pick<ShiftChange, 'kind' | 'start_min' | 'end_min' | 'leave_min' | 'business_date' | 'shift' | 'store_mark'>): Assignment => ({
  business_date: c.business_date,
  shift: c.shift,
  store_mark: c.store_mark,
  start_min: c.kind === 'early_leave' && c.leave_min !== null ? c.leave_min : c.start_min,
  end_min: c.end_min,
})

/** Shifts that can still be reported: not over yet, within `days` days. */
export function reportable<T extends Assignment>(xs: T[], now: Date, days = 31): T[] {
  const limit = now.getTime() + days * 86400_000
  return xs.filter((a) => endAt(a) > now && startAt(a).getTime() <= limit).sort((a, b) => startAt(a).getTime() - startAt(b).getTime())
}

/** 早退 times: every 30 minutes between the start and the end (exclusive). */
export function leaveOptions(a: Pick<Assignment, 'start_min' | 'end_min'>): number[] {
  const out: number[] = []
  for (let m = Math.ceil((a.start_min + 1) / 30) * 30; m < a.end_min; m += 30) out.push(m)
  return out
}

/** Minutes from `now` to the start of the shift (negative after the start). */
export const noticeMinutes = (a: Pick<Assignment, 'business_date' | 'start_min' | 'end_min'>, now: Date) => Math.floor((startAt(a).getTime() - now.getTime()) / 60_000)

/** 留学 / 家族滞在 (資格外活動): at most 28 hours in any 7 days in a row. */
export const VISA_LIMIT_MIN = 28 * 60
export type Visa = 'student' | 'dependent'

/** The most minutes in any 7 days in a row (by shift date) that contain `date`. */
export function maxRollingWeek(xs: Pick<Assignment, 'business_date' | 'start_min' | 'end_min'>[], date: string): number {
  let best = 0
  for (let k = 0; k < 7; k++) {
    const from = addDays(date, -k)
    const to = addDays(from, 6)
    best = Math.max(best, xs.filter((a) => a.business_date >= from && a.business_date <= to).reduce((s, a) => s + a.end_min - a.start_min, 0))
  }
  return best
}

export interface VisaWindow {
  roster_name: string
  visa: Visa
  window_from: string
  window_to: string
  minutes: number
}

/** Windows over the limit merged into runs per person: 10/13〜10/22, most 31.5 h. */
export function visaRuns(ws: VisaWindow[], limit = VISA_LIMIT_MIN) {
  const out: { name: string; visa: Visa; from: string; to: string; maxMin: number }[] = []
  for (const w of [...ws].filter((x) => x.minutes > limit).sort((a, b) => a.roster_name.localeCompare(b.roster_name) || a.window_from.localeCompare(b.window_from))) {
    const last = out.at(-1)
    if (last && last.name === w.roster_name && addDays(last.to, -6) >= addDays(w.window_from, -1)) {
      last.to = w.window_to
      last.maxMin = Math.max(last.maxMin, w.minutes)
    } else out.push({ name: w.roster_name, visa: w.visa, from: w.window_from, to: w.window_to, maxMin: w.minutes })
  }
  return out
}

const overlaps = (a: Assignment, b: Assignment) => startAt(a) < endAt(b) && startAt(b) < endAt(a)

export interface Candidate {
  name: string
  /** works at that time already */
  conflict: boolean
  /** minutes of the back-to-back chain if they take it (≥ 12 h → warning) */
  chainMin: number
  /** the most minutes in 7 days in a row around this shift, including it */
  weekMin: number
  limitMin: number | null
  overLimit: boolean
}

/**
 * Who could replace: everyone in `names` except the reporter, with the checks a manager needs
 * (already working, ≥ 12 h in a row, the limit for 7 days in a row e.g. students' 28 h). `assignments`
 * must cover the shift date ±7 days.
 */
export function coverCandidates(
  change: Pick<ShiftChange, 'kind' | 'roster_name' | 'business_date' | 'shift' | 'store_mark' | 'start_min' | 'end_min' | 'leave_min'>,
  assignments: (Assignment & { roster_name: string })[],
  names: string[],
  limits: Map<string, number>,
): Candidate[] {
  const part = coverPart(change)
  return names
    .filter((n) => n !== change.roster_name)
    .map((name) => {
      const own = assignments.filter((a) => a.roster_name === name)
      const conflict = own.some((a) => overlaps(a, part))
      const withIt = [...own.filter((a) => !overlaps(a, part)), part]
      const chainMin = chainMinutes(withIt).get(part) ?? part.end_min - part.start_min
      const weekMin = maxRollingWeek(withIt, change.business_date)
      const limitMin = limits.get(name) ?? null
      return { name, conflict, chainMin, weekMin, limitMin, overLimit: limitMin !== null && weekMin > limitMin }
    })
    .sort((a, b) => Number(a.conflict) - Number(b.conflict) || Number(a.overLimit) - Number(b.overLimit) || a.weekMin - b.weekMin || a.name.localeCompare(b.name, 'ja'))
}
