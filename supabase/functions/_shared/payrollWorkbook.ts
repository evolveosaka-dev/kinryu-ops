// 給与計算の元データ (System Admin only): the sheets of the monthly shift workbook that the payroll workbook
// (給与計算 .xlsx) reads through its external links — 早番 / 中番 / 遅番 (shift cells + 研修 columns), 早番勤怠 /
// 中番勤怠 / 遅番勤怠 (adjustments), 勤務時間リスト (hours per shift cell), 当日リーダー手当, 研修手当.
// Pure, no imports outside this folder: used by the Edge Function shift-sync and by src/domain/payroll tests.
// Values are the cached results Excel saved (formula cells included).

import { parseSharedStrings } from './shiftWorkbook.ts'

export type PayShift = 'early' | 'middle' | 'late'
export const PAY_SHEETS: Record<PayShift, { shift: string; kintai: string }> = {
  early: { shift: '早番', kintai: '早番勤怠' },
  middle: { shift: '中番', kintai: '中番勤怠' },
  late: { shift: '遅番', kintai: '遅番勤怠' },
}
export const EXTRA_SHEETS = ['勤務時間リスト', '当日リーダー手当', '研修手当'] as const

/** The 勤怠 columns the payroll formulas add up (by sheet): see src/domain/payroll.ts. */
export const KINTAI_COLS: Record<PayShift, string[]> = {
  early: ['N', 'Q', 'S', 'V', 'W'],
  middle: ['P', 'R', 'U', 'W', 'Y', 'Z', 'AC', 'AD'],
  late: ['P', 'R', 'U', 'W', 'Y', 'Z', 'AC', 'AD'],
}

export interface PayrollSource {
  month: string
  /** name → day → shift cell (e.g. ⑤7-17) and 研修 number (0 = none), per sheet */
  shifts: Record<PayShift, Record<string, Record<string, { code: string; training: number }>>>
  /** 勤務時間リスト: shift cell → worked hours (early: all normal) */
  hours: Record<PayShift, Record<string, { normal: number; night: number }>>
  /** 勤怠 rows: day, name, the summed columns (non-zero only) */
  kintai: Record<PayShift, { day: number; name: string; v: Record<string, number> }[]>
  dayLeader: { name: string; hours: number }[]
  trainingAllowance: { name: string; hours: number }[]
}

type Cells = Map<string, string | number>

const decodeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

export const colIndex = (col: string) => [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)
export const colName = (i: number): string => (i <= 0 ? '' : colName(Math.floor((i - 1) / 26)) + String.fromCharCode(65 + ((i - 1) % 26)))

/** Every cell with a value: "C12" → string (shared / inline / formula string) or number. */
export function readCells(xml: string, strings: string[]): Cells {
  const out: Cells = new Map()
  for (const [, ref, attrs, inner] of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    if (!inner) continue
    const t = /t="([^"]+)"/.exec(attrs!)?.[1]
    if (t === 'inlineStr') {
      const s = [...inner.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => decodeXml(m[1]!)).join('')
      out.set(ref!, s)
      continue
    }
    const v = /<v>([^<]*)<\/v>/.exec(inner)?.[1]
    if (v === undefined) continue
    if (t === 's') out.set(ref!, strings[Number(v)] ?? '')
    else if (t === 'str' || t === 'e') out.set(ref!, decodeXml(v))
    else if (t === 'b') out.set(ref!, Number(v))
    else out.set(ref!, Number(v))
  }
  return out
}

/** ①7-17, 23-7, ⑤11-17.5 … (store mark optional) */
const SHIFT_CELL = /^[①②③④⑤]?\s*\d{1,2}(?:\.\d+)?\s*-\s*\d{1,2}(?:\.\d+)?$/
const num = (v: string | number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const serialToDate = (v: number) => new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000).toISOString().slice(0, 10)

/**
 * `dayLeaderRow0`: first data row of 当日リーダー手当 (the shift workbook: 34; the payroll workbook's own copy: 9).
 * The table has 31 rows; pairs of (name, hours) columns C/F, H/K, O/R, V/Y.
 */
