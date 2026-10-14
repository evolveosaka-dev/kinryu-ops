import type { Shift } from './types'

// 在庫・仕入: pure calculation of one store × date × shift from its rows (stock_events).

export const STOCK_UNITS = ['piece', 'bag', 'box', 'stick', 'liter'] as const
export type StockUnit = (typeof STOCK_UNITS)[number]
export const PACK_UNITS = ['tier', 'box', 'can'] as const
export type PackUnit = (typeof PACK_UNITS)[number]

export type StockKind = 'open' | 'in' | 'out' | 'close' | 'temp_start' | 'temp_end'
export type LineKind = 'open' | 'in' | 'out' | 'close'

/** Where 受入 comes from / where 払出 goes (own store is hidden). */
export const IN_PLACES = ['honten', 'sennichimae', 'midosuji', 'ebisubashi', 'warehouse', 'vendor'] as const
export const OUT_PLACES = ['midosuji', 'sennichimae', 'ebisubashi', 'other'] as const

export interface StockItem {
  id: string
  store_id: string
  code: string
  name_ja: string
  unit: StockUnit
  pack_size: number | null
  pack_unit: PackUnit | null
  standard: number | null
  sort_order: number
  active: boolean
}

export interface StockLine {
  item: string
  qty: number
}

export interface StockEvent {
  id: string
  store_id: string
  business_date: string
  shift: Shift
  kind: StockKind
  place: string | null
  note: string | null
  lines: StockLine[]
  temps: number[] | null
  author_id: string
  author_name: string
  created_at: string
  voided_at: string | null
  voided_by_name: string | null
}

export interface ItemState {
  item: StockItem
  /** 終わりの在庫 of the previous shift */
  carried: number | null
  /** 繰越 used here: a recount in this shift, else `carried` */
  opening: number | null
  recounted: boolean
  received: number
  sent: number
  /** opening + 受入 − 払出 (null while the opening is unknown) */
  now: number | null
  /** 終わりの在庫 counted in this shift */
  left: number | null
  /** 使用 = now − left */
  used: number | null
  /** 補充の目安 = standard − now, when positive */
  suggestion: number | null
}

export const round1 = (n: number) => Math.round(n * 10) / 10

/** 12.5 → "12.5", 12 → "12"; null → "—". */
export const fmtQty = (n: number | null | undefined) => (n === null || n === undefined ? '—' : String(round1(n)))

const valid = (events: StockEvent[]) => events.filter((e) => !e.voided_at)

/** The latest valid value per item of one kind (a later count replaces an earlier one). */
export function latestCounts(events: StockEvent[], kind: 'open' | 'close'): Map<string, number> {
  const out = new Map<string, number>()
  for (const e of [...valid(events)].filter((e) => e.kind === kind).sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    for (const l of e.lines) out.set(l.item, l.qty)
  }
  return out
}

function sums(events: StockEvent[], kind: 'in' | 'out'): Map<string, number> {
  const out = new Map<string, number>()
  for (const e of valid(events)) if (e.kind === kind) for (const l of e.lines) out.set(l.item, (out.get(l.item) ?? 0) + l.qty)
  return out
}

/** Used = opening + 受入 − 払出 − 残り (null when the opening or the count is unknown). */
export function usedOf(opening: number | null, received: number, sent: number, left: number | null): number | null {
  return opening === null || left === null ? null : round1(opening + received - sent - left)
}

export function stockState(items: StockItem[], current: StockEvent[], previous: StockEvent[]): ItemState[] {
  const carried = latestCounts(previous, 'close')
  const recount = latestCounts(current, 'open')
  const received = sums(current, 'in')
  const sent = sums(current, 'out')
  const left = latestCounts(current, 'close')
  return items.map((item) => {
    const opening = recount.get(item.id) ?? carried.get(item.id) ?? null
    const r = round1(received.get(item.id) ?? 0)
    const s = round1(sent.get(item.id) ?? 0)
    const now = opening === null ? null : round1(opening + r - s)
    const l = left.get(item.id) ?? null
    const gap = item.standard !== null && now !== null ? round1(item.standard - now) : 0
    return {
      item,
      carried: carried.get(item.id) ?? null,
      opening,
      recounted: recount.has(item.id),
      received: r,
      sent: s,
      now,
      left: l,
      used: usedOf(opening, r, s, l),
      suggestion: gap > 0 ? gap : null,
    }
  })
}

/** How many packs (段 / 箱 / 缶) a quantity is, rounded up: 麺 197個 → 4段. */
export function packsOf(qty: number, item: Pick<StockItem, 'pack_size'>): number | null {
  return item.pack_size ? Math.ceil(round1(qty / item.pack_size)) : null
}

/** The latest valid temperatures of the slot. */
export function latestTemps(events: StockEvent[], kind: 'temp_start' | 'temp_end'): StockEvent | null {
  return [...valid(events)].filter((e) => e.kind === kind).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
}

/** Parse a typed quantity: "", "12", "2.5", "2,5" (Japanese keyboards), full-width digits. Undefined = invalid. */
export function parseQty(text: string): number | null | undefined {
  const s = text.normalize('NFKC').replace(',', '.').trim()
  if (s === '') return null
  if (!/^\d{1,6}(\.\d)?$/.test(s)) return undefined
  return Number(s)
}

/** Temperatures may be negative (freezers). */
export function parseTemp(text: string): number | null | undefined {
  const s = text.normalize('NFKC').replace(',', '.').replace('−', '-').trim()
  if (s === '') return null
  if (!/^-?\d{1,2}(\.\d)?$/.test(s)) return undefined
  const n = Number(s)
  return n < -30 || n > 40 ? undefined : n
}
