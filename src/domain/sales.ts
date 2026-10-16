import type { Shift } from './types'

// 販売日報 (日報 page 1): pure helpers. Keep the formulas in sync with save_sales_report (SQL).

/** まかない (staff meals) is written in the code and stored, but hidden until the owner turns it on. */
export const MEALS_ENABLED = false

export const TICKETS = ['ramen', 'chashu', 'coupon'] as const
export type TicketKind = (typeof TICKETS)[number]

export const DENOMINATIONS = [10000, 5000, 2000, 1000, 500, 100, 50, 10, 5, 1] as const

export const STAFF_STATUS = ['normal', 'late', 'early_leave', 'overtime', 'absent'] as const
export type StaffStatus = (typeof STAFF_STATUS)[number]

export const CASH_TYPES = ['in', 'out', 'refund'] as const
export type CashType = (typeof CASH_TYPES)[number]

/** 水道メーター検針 times per shift: start and end (owner, 2026-10-14). */
export const WATER_TIMES: Record<Shift, string[]> = {
  early: ['07:00', '17:00'],
  middle: ['17:00', '23:00'],
  late: ['23:00', '07:00'],
}

export interface StaffRow {
  name: string
  start: string
  end: string
  status: StaffStatus
  note?: string
}
export interface CashRow {
  time: string
  type: CashType
  detail: string
  /** who received / paid (a supplier…); 'お客様' when `customer` */
  name: string
  customer?: boolean
  /** the staff member who handled the money */
  staff?: string
  amount: number
  reason?: string
}

/** 連絡事項 「なし」: nothing to report (the meter is still read). */
export const NOTES_NONE = 'なし'
export interface MealRow {
  name: string
  qty: number
}

export interface SalesReport {
  id: string
  store_id: string
  business_date: string
  shift: Shift
  tickets: Partial<Record<TicketKind, number>>
  ticket_total: number
  target_bowls: number | null
  meals: MealRow[]
  staff: StaffRow[]
  cash_book: CashRow[]
  cash_counts: Partial<Record<string, number>>
  cash_carried: number | null
  cash_carried_manual: boolean
  cash_in: number
  cash_out: number
  cash_expected: number | null
  cash_actual: number | null
  cash_diff: number | null
  cash_diff_reason: string | null
  noodle_out: number | null
  noodle_lost: number | null
  noodle_meals: number | null
  noodle_diff: number | null
  noodle_reason: string | null
  water: Record<string, string>
  notes: string | null
  original_texts: Record<string, string> | null
  source_lang: string | null
  status: 'draft' | 'submitted'
  submitted_at: string | null
  submitted_by_name: string | null
  updated_at: string
  updated_by_name: string | null
  /** the photo of the paper sheet (managers see the Drive link) */
  attachments?: { id: string; status: string; drive_url: string | null }[]
}

export interface SalesLog {
  id: number
  report_id: string
  author_id: string | null
  author_name: string
  action: 'save' | 'submit'
  sections: string[]
  at: string
}

export const ticketTotal = (t: Partial<Record<TicketKind, number>>) => TICKETS.reduce((s, k) => s + (t[k] ?? 0), 0)

export const cashTotal = (counts: Partial<Record<string, number>>) =>
  DENOMINATIONS.reduce((s, d) => s + d * (counts[String(d)] ?? 0), 0)

export function cashSummary(carried: number | null, book: CashRow[], counts: Partial<Record<string, number>>) {
  const cashIn = book.filter((r) => r.type === 'in').reduce((s, r) => s + r.amount, 0)
  const cashOut = book.filter((r) => r.type !== 'in').reduce((s, r) => s + r.amount, 0)
  const counted = Object.values(counts).some((v) => v !== undefined)
  const actual = counted ? cashTotal(counts) : null
  const expected = carried === null ? null : carried + cashIn - cashOut
  return { cashIn, cashOut, expected, actual, diff: actual === null || expected === null ? null : actual - expected }
}

/** 麺の照合 as on the paper: 食券合計 − (麺の出庫 − まかない − 廃棄). 出庫 = 使用 + 廃棄 from 在庫・仕入. */
export function noodleCheck(total: number, used: number | null, lost: number, meals: number) {
  if (used === null) return null
  const out = Math.round((used + lost) * 10) / 10
  return { out, diff: Math.round((total - (out - meals - lost)) * 10) / 10 }
}

/** "180 / 187杯 (96%)" parts. */
export const targetRate = (total: number, target: number | null | undefined) =>
  target ? Math.round((total / target) * 100) : null

export const yen = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toLocaleString('ja-JP')}円`)

/** Signed difference: 0 → "0±". */
export const signedDiff = (n: number | null | undefined, unit = '') =>
  n === null || n === undefined ? '—' : n === 0 ? `0±${unit}` : `${n > 0 ? '+' : '−'}${Math.abs(n).toLocaleString('ja-JP')}${unit}`

/** Whole yen / counts only; "" → undefined (empty), invalid → NaN. */
export function parseInteger(text: string): number | undefined {
  const s = text.normalize('NFKC').replace(/[,，円]/g, '').trim()
  if (s === '') return undefined
  return /^\d{1,8}$/.test(s) ? Number(s) : Number.NaN
}

export const minutesToTime = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
