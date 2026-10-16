// クレーム・事故 Workflow V2 (migration 20261017000001). The database decides (incident_act); this mirrors its
// transition table for the buttons, and computes the durations from the history so every figure can be traced.

export const WF_STATES = ['reported', 'checking', 'in_progress', 'on_hold', 'repaired', 'done', 'reopened', 'cancelled'] as const
export type WfState = (typeof WF_STATES)[number]
export const OPEN_STATES: readonly WfState[] = ['reported', 'checking', 'in_progress', 'on_hold', 'repaired', 'reopened']
/** the progress bar: the normal path */
export const WF_PATH: readonly WfState[] = ['reported', 'checking', 'in_progress', 'repaired', 'done']

export const WF_STYLE: Record<WfState, string> = {
  reported: 'bg-red-100 text-red-900',
  checking: 'bg-amber-100 text-amber-900',
  in_progress: 'bg-blue-100 text-blue-900',
  on_hold: 'bg-violet-100 text-violet-900',
  repaired: 'bg-teal-100 text-teal-900',
  done: 'bg-green-100 text-green-900',
  reopened: 'bg-orange-100 text-orange-900',
  cancelled: 'bg-slate-200 text-slate-700',
}

export const PRIORITIES = ['normal', 'high', 'urgent'] as const
export type Priority = (typeof PRIORITIES)[number]
export const PRIORITY_STYLE: Record<Priority, string> = { normal: 'bg-slate-100 text-slate-700', high: 'bg-amber-100 text-amber-900', urgent: 'bg-red-600 text-white' }
/** default 対応期限 after the report (incident_default_due) */
export const DUE_HOURS: Record<Priority, number> = { urgent: 24, high: 72, normal: 168 }

export const EQUIPMENT_CATEGORIES = ['kitchen', 'ticket', 'aircon', 'fridge', 'water', 'electric', 'other'] as const
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number]

export type WfAction = 'acknowledge' | 'start' | 'hold' | 'resume' | 'repaired' | 'confirm_ok' | 'confirm_ng' | 'reopen' | 'cancel'

/** action → (from states, to state, managers only, a reason is required) — same table as incident_act */
export const WF_ACTIONS: Record<WfAction, { from: readonly WfState[]; to: WfState; manager: boolean; reason: boolean }> = {
  acknowledge: { from: ['reported'], to: 'checking', manager: true, reason: false },
  start: { from: ['reported', 'checking', 'on_hold', 'reopened'], to: 'in_progress', manager: true, reason: false },
  hold: { from: ['checking', 'in_progress', 'reopened'], to: 'on_hold', manager: true, reason: true },
  resume: { from: ['on_hold'], to: 'in_progress', manager: true, reason: false },
  repaired: { from: ['in_progress', 'on_hold', 'reopened'], to: 'repaired', manager: false, reason: false },
  confirm_ok: { from: ['repaired'], to: 'done', manager: true, reason: false },
  confirm_ng: { from: ['repaired'], to: 'reopened', manager: true, reason: true },
  reopen: { from: ['done'], to: 'reopened', manager: true, reason: true },
  cancel: { from: ['reported', 'checking'], to: 'cancelled', manager: true, reason: true },
}

export function actionsFor(state: WfState, manager: boolean): WfAction[] {
  return (Object.keys(WF_ACTIONS) as WfAction[]).filter((a) => WF_ACTIONS[a].from.includes(state) && (manager || !WF_ACTIONS[a].manager))
}

export interface IncidentEvent {
  id: number
  incident_id: string
  at: string
  actor_name: string
  kind: 'created' | 'state' | 'assign' | 'comment' | 'attachment' | 'cost' | 'field'
  action: string | null
  from_state: WfState | null
  to_state: WfState | null
  body: string | null
  original_body: string | null
  data: Record<string, unknown>
}

export interface WfTimes {
  occurred_at: string
  occurred_known: boolean
  discovered_at: string | null
  created_at: string
  acknowledged_at: string | null
  repaired_at: string | null
  closed_at: string | null
}

export interface Span {
  from: string
  to: string | null
}
export interface Durations {
  /** 報告所要時間: discovered → reported */
  report: number | null
  /** 初動対応時間: reported → taken by a manager */
  firstResponse: number | null
  /** 修理所要時間: broken (or discovered) → the last 修理完了 (a repair that failed the check does not count) */
  repair: number | null
  /** 完了所要時間: broken → confirmed done */
  complete: number | null
  /** 保留時間: the time in 保留・外部待ち */
  hold: number
  holdSpans: Span[]
  /** ダウンタイム: not working = broken → repaired, and every 再対応 → the next 修理完了 */
  downtime: number
  downSpans: Span[]
  /** 発生日時 unknown: 発見日時 is the start */
  estimated: boolean
}

