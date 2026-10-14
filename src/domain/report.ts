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

export interface AiReport {
  id: string
  kind: 'weekly' | 'monthly'
  period_from: string
  period_to: string
  data: ReportData
  summary: string
  model: string | null
  mailed_at: string | null
  created_at: string
}

/** a ÷ b in %, or null. */
export const rate = (a: number | null | undefined, b: number | null | undefined) => (a && b ? Math.round((a / b) * 100) : null)

/** Periods a manager can make now: last / this week (Mon–Sun), last / this month (up to yesterday). */
export function reportPeriods(today: string): { key: string; kind: 'weekly' | 'monthly'; from: string; to: string }[] {
  const wd = weekdayOf(today)
  const monday = addDays(today, wd === 0 ? -6 : 1 - wd)
  const yesterday = addDays(today, -1)
  const firstThis = `${today.slice(0, 7)}-01`
  const firstPrev = (() => {
    const d = new Date(`${firstThis}T00:00:00Z`)
    d.setUTCMonth(d.getUTCMonth() - 1)
    return d.toISOString().slice(0, 10)
  })()
  const out: { key: string; kind: 'weekly' | 'monthly'; from: string; to: string }[] = [
    { key: 'lastWeek', kind: 'weekly', from: addDays(monday, -7), to: addDays(monday, -1) },
  ]
  if (yesterday >= monday) out.push({ key: 'thisWeek', kind: 'weekly', from: monday, to: yesterday })
  out.push({ key: 'lastMonth', kind: 'monthly', from: firstPrev, to: addDays(firstThis, -1) })
  if (yesterday >= firstThis) out.push({ key: 'thisMonth', kind: 'monthly', from: firstThis, to: yesterday })
  return out
}
