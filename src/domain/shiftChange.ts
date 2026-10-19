// 休み・遅刻・早退の連絡 and 代わり募集 (migration 20261014000008): pure helpers, unit-tested.
import { chainMinutes, endAt, startAt, type Assignment } from './schedule'
import { addDays } from './time'
import type { Shift } from './types'

export const CHANGE_KINDS = ['absence', 'late', 'early_leave'] as const
export type ChangeKind = (typeof CHANGE_KINDS)[number]

// keep in sync with report_shift_change (SQL) and send-notifications CHANGE_REASON
export const CHANGE_REASONS = ['sick', 'family', 'transport', 'personal', 'paid_leave', 'store', 'other'] as const
export type ChangeReason = (typeof CHANGE_REASONS)[number]
/**
 * 店の都合 is set by managers only. 有給 is not chosen here (owner, 2026-10-15): paid leave days are
 * requested with シフト希望提出 for the next month; the value stays for older reports.
 */
export const reasonsFor = (_kind: ChangeKind, manager: boolean): ChangeReason[] =>
  CHANGE_REASONS.filter((r) => r !== 'paid_leave' && (r !== 'store' || manager))

export const REASON_ICON: Record<ChangeReason, string> = { sick: '🤒', family: '👪', transport: '🚃', personal: '📌', paid_leave: '🏖️', store: '🏪', other: '✏️' }
export const KIND_ICON: Record<ChangeKind, string> = { absence: '🛌', late: '⏰', early_leave: '🏃' }

/** 遅れる: every 5 minutes, while the person still arrives before the end (the DB allows up to 600). */
export function lateOptions(a: Pick<Assignment, 'start_min' | 'end_min'>): number[] {
  const out: number[] = []
  for (let m = 5; m < Math.min(601, a.end_min - a.start_min); m += 5) out.push(m)
  return out
}
/** Later than this, 休む is the better report. */
export const LATE_WARN_MIN = 120
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
  /** named by the reporter (代わりの人を指名), waiting for a manager */
  proposed_cover: string | null
  /** the named person's answer (null on reports before 2026-10-18: no answer needed) */
  cover_consent: 'pending' | 'accepted' | 'declined' | null
  cover_consent_note: string | null
}

/** Why someone cannot take a shift (SQL cover_problem / visa_over). */
export interface CoverProblem {
  problem: 'self' | 'unknown' | 'busy' | 'visa' | 'visa_other'
  name: string
  minutes?: number
  from?: string
  to?: string
}

