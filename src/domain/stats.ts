// Pure aggregation for the manager screens (unit-tested). Business dates are Tokyo dates.
import { normalizedTo25, PATROL_WARN_MINUTES } from './patrol'
import { addDays, MEETING_TIME, tokyoParts, weekdayOf } from './time'
import { CHOREI_STEPS, SHIFTS, type ChoreiStep, type PatrolType, type Shift } from './types'

export interface StatPatrol {
  id: string
  patroller_id: string
  store_id: string
  business_date: string
  shift: Shift
  patrol_type: PatrolType
  started_at: string
  ended_at: string | null
  score_smile: number | null
  score_voice: number | null
  score_grooming: number | null
  score_clean: number | null
  score_quality: number | null
  total: number | null
  max_total: number | null
  judgement: string | null
  duration_min: number | null
  needs_time_review: boolean
  mask_worn: boolean
  staff_names: string[]
  follow_up_done_at: string | null
  status: 'draft' | 'valid' | 'void'
}

export interface StatChorei {
  id: string
  store_id: string
  business_date: string
  shift: Shift
  leader_id: string
  participants_extra: string[]
  steps_done: Record<ChoreiStep, boolean>
  skip_reason: string | null
  status: 'valid' | 'void'
}

const round1 = (n: number) => Math.round(n * 10) / 10
const avg = (xs: number[]) => (xs.length ? round1(xs.reduce((s, x) => s + x, 0) / xs.length) : null)
export const slotKey = (date: string, storeId: string, shift: Shift) => `${date}|${storeId}|${shift}`

/** Valid, finished patrols only. */
export const scored = (ps: StatPatrol[]) => ps.filter((p) => p.status === 'valid' && p.total !== null && p.max_total)
export const score25 = (p: StatPatrol) => normalizedTo25(p.total!, p.max_total!)

/** Dates from..to inclusive. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  const wd = weekdayOf(date) // 0 = Sunday
  return addDays(date, wd === 0 ? -6 : 1 - wd)
}

/** Has the 朝礼 of this slot already been due (meeting time + 30 min)? */
export function slotDue(date: string, shift: Shift, now: Date): boolean {
  const { date: today, hour, minute } = tokyoParts(now)
  if (date < today) return true
  if (date > today) return false
  const [h, m] = MEETING_TIME[shift].split(':').map(Number) as [number, number]
  return hour * 60 + minute >= h * 60 + m + 30
}

export type SlotState = 'done' | 'missing' | 'upcoming'

export function choreiSlots<T extends StatChorei>(records: T[], dates: string[], storeIds: string[], now: Date) {
  const byKey = new Map(records.filter((r) => r.status === 'valid').map((r) => [slotKey(r.business_date, r.store_id, r.shift), r]))
  const slots: { date: string; storeId: string; shift: Shift; state: SlotState; record?: T }[] = []
  for (const date of dates)
    for (const storeId of storeIds)
      for (const shift of SHIFTS) {
        const record = byKey.get(slotKey(date, storeId, shift))
        slots.push({ date, storeId, shift, record, state: record ? 'done' : slotDue(date, shift, now) ? 'missing' : 'upcoming' })
      }
  return slots
}

/** Completion over the slots that are already due. */
export function completion(slots: { state: SlotState }[]): { done: number; due: number; rate: number | null } {
  const due = slots.filter((s) => s.state !== 'upcoming').length
  const done = slots.filter((s) => s.state === 'done').length
  return { done, due, rate: due ? Math.round((done / due) * 100) : null }
}

export function patrolSummary(ps: StatPatrol[]) {
  const s = scored(ps)
  return {
    count: s.length,
    average: avg(s.map(score25)),
    good: s.filter((p) => p.judgement === 'good').length,
    improve: s.filter((p) => p.judgement === 'improve').length,
    coaching: s.filter((p) => p.judgement === 'coaching').length,
    mask: s.filter((p) => p.mask_worn).length,
  }
}

export function byStoreShift(ps: StatPatrol[], storeIds: string[]) {
  const s = scored(ps)
  return storeIds.flatMap((storeId) =>
    SHIFTS.map((shift) => {
      const xs = s.filter((p) => p.store_id === storeId && p.shift === shift)
      return { storeId, shift, count: xs.length, average: avg(xs.map(score25)) }
    }),
  )
}

export const ITEM_KEYS = ['score_smile', 'score_voice', 'score_grooming', 'score_clean', 'score_quality'] as const

