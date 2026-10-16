// 販売日報 from a photo of the paper 日報 (1ページ表): what the AI read (Edge Function sales-read) → the form's
// starting values + the points the person must look at. Nothing here saves anything.
import { DENOMINATIONS, minutesToTime, WATER_TIMES, type CashRow, type SalesReport, type StaffRow, type TicketKind } from './sales'
import type { Shift } from './types'

export interface SalesPhotoRead {
  store: 'sennichimae' | 'midosuji' | 'unknown'
  date: string | null
  shift: Shift | 'unknown'
  tickets: Record<TicketKind | 'total', number | null>
  calc_time: string | null
  calculator: string | null
  calc_text: string | null
  noodle_diff: number | null
  meals: { name: string | null; qty: number | null }[]
  other_out: { name: string | null; time: string | null; qty: number | null; detail: string | null }[]
  staff: { written: string; roster_name: string | null; start: string | null; end: string | null }[]
  cash_book: { time: string | null; detail: string | null; name: string | null; amount: number | null; type: 'in' | 'out' | 'refund' }[]
  cash_counts: Record<string, number | null>
  cash_actual_total: number | null
  cash_carried: number | null
  cash_in: number | null
  cash_out: number | null
  cash_expected: number | null
  cash_diff: number | null
  cash_calculator: string | null
  water: { hour: string; value: string }[]
  notes: string | null
  unsure: string[]
  note: string | null
  model?: string
}

/** A point to look at: `red` = the photo does not fit the chosen slot. */
export type SalesFlag =
  | { kind: 'slot'; store: string | null; date: string | null; shift: string | null }
  | { kind: 'ticketTotal'; paper: number; sum: number }
  | { kind: 'carried'; paper: number; app: number }
  | { kind: 'countsMissing'; total: number }
  | { kind: 'countsTotal'; paper: number; sum: number }
  | { kind: 'staffTime'; name: string; paper: string; planned: string }
  | { kind: 'staffNotOnPaper'; name: string; planned: string }
  | { kind: 'staffUnknown'; written: string }
  | { kind: 'otherOut'; text: string }
  | { kind: 'waterHour'; hour: string; value: string }

export interface Scheduled {
  roster_name: string
  start_min: number
  end_min: number
}