export function extractPayrollSource(
  files: { sharedStrings: string; sheets: Record<string, string> },
  layout: { dayLeaderRow0: number } = { dayLeaderRow0: 34 },
): PayrollSource {
  const strings = parseSharedStrings(files.sharedStrings)
  const sheet = (name: string): Cells => (files.sheets[name] ? readCells(files.sheets[name]!, strings) : new Map())
  const early = sheet('早番')
  const b2 = early.get('B2')
  if (typeof b2 !== 'number') throw new Error('早番!B2 (month) is missing')
  const month = `${serialToDate(b2).slice(0, 7)}-01`

  const shifts = { early: {}, middle: {}, late: {} } as PayrollSource['shifts']
  const kintai = { early: [], middle: [], late: [] } as PayrollSource['kintai']
  for (const k of Object.keys(PAY_SHEETS) as PayShift[]) {
    const s = k === 'early' ? early : sheet(PAY_SHEETS[k].shift)
    // row 4: names; the column after a name headed 研修 holds that person's training number; rows 5–35 = day 1–31
    for (let c = 2; c <= colIndex('DA'); c++) {
      const name = s.get(`${colName(c)}4`)
      if (typeof name !== 'string' || !name.trim() || name === '日' || name === '研修') continue
      const key = name.trim()
      if (shifts[k][key]) continue // MATCH takes the first column
      const trainingCol = s.get(`${colName(c + 1)}4`) === '研修' ? colName(c + 1) : null
      const days: Record<string, { code: string; training: number }> = {}
      for (let d = 1; d <= 31; d++) {
        const v = s.get(`${colName(c)}${d + 4}`)
        const code = typeof v === 'string' ? v.trim() : ''
        const training = trainingCol ? num(s.get(`${trainingCol}${d + 4}`)) : 0
        if (code || training) days[String(d)] = { code, training }
      }
      // header cells that are not people (counts, store names…) have no shift cells
      if (Object.values(days).some((x) => SHIFT_CELL.test(x.code) || x.training)) shifts[k][key] = days
    }
    const kt = sheet(PAY_SHEETS[k].kintai)
    const rows = new Set<number>()
    for (const ref of kt.keys()) {
      const r = Number(/\d+$/.exec(ref)![0])
      if (r >= 7 && ref.startsWith('C') && /^C\d+$/.test(ref)) rows.add(r)
    }
    for (const r of [...rows].sort((a, b) => a - b)) {
      const date = kt.get(`C${r}`)
      const name = kt.get(`G${r}`)
      if (typeof date !== 'number' || typeof name !== 'string' || !name.trim()) continue
      const iso = serialToDate(date)
      if (`${iso.slice(0, 7)}-01` !== month) continue
      const v: Record<string, number> = {}
      for (const col of KINTAI_COLS[k]) {
        const x = num(kt.get(`${col}${r}`))
        if (x) v[col] = x
      }
      if (Object.keys(v).length) kintai[k].push({ day: Number(iso.slice(8, 10)), name: name.trim(), v })
    }
  }

  const list = sheet('勤務時間リスト')
  const hours = { early: {}, middle: {}, late: {} } as PayrollSource['hours']
  for (let r = 5; r <= 114; r++) {
    const add = (k: PayShift, codeCol: string, normalCol: string, nightCol: string | null) => {
      const code = list.get(`${codeCol}${r}`)
      if (typeof code !== 'string' || !code.trim() || hours[k][code.trim()]) return
      hours[k][code.trim()] = { normal: num(list.get(`${normalCol}${r}`)), night: nightCol ? num(list.get(`${nightCol}${r}`)) : 0 }
    }
    add('early', 'B', 'E', null)
    add('middle', 'G', 'L', 'M')
    add('late', 'P', 'U', 'V')
  }

  const pairs = (cells: Cells, cols: [string, string][], r0: number, r1: number) => {
    const out: { name: string; hours: number }[] = []
    for (const [nc, hc] of cols)
      for (let r = r0; r <= r1; r++) {
        const name = cells.get(`${nc}${r}`)
        const h = num(cells.get(`${hc}${r}`))
        if (typeof name === 'string' && name.trim() && h) out.push({ name: name.trim(), hours: h })
      }
    return out
  }
  const r0 = layout.dayLeaderRow0
  const dayLeader = pairs(sheet('当日リーダー手当'), [['C', 'F'], ['H', 'K'], ['O', 'R'], ['V', 'Y']], r0, r0 + 30)
  const trainingAllowance = pairs(sheet('研修手当'), [['C', 'F'], ['K', 'N'], ['S', 'V']], 1, 200)

  return { month, shifts, hours, kintai, dayLeader, trainingAllowance }
}