/** The server refuses with 'cover_problem:{json}'. */
export function coverProblemOf(err: unknown): CoverProblem | null {
  const msg = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : ''
  const m = /cover_problem:(\{.*\})/.exec(msg)
  if (!m) return null
  try {
    return JSON.parse(m[1]!) as CoverProblem
  } catch {
    return null
  }
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
  /** the reporter named me */
  designated: boolean
  /** minutes in the worst 7 days if I took it, when over 28 h (留学 / 家族滞在) */
  my_over_min: number | null
  /** my answer when I am named */
  my_consent: 'pending' | 'accepted' | 'declined' | null
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

/** 早退 times: every 15 minutes, from 15 minutes after the start until before the end. */
export function leaveOptions(a: Pick<Assignment, 'start_min' | 'end_min'>): number[] {
  const out: number[] = []
  for (let m = Math.ceil((a.start_min + 15) / 15) * 15; m < a.end_min; m += 15) out.push(m)
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

export interface VisaWeek {
  from: string
  to: string
  minutes: number
}

export interface VisaFix {
  /** every 7 days in a row over the limit (by first day) */
  over: VisaWeek[]
  /** suggested shifts to take off (not started yet), by date */
  remove: Assignment[]
  /** still over after taking them off: the excess is on past days, which cannot be changed */
  after: VisaWeek[]
}

/**
 * Which 7-day windows starting between `from` and `to` are over the limit, and which shifts not started yet (after
 * `today` + `nowMin` minutes) to take
 * off so that none is: greedy — each time the shift that removes the most excess (Σ over the windows it is in of
 * min(excess, its length)), ties → in more windows, then the later day (more notice). Hours = end − start by shift date,
 * as visa_hour_windows.
 */
export function visaFix(shifts: Assignment[], from: string, to: string, today: string, nowMin = -1, limit = VISA_LIMIT_MIN): VisaFix {
  const len = (a: Assignment) => a.end_min - a.start_min
  const weeks = (xs: Assignment[]) => {
    const out: (VisaWeek & { shifts: Assignment[] })[] = []
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const end = addDays(d, 6)
      const inside = xs.filter((a) => a.business_date >= d && a.business_date <= end)
      const minutes = inside.reduce((m, a) => m + len(a), 0)
      if (minutes > limit) out.push({ from: d, to: end, minutes, shifts: inside })
    }
    return out
  }
  const byDate = (xs: Assignment[]) => [...xs].sort((x, y) => x.business_date.localeCompare(y.business_date) || x.start_min - y.start_min)
  const strip = ({ from: f, to: t, minutes }: VisaWeek) => ({ from: f, to: t, minutes })
  const over = weeks(shifts)
  let left = [...shifts]
  const remove: Assignment[] = []
  for (let cur = over; cur.length; cur = weeks(left)) {
    const scored = left
      .filter((a) => a.business_date > today || (a.business_date === today && a.start_min > nowMin))
      .map((a) => {
        const ws = cur.filter((w) => w.shifts.includes(a))
        return { a, gain: ws.reduce((g, w) => g + Math.min(w.minutes - limit, len(a)), 0), n: ws.length }
      })
      .filter((x) => x.gain > 0)
      .sort((x, y) => y.gain - x.gain || y.n - x.n || y.a.business_date.localeCompare(x.a.business_date))
    const best = scored[0]
    if (!best) return { over: over.map(strip), remove: byDate(remove), after: cur.map(strip) }
    remove.push(best.a)
    left = left.filter((a) => a !== best.a)
  }
  return { over: over.map(strip), remove: byDate(remove), after: [] }
}

/** What a manager hid (per person): the run's last day and its highest minutes at that moment. */
export type VisaDismissed = Record<string, { to: string; maxMin: number }>

/** A hidden run stays hidden until it gets worse: a later last day or more hours than when it was hidden. */
export const visaHidden = (run: { name: string; to: string; maxMin: number }, d: VisaDismissed) => {
  const x = d[run.name]
  return Boolean(x && run.to <= x.to && run.maxMin <= x.maxMin)
}

const overlaps = (a: Assignment, b: Assignment) => startAt(a) < endAt(b) && startAt(b) < endAt(a)

/** A cover right after a shift of 8 h or more (ending ≤ 1 h before) gets a warning. */
export const LONG_PREV_MIN = 8 * 60
const PREV_GAP_MIN = 60

export interface Candidate {
  name: string
  /** the shift just before (ends ≤ 1 h before the cover starts) when it is 8 h or longer */
  prev: Assignment | null
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
      const gap = (a: Assignment) => (startAt(part).getTime() - endAt(a).getTime()) / 60_000
      const prev = own.find((a) => !overlaps(a, part) && gap(a) >= 0 && gap(a) <= PREV_GAP_MIN && a.end_min - a.start_min >= LONG_PREV_MIN) ?? null
      const withIt = [...own.filter((a) => !overlaps(a, part)), part]
      const chainMin = chainMinutes(withIt).get(part) ?? part.end_min - part.start_min
      const weekMin = maxRollingWeek(withIt, change.business_date)
      const limitMin = limits.get(name) ?? null
      return { name, prev, conflict, chainMin, weekMin, limitMin, overLimit: limitMin !== null && weekMin > limitMin }
    })
    .sort((a, b) => Number(a.conflict) - Number(b.conflict) || Number(a.overLimit) - Number(b.overLimit) || a.weekMin - b.weekMin || a.name.localeCompare(b.name, 'ja'))
}