const min = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000))
const spanMin = (s: Span[], now: string) => s.reduce((a, x) => a + min(x.from, x.to ?? now), 0)

/** Minutes, from the record and its history (`now` closes the spans still open). */
export function durations(i: WfTimes, events: IncidentEvent[], now = new Date().toISOString()): Durations {
  const start = i.occurred_known ? i.occurred_at : (i.discovered_at ?? i.occurred_at)
  const states = events.filter((e) => e.kind === 'state' || e.kind === 'created' || e.kind === 'assign').sort((a, b) => a.id - b.id)
  const holdSpans: Span[] = []
  const downSpans: Span[] = [{ from: start, to: null }]
  let lastRepair: string | null = null
  for (const e of states) {
    if (e.to_state === 'on_hold' && e.from_state !== 'on_hold') holdSpans.push({ from: e.at, to: null })
    if (e.from_state === 'on_hold' && e.to_state !== 'on_hold' && holdSpans.length && !holdSpans.at(-1)!.to) holdSpans.at(-1)!.to = e.at
    if (e.to_state === 'repaired') {
      lastRepair = e.at
      if (!downSpans.at(-1)!.to) downSpans.at(-1)!.to = e.at
    }
    if (e.to_state === 'reopened') downSpans.push({ from: e.at, to: null })
    if (e.to_state === 'cancelled' && !downSpans.at(-1)!.to) downSpans.at(-1)!.to = e.at
  }
  return {
    report: i.discovered_at ? min(i.discovered_at, i.created_at) : null,
    firstResponse: i.acknowledged_at ? min(i.created_at, i.acknowledged_at) : null,
    repair: lastRepair ? min(start, lastRepair) : null,
    complete: i.closed_at ? min(start, i.closed_at) : null,
    hold: spanMin(holdSpans, now),
    holdSpans,
    downtime: spanMin(downSpans, now),
    downSpans,
    estimated: !i.occurred_known,
  }
}

/** 2 h 05 m / 3日 4時間 — short, for cards and tables */
export function fmtMinutes(m: number | null): string {
  if (m === null) return '—'
  if (m < 60) return `${m}分`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}時間${m % 60 ? `${m % 60}分` : ''}`
  return `${Math.floor(h / 24)}日${h % 24 ? `${h % 24}時間` : ''}`
}

export interface WfRow extends WfTimes {
  id: string
  store_id: string
  wf_state: WfState
  priority: Priority
  due_at: string | null
  equipment_id: string | null
  equipment_name: string | null
}

export const isOverdue = (r: Pick<WfRow, 'wf_state' | 'due_at'>, now = new Date()) =>
  Boolean(r.due_at && OPEN_STATES.includes(r.wf_state) && r.wf_state !== 'repaired' && new Date(r.due_at) < now)

/** 再発: the same equipment broke again within 90 days of an earlier report (cancelled ones left out). */
export function recurrences<T extends WfRow>(rows: T[]): T[] {
  const live = rows.filter((r) => r.wf_state !== 'cancelled')
  return live.filter((r) => {
    const key = r.equipment_id ?? (r.equipment_name ? `${r.store_id}|${r.equipment_name}` : null)
    if (!key) return false
    return live.some((o) => {
      const k = o.equipment_id ?? (o.equipment_name ? `${o.store_id}|${o.equipment_name}` : null)
      const gap = new Date(r.created_at).getTime() - new Date(o.created_at).getTime()
      return o.id !== r.id && k === key && gap > 0 && gap <= 90 * 86_400_000
    })
  })
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, x) => a + x, 0) / xs.length) : null)

/** The dashboard figures, each with the rows behind it. */
export function wfMetrics<T extends WfRow>(rows: T[], now = new Date()) {
  const live = rows.filter((r) => r.wf_state !== 'cancelled')
  const open = live.filter((r) => OPEN_STATES.includes(r.wf_state))
  const overdue = live.filter((r) => isOverdue(r, now))
  const acked = live.filter((r) => r.acknowledged_at)
  const repaired = live.filter((r) => r.repaired_at)
  const start = (r: T) => (r.occurred_known ? r.occurred_at : (r.discovered_at ?? r.occurred_at))
  const byStore = new Map<string, T[]>()
  for (const r of live) byStore.set(r.store_id, [...(byStore.get(r.store_id) ?? []), r])
  return {
    total: live,
    open,
    overdue,
    firstResponse: { avg: avg(acked.map((r) => min(r.created_at, r.acknowledged_at!))), rows: acked },
    repair: { avg: avg(repaired.map((r) => min(start(r), r.repaired_at!))), rows: repaired },
    recurrences: recurrences(live),
    byStore,
  }
}
