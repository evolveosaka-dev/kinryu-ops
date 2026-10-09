import type { PatrolType, Shift } from './types'
import { addDays, businessDateFor, detectShift, tokyoParts } from './time'

export const PATROL_ITEMS = ['smile', 'voice', 'grooming', 'clean', 'quality'] as const
export type PatrolItem = (typeof PATROL_ITEMS)[number]
export type Score = 1 | 2 | 3 | 4 | 5
export const SCORES: readonly Score[] = [5, 4, 3, 2, 1]

export interface PatrolScores {
  smile: Score
  voice: Score
  grooming: Score
  clean: Score
  /** null = not checked (－): no bowl was served during the patrol */
  quality: Score | null
}

export type Judgement = 'good' | 'improve' | 'coaching'

export const PATROL_TARGET_25 = 20
export const PATROL_WARN_MINUTES = 15
export const PATROL_REVIEW_MINUTES = 60

export function patrolTotal(s: PatrolScores): number {
  return s.smile + s.voice + s.grooming + s.clean + (s.quality ?? 0)
}

export function patrolMax(s: Pick<PatrolScores, 'quality'>): 20 | 25 {
  return s.quality === null ? 20 : 25
}

/** Keep in sync with public.patrol_judgement() in supabase/migrations. */
export function judgementOf(total: number, max: 20 | 25): Judgement {
  if (max === 25) {
    if (total >= 20) return 'good'
    if (total >= 15) return 'improve'
    return 'coaching'
  }
  if (total >= 16) return 'good'
  if (total >= 12) return 'improve'
  return 'coaching'
}

export function judgePatrol(s: PatrolScores): { total: number; max: 20 | 25; judgement: Judgement } {
  const total = patrolTotal(s)
  const max = patrolMax(s)
  return { total, max, judgement: judgementOf(total, max) }
}

/** 4-item checks are compared on the 25-point scale. */
export function normalizedTo25(total: number, max: number): number {
  return (total / max) * 25
}

/** Whole minutes between start and end, no rounding up (patrol pay = actual minutes). */
export function durationMinutes(startedAt: Date, endedAt: Date): number {
  return Math.floor((endedAt.getTime() - startedAt.getTime()) / 60000)
}

export function formatHoursMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${h}:${String(m).padStart(2, '0')}`
}

export interface PatrolSuggestion {
  patrolType: PatrolType
  storeId: string
  businessDate: string
  shift: Shift
}

/**
 * 6:00–6:59 → 勤務前 patrol of the own store's previous 遅番 (before a 7:00 shift).
 * Otherwise → after-shift patrol of the other store's current shift.
 */
export function suggestPatrol(at: Date, homeStoreId: string, otherStoreId: string): PatrolSuggestion {
  const { hour, date } = tokyoParts(at)
  if (hour === 6) {
    return { patrolType: 'before_shift', storeId: homeStoreId, businessDate: addDays(date, -1), shift: 'late' }
  }
  const shift = detectShift(at)
  return { patrolType: 'after_shift', storeId: otherStoreId, businessDate: businessDateFor(at, shift), shift }
}
