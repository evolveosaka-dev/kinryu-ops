// The 早番 / 中番 / 遅番 sheets of the monthly shift workbook, for the Edge Function shift-sync.
// A copy of src/domain/shiftImport.ts + parseCell (src/domain/schedule.ts) without imports, so Deno can load it;
// src/domain/shiftWorkbook.test.ts checks that both read a workbook the same way.

export type Shift = 'early' | 'middle' | 'late'
export const SHIFT_SHEETS: Record<Shift, string> = { early: '早番', middle: '中番', late: '遅番' }

export interface ImportedRow {
  business_date: string
  shift: Shift
  roster_name: string
  store_mark: string
  start_min: number
  end_min: number
  raw: string
}

export function parseCell(raw: string): { store_mark: string; start_min: number; end_min: number } | null {
  const m = /^\s*([①②③④⑤])\s*(\d{1,2}(?:\.\d+)?)\s*-\s*(\d{1,2}(?:\.\d+)?)\s*$/.exec(raw)
  if (!m) return null
  const start = Math.round(Number(m[2]) * 60)
  let end = Math.round(Number(m[3]) * 60)
  if (end <= start) end += 24 * 60
  if (start > 24 * 60 || end - start > 24 * 60) return null
  return { store_mark: m[1]!, start_min: start, end_min: end }
}

const decodeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

export function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1]!.replace(/<rPh[\s\S]*?<\/rPh>/g, '').matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((x) => decodeXml(x[1]!)).join(''),
  )
}

export function sheetPaths(workbookXml: string, relsXml: string): Record<string, string> {
  const rels = new Map([...relsXml.matchAll(/<Relationship [^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1], /Target="([^"]+)"/.exec(m[0])?.[1]]))
  const out: Record<string, string> = {}
  for (const m of workbookXml.matchAll(/<sheet [^>]*>/g)) {
    const name = /name="([^"]+)"/.exec(m[0])?.[1]
    const rid = /r:id="([^"]+)"/.exec(m[0])?.[1]
    const target = rels.get(rid)
    if (name && target) out[decodeXml(name)] = `xl/${target.replace(/^\/?xl\//, '')}`
  }
  return out
}

const isSerial = (v: string | undefined) => Boolean(v && /^\d{5}(\.\d+)?$/.test(v))
const serialToDate = (v: string) => new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 86400000).toISOString().slice(0, 10)

export function parseShiftSheet(xml: string, strings: string[], shift: Shift): ImportedRow[] {
  const rows: Record<string, Record<string, string>> = {}
  for (const [, r, body] of xml.matchAll(/<row [^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    for (const [, col, attrs, inner] of body!.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = /<v>([^<]*)<\/v>/.exec(inner ?? '')?.[1]
      if (v !== undefined) (rows[r!] ??= {})[col!] = /t="s"/.test(attrs!) ? (strings[Number(v)] ?? '') : decodeXml(v)
    }
  }
  const header = rows['4'] ?? {}
  const out: ImportedRow[] = []
  for (const [r, cells] of Object.entries(rows)) {
    if (Number(r) < 5 || !isSerial(cells.B)) continue
    const date = serialToDate(cells.B!)
    for (const [col, value] of Object.entries(cells)) {
      const name = header[col]?.trim()
      if (!name || col === 'B') continue
      const parsed = parseCell(value)
      if (parsed) out.push({ business_date: date, shift, roster_name: name, ...parsed, raw: value.trim() })
    }
  }
  return out
}

/** Unzipped workbook files → the rows of the month most of them belong to. */
export function parseWorkbook(files: { sharedStrings: string; sheets: Record<string, string> }): { month: string | null; rows: ImportedRow[]; missingSheets: string[] } {
  const strings = parseSharedStrings(files.sharedStrings)
  const rows: ImportedRow[] = []
  const missingSheets: string[] = []
  for (const [shift, name] of Object.entries(SHIFT_SHEETS) as [Shift, string][]) {
    const xml = files.sheets[name]
    if (!xml) missingSheets.push(name)
    else rows.push(...parseShiftSheet(xml, strings, shift))
  }
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.business_date.slice(0, 7), (counts.get(r.business_date.slice(0, 7)) ?? 0) + 1)
  const month = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  return { month: month ? `${month}-01` : null, rows: month ? rows.filter((r) => r.business_date.startsWith(month)) : rows, missingSheets }
}
