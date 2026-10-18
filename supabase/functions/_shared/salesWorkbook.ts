// The 販売杯数 workbook 「金龍売り上げ杯数」, sheet ★拝数入力シート, for the Edge Function shift-sync:
// row 2 = headers (D 日, ⑤早番 ⑤中番 ⑤遅番 ①早番 ①中番 ①遅番 = G–L), from row 3 one row per day (D = date serial).
// bowls = ラーメン + チャーシューメン as the workbook defines 販売杯数. Only typed numbers are read (not text or errors).
// No imports from src/ so Deno can load it; src/domain/salesWorkbook.test.ts checks it.

export const SALES_SHEET = '★拝数入力シート'
const STORE_OF: Record<string, string> = { '⑤': 'sennichimae', '①': 'midosuji' }
const SHIFT_OF: Record<string, 'early' | 'middle' | 'late'> = { 早番: 'early', 中番: 'middle', 遅番: 'late' }

export interface SalesRow {
  date: string
  store: string
  shift: 'early' | 'middle' | 'late'
  bowls: number
}

const decodeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const serialToDate = (v: string) => new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 86400000).toISOString().slice(0, 10)

/** The sheet XML + shared strings → one row per filled cell; `from` / `to` = dates kept (inclusive). */
export function parseSalesSheet(xml: string, strings: string[], from: string, to: string): { rows: SalesRow[]; columns: number } {
  const rows: Record<string, Record<string, { v: string; text: boolean }>> = {}
  for (const [, r, body] of xml.matchAll(/<row [^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    for (const [, col, attrs, inner] of body!.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = /<v>([^<]*)<\/v>/.exec(inner ?? '')?.[1]
      if (v === undefined) continue
      const type = /t="([^"]+)"/.exec(attrs!)?.[1]
      ;(rows[r!] ??= {})[col!] = type === 's' ? { v: strings[Number(v)] ?? '', text: true } : { v: decodeXml(v), text: type !== undefined && type !== 'n' }
    }
  }
  // the first ⑤早番 … ①遅番 headers of row 2 (the same labels repeat later for the averages)
  const cols = new Map<string, { store: string; shift: SalesRow['shift'] }>()
  const seen = new Set<string>()
  for (const [col, cell] of Object.entries(rows['2'] ?? {}).sort(([a], [b]) => a.length - b.length || a.localeCompare(b))) {
    const m = /^\s*([①⑤])\s*(早番|中番|遅番)\s*$/.exec(cell.v)
    if (!m || seen.has(cell.v.trim())) continue
    seen.add(cell.v.trim())
    cols.set(col, { store: STORE_OF[m[1]!]!, shift: SHIFT_OF[m[2]!]! })
  }
  const out: SalesRow[] = []
  for (const [r, cells] of Object.entries(rows)) {
    const d = cells.D
    if (Number(r) < 3 || !d || d.text || !/^\d{5}(\.\d+)?$/.test(d.v)) continue
    const date = serialToDate(d.v)
    if (date < from || date > to) continue
    for (const [col, where] of cols) {
      const c = cells[col]
      if (!c || c.text || c.v.trim() === '') continue
      const n = Number(c.v)
      if (Number.isInteger(n) && n >= 0 && n <= 100000) out.push({ date, ...where, bowls: n })
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.store.localeCompare(b.store) || a.shift.localeCompare(b.shift))
  return { rows: out, columns: cols.size }
}
