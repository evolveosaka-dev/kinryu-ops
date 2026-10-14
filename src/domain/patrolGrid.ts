import type { Shift } from './types'

// 管理 → 巡回: the last 7 days × store × shift, compared with the patrol duties (duty_assignments).

export interface GridPatrol {
  id: string
  store_id: string
  business_date: string
  shift: Shift
  status: string
  total: number | null
  max_total: number | null
  judgement: string | null
}

export interface GridDuty {
  business_date: string
  shift: Shift
  store_id: string | null
  roster_name: string
}

export type PatrolSlotState = 'done' | 'progress' | 'missed' | 'planned' | 'none'

export interface PatrolSlot<P extends GridPatrol = GridPatrol> {
  date: string
  storeId: string
  shift: Shift
  state: PatrolSlotState
  patrols: P[]
  /** patrol members who had this patrol as a duty */
  dutyNames: string[]
}

/** End of a shift (Tokyo) + 1 hour to send the record: 早番 18:00, 中番 24:00, 遅番 8:00 the next day. */
const END_HOURS: Record<Shift, number> = { early: 18, middle: 24, late: 32 }
export function slotClosed(date: string, shift: Shift, now: Date): boolean {
  return now.getTime() >= new Date(`${date}T00:00:00+09:00`).getTime() + END_HOURS[shift] * 3600_000
}

export function patrolSlots<P extends GridPatrol>(dates: string[], storeIds: string[], patrols: P[], duties: GridDuty[], now: Date): PatrolSlot<P>[] {
  const out: PatrolSlot<P>[] = []
  for (const date of dates)
    for (const storeId of storeIds)
      for (const shift of ['early', 'middle', 'late'] as Shift[]) {
        const here = patrols.filter((p) => p.business_date === date && p.store_id === storeId && p.shift === shift && p.status !== 'void')
        const valid = here.filter((p) => p.status === 'valid')
        const dutyNames = duties.filter((d) => d.business_date === date && d.store_id === storeId && d.shift === shift).map((d) => d.roster_name)
        const state: PatrolSlotState = valid.length
          ? 'done'
          : here.length
            ? 'progress'
            : dutyNames.length
              ? slotClosed(date, shift, now)
                ? 'missed'
                : 'planned'
              : 'none'
        out.push({ date, storeId, shift, state, patrols: valid.length ? valid : here, dutyNames })
      }
  return out
}

/** 実施 / 担当のある巡回 (closed slots only) and patrols done without a duty. */
export function patrolCompletion(slots: PatrolSlot[]) {
  const planned = slots.filter((s) => s.dutyNames.length > 0 && (s.state === 'done' || s.state === 'missed'))
  const done = planned.filter((s) => s.state === 'done').length
  return {
    done,
    due: planned.length,
    rate: planned.length ? Math.round((done / planned.length) * 100) : null,
    missed: slots.filter((s) => s.state === 'missed').length,
    extra: slots.filter((s) => s.state === 'done' && s.dutyNames.length === 0).length,
  }
}