/** "7:00" / "07:00" / "7：00" → "07:00"; anything else → null. */
export function normTime(s: string | null | undefined): string | null {
  const m = (s ?? '').normalize('NFKC').match(/^\s*(\d{1,2})\s*:\s*(\d{2})\s*$/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h < 30 && min < 60 ? `${String(h % 24).padStart(2, '0')}:${String(min).padStart(2, '0')}` : null
}

/**
 * The starting values of the form from the photo, on top of what is already saved for the slot (kept where the paper
 * is empty). `prevActual` = the previous report's 実際有高 (the app's 繰越); without it the paper's 繰越 is used.
 */
export function photoToReport(read: SalesPhotoRead, base: SalesReport | null, slot: { shift: Shift }, scheduled: Scheduled[], prevActual: number | null) {
  const flags: SalesFlag[] = []

  const tickets = { ...(base?.tickets ?? {}) }
  for (const k of ['ramen', 'chashu', 'coupon'] as const) if (read.tickets[k] !== null) tickets[k] = read.tickets[k]!
  const sum = (tickets.ramen ?? 0) + (tickets.chashu ?? 0) + (tickets.coupon ?? 0)
  if (read.tickets.total !== null && read.tickets.total !== sum) flags.push({ kind: 'ticketTotal', paper: read.tickets.total, sum })

  // staff: the paper's people and times; the roster name when the AI matched one
  const staff: StaffRow[] = []
  for (const p of read.staff) {
    const name = p.roster_name ?? p.written
    if (!p.roster_name) flags.push({ kind: 'staffUnknown', written: p.written })
    const plan = scheduled.find((s) => s.roster_name === name)
    const start = normTime(p.start) ?? (plan ? minutesToTime(plan.start_min) : WATER_TIMES[slot.shift][0]!)
    const end = normTime(p.end) ?? (plan ? minutesToTime(plan.end_min) : WATER_TIMES[slot.shift][1]!)
    if (plan && (start !== minutesToTime(plan.start_min) || end !== minutesToTime(plan.end_min)))
      flags.push({ kind: 'staffTime', name, paper: `${start}–${end}`, planned: `${minutesToTime(plan.start_min)}–${minutesToTime(plan.end_min)}` })
    staff.push({ name, start, end, status: 'normal' })
  }
  for (const s of scheduled)
    if (!staff.some((x) => x.name === s.roster_name)) {
      flags.push({ kind: 'staffNotOnPaper', name: s.roster_name, planned: `${minutesToTime(s.start_min)}–${minutesToTime(s.end_min)}` })
      staff.push({ name: s.roster_name, start: minutesToTime(s.start_min), end: minutesToTime(s.end_min), status: 'normal' })
    }

  const cashBook: CashRow[] = read.cash_book
    .filter((r) => r.amount !== null && r.amount > 0)
    .map((r) => {
      const customer = r.type === 'refund' || r.name === 'お客様'
      return { time: normTime(r.time) ?? '', type: r.type, detail: r.detail ?? '', name: customer ? 'お客様' : (r.name ?? ''), customer, amount: r.amount!, reason: r.type === 'refund' ? (r.detail ?? '') : undefined }
    })

  const counts: Partial<Record<string, number>> = {}
  for (const d of DENOMINATIONS) {
    const v = read.cash_counts[String(d)]
    if (v !== null && v !== undefined) counts[String(d)] = v
  }
  const counted = Object.keys(counts).length > 0
  const countSum = DENOMINATIONS.reduce((s, d) => s + d * (counts[String(d)] ?? 0), 0)
  if (!counted && read.cash_actual_total !== null) flags.push({ kind: 'countsMissing', total: read.cash_actual_total })
  if (counted && read.cash_actual_total !== null && read.cash_actual_total !== countSum) flags.push({ kind: 'countsTotal', paper: read.cash_actual_total, sum: countSum })

  if (prevActual !== null && read.cash_carried !== null && read.cash_carried !== prevActual) flags.push({ kind: 'carried', paper: read.cash_carried, app: prevActual })

  const water = { ...(base?.water ?? {}) }
  for (const w of read.water) {
    const key = `${w.hour.padStart(2, '0')}:00`
    if (WATER_TIMES[slot.shift].includes(key)) water[key] = w.value.normalize('NFKC').replace(/\D/g, '')
    else flags.push({ kind: 'waterHour', hour: w.hour, value: w.value })
  }

  for (const o of read.other_out.filter((x) => x.qty !== null))
    flags.push({ kind: 'otherOut', text: [o.time, o.name, o.qty !== null ? `${o.qty}` : null, o.detail].filter(Boolean).join(' ') })

  const report = {
    ...(base ?? {}),
    tickets,
    staff: staff.length ? staff : (base?.staff ?? []),
    cash_book: cashBook.length ? cashBook : (base?.cash_book ?? []),
    cash_counts: counted ? counts : (base?.cash_counts ?? {}),
    cash_carried: prevActual === null ? (read.cash_carried ?? base?.cash_carried ?? null) : (base?.cash_carried ?? null),
    cash_carried_manual: prevActual === null && read.cash_carried !== null ? true : (base?.cash_carried_manual ?? false),
    water,
    notes: read.notes?.trim() ? read.notes.trim() : (base?.notes ?? null),
  } as SalesReport
  return { report, flags }
}

/** The photo is of another store / day / shift than the one chosen. */
export function slotMismatch(read: SalesPhotoRead, slot: { storeCode: string; date: string; shift: Shift }): SalesFlag | null {
  const store = read.store !== 'unknown' && read.store !== slot.storeCode ? read.store : null
  const date = read.date && read.date !== slot.date ? read.date : null
  const shift = read.shift !== 'unknown' && read.shift !== slot.shift ? read.shift : null
  return store || date || shift ? { kind: 'slot', store, date, shift } : null
}
