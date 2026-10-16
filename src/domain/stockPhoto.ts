import { round1, type StockItem } from './stock'

// 在庫・仕入 from a photo of the paper 日報 (2ページ表): what the AI read (Edge Function stock-read) and the checks
// that mark cells for the person to fix before saving. Nothing here saves anything.

export type ReadField = 'carry' | 'in' | 'out' | 'used' | 'left' | 'standard' | 'temps'

export interface ReadMove {
  place: string
  place_text: string
  person: string | null
  qty: number | null
}

export interface ReadItem {
  code: string
  present: boolean
  standard_text: string | null
  carry: number | null
  ins: ReadMove[]
  outs: ReadMove[]
  used: number | null
  left: number | null
  unsure: ReadField[]
  note: string | null
}

export interface PhotoRead {
  items: ReadItem[]
  temps_start: (number | null)[]
  temps_end: (number | null)[]
  store_text: string | null
  date_text: string | null
  shift_text: string | null
  model?: string
}

/**
 * Problems found in a read, per item:
 * - sum: 繰越 + 受入 − 払出 − 差引 ≠ 次シフト繰越 (expected = what 残り would be)
 * - carry_prev: 繰越 on the paper ≠ 残り of the previous shift in the app
 * - unsure: the AI could not read a field with confidence
 * - left_missing: on the paper but 次シフト繰越 empty
 * - negative: a figure below 0
 * - unusual: more than 3 × the standard stock
 * - place_other: a 受入 / 払出 place the app does not know (needs a note)
 */
export type Flag =
  | { kind: 'sum'; expected: number }
  | { kind: 'carry_prev'; previous: number }
  | { kind: 'unsure'; fields: ReadField[]; note: string | null }
  | { kind: 'left_missing' }
  | { kind: 'negative' }
  | { kind: 'unusual'; standard: number }
  | { kind: 'place_other'; text: string }

/** red = must be fixed or confirmed; amber = please look */
export const flagLevel = (f: Flag): 'red' | 'amber' => (f.kind === 'sum' || f.kind === 'left_missing' || f.kind === 'negative' ? 'red' : 'amber')

const total = (moves: ReadMove[]) => round1(moves.reduce((s, m) => s + (m.qty ?? 0), 0))

export function checkItem(r: ReadItem, item: StockItem, previous: number | null): Flag[] {
  if (!r.present) return []
  const flags: Flag[] = []
  const inSum = total(r.ins)
  const outSum = total(r.outs)
  if (r.carry !== null && r.used !== null && r.left !== null) {
    const expected = round1(r.carry + inSum - outSum - r.used)
    if (expected !== round1(r.left)) flags.push({ kind: 'sum', expected })
  }
  if (r.left === null) flags.push({ kind: 'left_missing' })
  if (previous !== null && r.carry !== null && round1(previous) !== round1(r.carry)) flags.push({ kind: 'carry_prev', previous })
  const figures = [r.carry, r.used, r.left, ...r.ins.map((m) => m.qty), ...r.outs.map((m) => m.qty)]
  if (figures.some((n) => n !== null && n < 0)) flags.push({ kind: 'negative' })
  if (item.standard && figures.some((n) => n !== null && n > item.standard! * 3)) flags.push({ kind: 'unusual', standard: item.standard })
  for (const m of [...r.ins, ...r.outs]) if (m.place === 'other' && m.qty !== null) flags.push({ kind: 'place_other', text: m.place_text })
  const unsure = r.unsure.filter((f) => f !== 'standard' && f !== 'temps')
  if (unsure.length) flags.push({ kind: 'unsure', fields: unsure, note: r.note })
  return flags
}

/**
 * The standard written by hand next to an item (「15段」, 「46.0」, 「4」) in the item's unit; null when there is none
 * or it cannot be understood. 段 / 箱 / 缶 are multiplied by the item's pack size.
 */
export function parseStandard(text: string | null, item: Pick<StockItem, 'pack_size' | 'pack_unit'>): number | null {
  if (!text) return null
  const m = /(\d+(?:\.\d+)?)\s*(段|箱|缶)?/.exec(text.normalize('NFKC'))
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  return m[2] && item.pack_size ? round1(n * item.pack_size) : n
}

/** Items whose handwritten standard differs from 設定 → 在庫の品目 (reported to the system admin after saving). */
export function standardDiffs(read: PhotoRead, items: StockItem[]): { item: StockItem; paper: number; app: number | null; text: string }[] {
  const byCode = new Map(items.map((i) => [i.code, i]))
  const out: { item: StockItem; paper: number; app: number | null; text: string }[] = []
  for (const r of read.items) {
    const item = byCode.get(r.code)
    if (!item || !r.present) continue
    const paper = parseStandard(r.standard_text, item)
    if (paper === null || paper === item.standard) continue
    out.push({ item, paper, app: item.standard, text: r.standard_text! })
  }
  return out
}

/** Temperatures: one per fridge, −30…40 °C; anything else is shown for fixing. */
export function tempsOk(temps: (number | null)[], fridges: number): boolean {
  return temps.length === fridges && temps.every((t) => t !== null && t >= -30 && t <= 40)
}
