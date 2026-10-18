import { describe, expect, it } from 'vitest'
import { parseSalesSheet } from '../../supabase/functions/_shared/salesWorkbook'

// shift-sync reads the 販売杯数 workbook (★拝数入力シート): row 2 headers, D = date serial, the first ⑤早番…①遅番 columns
describe('販売杯数 workbook', () => {
  const strings = ['日', '⑤早番', '⑤中番', '⑤遅番', '①早番', '①中番', '①遅番', '集計中']
  const head = ['D', 'G', 'H', 'I', 'J', 'K', 'L'].map((c, i) => `<c r="${c}2" t="s"><v>${i}</v></c>`).join('') + '<c r="Q2" t="s"><v>1</v></c>'
  const xml = `<sheetData>
    <row r="1"><c r="G1" t="s"><v>1</v></c></row>
    <row r="2">${head}</row>
    <row r="3"><c r="D3"><v>46311</v></c><c r="G3"><v>166</v></c><c r="H3"><v>134</v></c><c r="I3"><v>117</v></c><c r="J3"><v>129</v></c><c r="K3"><v>148</v></c><c r="L3"><v>145</v></c><c r="Q3"><v>193.5</v></c></row>
    <row r="4"><c r="D4"><v>46312</v></c><c r="G4"><v>275</v></c><c r="H4" t="s"><v>7</v></c><c r="I4" t="e"><v>#VALUE!</v></c><c r="J4"><v>12.5</v></c><c r="K4"/><c r="L4" t="str"><v>9</v></c></row>
    <row r="5"><c r="D5"><v>46313</v></c><c r="G5"><v>1</v></c></row>
    <row r="6"><c r="D6"><v>45000</v></c><c r="G6"><v>1</v></c></row>
  </sheetData>`

  it('numbers of the six columns, within the dates; text, errors, decimals and the average columns left out', () => {
    const r = parseSalesSheet(xml, strings, '2025-01-01', '2026-10-17')
    expect(r.columns).toBe(6)
    expect(r.rows).toEqual([
      { date: '2026-10-16', store: 'midosuji', shift: 'early', bowls: 129 },
      { date: '2026-10-16', store: 'midosuji', shift: 'late', bowls: 145 },
      { date: '2026-10-16', store: 'midosuji', shift: 'middle', bowls: 148 },
      { date: '2026-10-16', store: 'sennichimae', shift: 'early', bowls: 166 },
      { date: '2026-10-16', store: 'sennichimae', shift: 'late', bowls: 117 },
      { date: '2026-10-16', store: 'sennichimae', shift: 'middle', bowls: 134 },
      { date: '2026-10-17', store: 'sennichimae', shift: 'early', bowls: 275 },
    ])
  })
  it('a sheet without the headers has no columns', () => {
    expect(parseSalesSheet('<sheetData><row r="3"><c r="D3"><v>46311</v></c><c r="G3"><v>5</v></c></row></sheetData>', strings, '2025-01-01', '2026-12-31')).toEqual({ rows: [], columns: 0 })
  })
})
