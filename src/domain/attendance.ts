// 出勤評価: the points come from attendance_events() (SQL, migration 20261014000009); this adds them up.
// 100 + the points of the last 90 days (at most 100). A ≥ 95 / B 85–94 / C 70–84 / D < 70.
// C or lower → 面談; D or 2 無断欠勤 within 90 days → urgent.

export const WINDOW_DAYS = 90

export type AttendanceKind = 'absence' | 'late' | 'early_leave' | 'paid_leave' | 'cover' | 'perfect'

export interface AttendanceEvent {
  event_key: string
  roster_name: string
  business_date: string
  shift: string | null
  kind: AttendanceKind
  reason: string | null
  minutes: number | null
  notice_min: number | null
  reported: boolean
  base_points: number
  points: number
  excluded: boolean
  note: string | null
}

export type Grade = 'A' | 'B' | 'C' | 'D'

export const gradeOf = (score: number): Grade => (score >= 95 ? 'A' : score >= 85 ? 'B' : score >= 70 ? 'C' : 'D')

export const GRADE_STYLE: Record<Grade, string> = {
  A: 'bg-green-100 text-green-900',
  B: 'bg-sky-100 text-sky-900',
  C: 'bg-amber-100 text-amber-900',
  D: 'bg-red-100 text-red-900',
}

/** How a single event is labelled: 無断欠勤 = an absence with −10 (after the start / no report). */
export type EventLabel = 'noShow' | 'sameDay' | 'advance' | 'paid' | 'late' | 'early' | 'cover' | 'perfect'

export function labelOf(e: Pick<AttendanceEvent, 'kind' | 'base_points' | 'reason'>): EventLabel {
  if (e.kind === 'cover') return 'cover'
  if (e.kind === 'perfect') return 'perfect'
  if (e.kind === 'paid_leave') return 'paid'
  if (e.kind === 'late') return 'late'
  if (e.kind === 'early_leave') return 'early'
  if (e.base_points <= -10) return 'noShow'
  if (e.base_points <= -3) return 'sameDay'
  return 'advance'
}

export interface PersonScore {
  name: string
  score: number
  grade: Grade
  /** sum of the points (may be > 0 before the cap) */
  points: number
  counts: Record<EventLabel, number>
  /** 面談 recommended */
  interview: boolean
  /** D, or 2+ 無断欠勤 */
  urgent: boolean
  events: AttendanceEvent[]
}

const emptyCounts = (): Record<EventLabel, number> => ({ noShow: 0, sameDay: 0, advance: 0, paid: 0, late: 0, early: 0, cover: 0, perfect: 0 })

/** Scores per person; `names` adds people without any event (100, A). Sorted worst first. */
export function attendanceScores(events: AttendanceEvent[], names: string[] = []): PersonScore[] {
  const by = new Map<string, AttendanceEvent[]>()
  for (const n of names) by.set(n, [])
  for (const e of events) by.set(e.roster_name, [...(by.get(e.roster_name) ?? []), e])
  return [...by.entries()]
    .map(([name, xs]) => {
      const points = xs.reduce((s, e) => s + e.points, 0)
      const score = Math.min(100, 100 + points)
      const counts = emptyCounts()
      for (const e of xs) if (!e.excluded) counts[labelOf(e)]++
      const grade = gradeOf(score)
      return { name, score, grade, points, counts, interview: grade === 'C' || grade === 'D', urgent: grade === 'D' || counts.noShow >= 2, events: xs }
    })
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, 'ja'))
}
