import type { IssueTag } from '../../domain/issues'
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
  /** マスク利用: ① 笑顔 is fixed to 1 */
  maskWorn?: boolean
  /** chosen from the roster; empty = 全員 */
  staffNames?: string[]
  goodPoints: string
  improvements: string
  remarks: string
  /** ⑥ お客様の満足度: true/false = はい/いいえ, undefined = not answered */
  customerNone?: boolean
  customerSatisfied?: boolean
  customerReason?: string
  /** 改善点の対象 (who × kind); issueNone = 特定の人ではない; issueAi = filled by AI, untouched */
  issueTags?: IssueTag[]
  issueNone?: boolean
  issueAi?: boolean
}

const KEY = 'kinryu.patrolForm'

export function loadLocalDraft(userId: string): PatrolFormState | null {
  try {
    const raw = localStorage.getItem(`${KEY}.${userId}`)
    if (!raw) return null
    const state = JSON.parse(raw) as PatrolFormState
    // drafts saved before the 4 patrol types existed
    if ((state.patrolType as string) === 'early') state.patrolType = 'before_shift'
    return state
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
