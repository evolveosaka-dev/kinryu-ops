import { describe, expect, it } from 'vitest'
import { chainMinutes, daysUntil, formatRange, nextShift, parseCell, weekDates, type Assignment } from './schedule'
import { parseShiftSheet, parseWorkbook, sheetPaths } from './shiftImport'

const jst = (s: string) => new Date(`${s}+09:00`)
const a = (business_date: string, shift: Assignment['shift'], start: number, end: number, store_mark = '⑤'): Assignment => ({
  business_date,
  shift,
  store_mark,
  start_min: start * 60,
  end_min: end * 60,
})

describe('parseCell', () => {
  it.each([
    ['①11-17.5', { store_mark: '①', start_min: 660, end_min: 1050 }],
    ['⑤7-17', { store_mark: '⑤', start_min: 420, end_min: 1020 }],
    ['⑤23-7', { store_mark: '⑤', start_min: 1380, end_min: 1860 }],
    ['③ 12 - 17', { store_mark: '③', start_min: 720, end_min: 1020 }],
  ])('%s', (raw, expected) => expect(parseCell(raw)).toEqual(expected))
  it.each(['日', '⇒', '7-17', 'チョー\n7-17', '', '①99-100'])('ignores %s', (raw) => expect(parseCell(raw)).toBeNull())
  it('formats ranges', () => expect(formatRange({ start_min: 1380, end_min: 1860 })).toBe('23:00–7:00'))
})

describe('next shift and chains', () => {
  const xs = [a('2026-10-12', 'middle', 17, 23), a('2026-10-12', 'late', 23, 31, '①'), a('2026-10-14', 'late', 23, 31, '①')]
  it('finds the shift in progress, else the next one', () => {
    expect(nextShift(xs, jst('2026-10-12T10:00:00'))).toEqual({ assignment: xs[0], inProgress: false })
    expect(nextShift(xs, jst('2026-10-13T01:00:00'))).toEqual({ assignment: xs[1], inProgress: true })
    expect(nextShift(xs, jst('2026-10-13T08:00:00'))?.assignment).toBe(xs[2])
    expect(nextShift(xs, jst('2026-10-20T08:00:00'))).toBeNull()
  })
  it('days until', () => {
    expect(daysUntil(xs[2]!, jst('2026-10-12T10:00:00'))).toBe(2)
  })
  it('chains back-to-back shifts (中番 + 遅番 = 14 h)', () => {
    const chains = chainMinutes(xs)
    expect(chains.get(xs[0]!)).toBe(14 * 60)
    expect(chains.get(xs[1]!)).toBe(14 * 60)
    expect(chains.get(xs[2]!)).toBe(8 * 60)
  })
  it('week strip is Monday to Sunday', () => {
    expect(weekDates('2026-10-14')).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'])
  })
})

describe('workbook sheets', () => {
  // row 4: names; B = date serial (46296 = 2026-10-01); S = second date column (ignored)
  const sheet = `<sheetData>
    <row r="4" spans="1:30"><c r="B4" t="s"><v>0</v></c><c r="C4" t="s"><v>1</v></c><c r="D4" t="s"><v>2</v></c><c r="S4" t="s"><v>0</v></c></row>
    <row r="5"><c r="B5" s="3"><v>46296</v></c><c r="C5" t="s"><v>3</v></c><c r="S5"><v>46296</v></c><c r="E5" s="2"/></row>
    <row r="6"><c r="B6"><v>46297</v></c><c r="D6" t="s"><v>4</v></c></row>
    <row r="40"><c r="B40" t="s"><v>5</v></c><c r="C40" t="s"><v>3</v></c></row>
  </sheetData>`
  const strings = ['日', 'バンダラ', 'マノズ', '①23-7', '⑤23-7', '必要人数']
  it('reads one row per person and day', () => {
    expect(parseShiftSheet(sheet, strings, 'late')).toEqual([
      { business_date: '2026-10-01', shift: 'late', roster_name: 'バンダラ', store_mark: '①', start_min: 1380, end_min: 1860, raw: '①23-7' },
      { business_date: '2026-10-02', shift: 'late', roster_name: 'マノズ', store_mark: '⑤', start_min: 1380, end_min: 1860, raw: '⑤23-7' },
    ])
  })
  it('finds sheets and the month', () => {
    const paths = sheetPaths(
      '<sheets><sheet name="遅番" sheetId="1" r:id="rId9"/></sheets>',
      '<Relationships><Relationship Id="rId9" Type="x" Target="worksheets/sheet12.xml"/></Relationships>',
    )
    expect(paths).toEqual({ 遅番: 'xl/worksheets/sheet12.xml' })
    const sst = `<sst>${strings.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`
    const res = parseWorkbook({ workbook: '', rels: '', sharedStrings: sst, sheets: { 遅番: sheet } })
    expect(res.month).toBe('2026-10-01')
    expect(res.rows).toHaveLength(2)
    expect(res.missingSheets).toEqual(['早番', '中番'])
  })
})
