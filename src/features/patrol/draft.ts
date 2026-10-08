import type { PatrolItem, Score } from '../../domain/patrol'
import type { PatrolType, Shift } from '../../domain/types'

/** Everything typed into the patrol form, kept in localStorage so a reload or lost signal loses nothing. */
export interface PatrolFormState {
  draftId: string | null
  patrolType: PatrolType
  storeId: string
  businessDate: string
  shift: Shift
  startedAt: string | null
  endedAt: string | null
  scores: Partial<Record<PatrolItem, Score | null>>
  staffOnShift: string
  /** chosen from the roster; empty = 全員 */
  staffNames?: string[]
  goodPoints: string
  improvements: string
  remarks: string
}

const KEY = 'kinryu.patrolForm'

export function loadLocalDraft(userId: string): PatrolFormState | null {
  try {
    const raw = localStorage.getItem(`${KEY}.${userId}`)
    return raw ? (JSON.parse(raw) as PatrolFormState) : null
  } catch {
    return null
  }
}

export function saveLocalDraft(userId: string, state: PatrolFormState | null): void {
  try {
    if (state) localStorage.setItem(`${KEY}.${userId}`, JSON.stringify(state))
    else localStorage.removeItem(`${KEY}.${userId}`)
  } catch {
    // storage unavailable (private mode): the form still works, just without restore
  }
}
