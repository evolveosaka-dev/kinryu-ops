// 朝礼・巡回の担当: the meetings a patrol member leads and the patrols they do (duty_assignments).
import { endAt, startAt } from './schedule'
import { PATROL_TYPES, SHIFTS, type PatrolType, type Shift } from './types'

export type DutyKind = 'chorei' | 'patrol'
export type DutyTimeMode = 'at' | 'about' | 'range' | 'during'
export type DutyMethod = 'own' | 'arrival' | 'move' | 'continue' | 'extend'
export type DutyStatus = 'done' | 'now' | 'soon' | 'missed'

export interface Duty {
  id: string
  business_date: string
  shift: Shift
  store_id: string
  kind: DutyKind
  time_mode: DutyTimeMode
  start_min: number // minutes from 00:00 of business_date (may exceed 1440)
  end_min: number
  method: DutyMethod
  is_plan: boolean
  staff: string | null
  done: boolean
}

/** How long a missed duty stays on ホーム after its time window. */
export const MISSED_VISIBLE_MIN = 60
/** Duties starting within this many hours are listed on ホーム. */
export const UPCOMING_HOURS = 24

export function dutyStatus(d: Duty, now: Date): DutyStatus {
  if (d.done) return 'done'
  if (endAt(d) <= now) return 'missed'
  return startAt(d) <= now ? 'now' : 'soon'
}

/**
 * Duties to show on ホーム: those starting within the next 24 h, those in progress, and those
 * whose window ended less than an hour ago (done ✓ or still missing).
 */
export function homeDuties<T extends Duty>(duties: T[], now: Date): T[] {
  const until = now.getTime() + UPCOMING_HOURS * 3600_000
  const since = now.getTime() - MISSED_VISIBLE_MIN * 60_000
  return duties
    .filter((d) => startAt(d).getTime() < until && endAt(d).getTime() > since)
    .sort((a, b) => startAt(a).getTime() - startAt(b).getTime() || a.kind.localeCompare(b.kind))
}

/** The first open duty after the ones listed on ホーム. */
export function nextDuty<T extends Duty>(duties: T[], now: Date): T | null {
  const until = now.getTime() + UPCOMING_HOURS * 3600_000
  return (
    duties
      .filter((d) => !d.done && startAt(d).getTime() >= until)
      .sort((a, b) => startAt(a).getTime() - startAt(b).getTime())[0] ?? null
  )
}

/** Patrol type for the patrol form: after a (extended) shift = 勤務後, otherwise 勤務中. */
export const dutyPatrolType = (d: Pick<Duty, 'method'>): PatrolType => (d.method === 'extend' ? 'after_shift' : 'in_shift')

export interface SlotPreset {
  storeCode?: string
  date?: string
  shift?: Shift
  patrolType?: PatrolType
}

/** Read ?store=&date=&shift=&type= (from dutyFormLink); invalid values are ignored. */
export function readSlotPreset(params: URLSearchParams): SlotPreset {
  const date = params.get('date') ?? ''
  const shift = params.get('shift') as Shift | null
  const type = params.get('type') as PatrolType | null
  return {
    storeCode: params.get('store') || undefined,
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
    shift: shift && SHIFTS.includes(shift) ? shift : undefined,
    patrolType: type && PATROL_TYPES.includes(type) ? type : undefined,
  }
}

/** Query string that opens the 朝礼 / 巡回 form on this duty's store, date and shift. */
export function dutyFormLink(d: Duty, storeCode: string): string {
  const q = new URLSearchParams({ store: storeCode, date: d.business_date, shift: d.shift })
  if (d.kind === 'patrol') q.set('type', dutyPatrolType(d))
  return `/${d.kind}?${q.toString()}`
}
