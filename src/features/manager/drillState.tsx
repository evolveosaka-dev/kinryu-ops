import { useState, type ReactNode } from 'react'
import { score25, type ChoreiSlotView } from '../../domain/stats'
import type { AdminChorei, AdminPatrol } from './data'

// 管理: helpers for the lists behind each figure (components in drill.tsx).

export type ChoreiSlot = ChoreiSlotView<AdminChorei>

export const keyOf = (s: { date: string; storeId: string; shift: string }) => `${s.date}|${s.storeId}|${s.shift}`

/** A recorded 朝礼 as a slot, for lists of records (誘導者, 参加者, できなかった手順). */
export const recordSlot = (r: AdminChorei): ChoreiSlot => ({ date: r.business_date, storeId: r.store_id, shift: r.shift, state: 'done', record: r })

type T = (key: string, opts?: Record<string, unknown>) => string

/** 平均点 = sum of the scores on 25 ÷ number of patrols. */
export function avgHow(t: T, ps: AdminPatrol[]): string {
  const xs = ps.map(score25)
  const sum = Math.round(xs.reduce((a, b) => a + b, 0) * 10) / 10
  return t('drill.avgScore', { sum, n: xs.length, avg: xs.length ? Math.round((sum / xs.length) * 10) / 10 : '—' })
}

/** Extra line: the score on 25 (shown when the patrol had no ⑤). */
export const score25Line = (t: T) => (p: AdminPatrol) =>
  p.max_total === 20 && p.total !== null ? <span className="text-xs font-bold text-sky-800">{t('detail.score25', { score: Math.round(score25(p) * 10) / 10 })}</span> : null

/** What a page has open: a list of 朝礼 slots or of 巡回 (one at a time). */
export type Drill =
  | { kind: 'chorei'; title: string; how?: string; slots: ChoreiSlot[]; extra?: (s: ChoreiSlot) => ReactNode }
  | { kind: 'patrol'; title: string; how?: string; patrols: AdminPatrol[]; extra?: (p: AdminPatrol) => ReactNode }

/** Which list a page has open (see DrillSheet). */
export function useDrill() {
  const [current, setCurrent] = useState<Drill | null>(null)
  return {
    open: (f: () => Drill) => setCurrent(f()),
    close: () => setCurrent(null),
    current,
  }
}
