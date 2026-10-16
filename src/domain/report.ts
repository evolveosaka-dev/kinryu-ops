// AIレポート (ai_reports.data = report_data() in SQL, migration 20261015000008): the key numbers shown above the AI text.
import { addDays, weekdayOf } from './time'

export interface ReportData {
  from: string
  to: string
  sales: {
    days: number
    bowls: number
    target: number | null
    bowls_with_target: number | null
    last_year: number | null
    bowls_with_last_year: number | null
    by_slot: { store: string; shift: string; bowls: number; target: number | null; bowls_with_target: number | null; last_year: number | null; bowls_with_last_year: number | null }[]
    by_day: { date: string; bowls: number; target: number | null }[]
  }
  patrol: { count: number; avg25: number | null; coaching: number; items: Record<string, number | null>; by_slot: { store: string; shift: string; count: number; avg25: number }[] }
  chorei: { due: number; done: number; missing_by_reason: Record<string, number> }
  attendance: { absence: number; absence_same_day: number; late: number; early_leave: number; told_after_start: number; covered: number; not_reported: number; visa_over_people: number }
  stock: { loss_events: number; loss_items: { store: string; item: string; qty: number }[]; sales_reports_with_noodle_diff: number; sales_reports_with_cash_diff: number }
  incidents: { by_kind: Record<string, number>; open_now: number }
}

// AI日報 (ai_reports.data = daily_report_data() in SQL, migration 20261017000005): one business day, names included.
export interface DailyComment {
  by: string
  body: string
}
export interface DailySlot {
  store: string
  shift: 'early' | 'middle' | 'late'
  bowls: number | null
  target: number | null
  chorei: {
    leader: string | null
    participants: string[]
    caution: string | null
    stock: string | null
    skip_reason: string | null
    entered_by_manager: boolean
    manager_note: string | null
    notes: string[]
    comments: DailyComment[]
  } | null
  chorei_missed: { kind: 'missed' | 'done'; reason: string | null; note: string | null } | null
  patrols: {
    patroller: string | null
    type: string
    time: string | null
    staff: string[] | null
    score: number | null
    max: number | null
    judgement: 'good' | 'improve' | 'coaching' | null
    good_points: string
    improvements: string
    remarks: string | null
    customer: { satisfied: boolean | null; reason: string | null } | null
    comments: DailyComment[]
  }[]
  attendance: { kind: 'absence' | 'late' | 'early_leave'; name: string; reason: string; status: string; late_min: number | null; told_after_start: boolean; cover: string | null }[]
  incidents: { no: number; kind: string; priority: string; state: string; time: string | null; description: string; action: string | null; reporter: string }[]
}
export interface DailyData {
  date: string
  slots: DailySlot[]
  open_cases: { no: number; kind: string; store: string; date: string; shift: string; priority: string; state: string; days_open: number; overdue: boolean; assignee: string | null; description: string }[]
}

export type AiReport = {
  id: string
  period_from: string
  period_to: string
  summary: string
  model: string | null
  mailed_at: string | null
  created_at: string
} & ({ kind: 'weekly' | 'monthly'; data: ReportData } | { kind: 'daily'; data: DailyData })

/** a ÷ b in %, or null. */
export const rate = (a: number | null | undefined, b: number | null | undefined) => (a && b ? Math.round((a / b) * 100) : null)

/** Periods a manager can make now: yesterday (日報), last / this week (Mon–Sun), last / this month (up to yesterday). */
export function reportPeriods(today: string): { key: string; kind: AiReport['kind']; from: string; to: string }[] {
  const wd = weekdayOf(today)
  const monday = addDays(today, wd === 0 ? -6 : 1 - wd)
  const yesterday = addDays(today, -1)
  const firstThis = `${today.slice(0, 7)}-01`
  const firstPrev = (() => {
    const d = new Date(`${firstThis}T00:00:00Z`)
    d.setUTCMonth(d.getUTCMonth() - 1)
    return d.toISOString().slice(0, 10)
  })()
  const out: { key: string; kind: AiReport['kind']; from: string; to: string }[] = [
    { key: 'yesterday', kind: 'daily', from: yesterday, to: yesterday },
    { key: 'lastWeek', kind: 'weekly', from: addDays(monday, -7), to: addDays(monday, -1) },
  ]
  if (yesterday >= monday) out.push({ key: 'thisWeek', kind: 'weekly', from: monday, to: yesterday })
  out.push({ key: 'lastMonth', kind: 'monthly', from: firstPrev, to: addDays(firstThis, -1) })
  if (yesterday >= firstThis) out.push({ key: 'thisMonth', kind: 'monthly', from: firstThis, to: yesterday })
  return out
}