/** Average per item (1–5); ⑤ only over checks where it was scored. */
export function itemAverages(ps: StatPatrol[]) {
  const s = scored(ps)
  return ITEM_KEYS.map((key) => {
    const xs = s.map((p) => p[key]).filter((v): v is number => v !== null)
    return { key, count: xs.length, average: avg(xs) }
  })
}

/** Week-by-week trend (weeks start on Monday). */
export function weeklyTrend(ps: StatPatrol[], records: StatChorei[], from: string, to: string, storeIds: string[], now: Date) {
  const weeks: string[] = []
  for (let w = weekStart(from); w <= to; w = addDays(w, 7)) weeks.push(w)
  return weeks.map((w) => {
    const end = addDays(w, 6)
    const inWeek = (d: string) => d >= w && d <= end && d >= from && d <= to
    const slots = choreiSlots(records, dateRange(w < from ? from : w, end > to ? to : end), storeIds, now)
    return { week: w, ...patrolSummary(ps.filter((p) => inWeek(p.business_date))), chorei: completion(slots) }
  })
}

/**
 * Individual ranking: each patrol's score (on the 25-point scale) counts for every staff member
 * listed in it (対象スタッフ). Patrols recorded as 全員 (no names) are not attributed.
 */
export function staffRanking(ps: StatPatrol[]) {
  const map = new Map<string, number[]>()
  for (const p of scored(ps)) for (const name of p.staff_names) map.set(name, [...(map.get(name) ?? []), score25(p)])
  const rows = [...map.entries()]
    .map(([name, xs]) => ({ name, count: xs.length, average: avg(xs)!, best: round1(Math.max(...xs)), worst: round1(Math.min(...xs)) }))
    .sort((a, b) => b.average - a.average || b.count - a.count || a.name.localeCompare(b.name, 'ja'))
  // equal averages share a rank (1, 1, 3, …)
  const ranked: ((typeof rows)[number] & { rank: number })[] = []
  rows.forEach((row, i) => {
    const prev = ranked[i - 1]
    ranked.push({ ...row, rank: prev && prev.average === row.average ? prev.rank : i + 1 })
  })
  return ranked
}

/** Who led how many 朝礼, and who joined how many (names as recorded). */
export function choreiPeople(records: StatChorei[], leaderName: (id: string) => string) {
  const valid = records.filter((r) => r.status === 'valid')
  const leaders = new Map<string, number>()
  const participants = new Map<string, number>()
  for (const r of valid) {
    const leader = leaderName(r.leader_id)
    leaders.set(leader, (leaders.get(leader) ?? 0) + 1)
    for (const n of r.participants_extra) participants.set(n, (participants.get(n) ?? 0) + 1)
  }
  const sort = (m: Map<string, number>) => [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja'))
  return { leaders: sort(leaders), participants: sort(participants) }
}

/** Which 朝礼 steps were skipped, how often, and why. */
export function skippedSteps(records: StatChorei[]) {
  const valid = records.filter((r) => r.status === 'valid')
  return CHOREI_STEPS.map((step) => {
    const xs = valid.filter((r) => r.steps_done[step] === false)
    return { step, count: xs.length, reasons: [...new Set(xs.map((r) => r.skip_reason).filter((x): x is string => Boolean(x)))] }
  })
}

/** Patrol time for payroll: per patroller, valid patrols with both times. */
export function patrolHours(ps: StatPatrol[]) {
  const valid = ps.filter((p) => p.status === 'valid' && p.duration_min !== null)
  const map = new Map<string, StatPatrol[]>()
  for (const p of valid) map.set(p.patroller_id, [...(map.get(p.patroller_id) ?? []), p])
  return [...map.entries()].map(([patrollerId, xs]) => ({
    patrollerId,
    count: xs.length,
    minutes: xs.reduce((s, p) => s + (p.duration_min ?? 0), 0),
    byType: Object.fromEntries(['before_shift', 'in_shift', 'after_shift', 'random'].map((t) => [t, xs.filter((p) => p.patrol_type === t).length])),
    over: xs.filter((p) => (p.duration_min ?? 0) > PATROL_WARN_MINUTES).length,
    review: xs.filter((p) => p.needs_time_review).length,
  }))
}

/** Items a manager must act on. */
export function actionItems(ps: StatPatrol[]) {
  return {
    coaching: ps.filter((p) => p.status === 'valid' && p.judgement === 'coaching' && !p.follow_up_done_at),
    timeReview: ps.filter((p) => p.status !== 'void' && p.needs_time_review),
  }
}
