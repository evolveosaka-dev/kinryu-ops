import { describe, expect, it } from 'vitest'
import * as server from '../../supabase/functions/_shared/shiftWorkbook'
import { parseCell } from './schedule'
import { parseWorkbook, sheetPaths } from './shiftImport'

// The Edge Function shift-sync keeps its own copy of the workbook reader (Deno cannot load src/): both must agree.
describe('shift workbook: app and shift-sync read the same', () => {
  const strings = ['日', 'バンダラ', 'マノズ', '①23-7', '⑤11-17.5', '必要人数', '①23-11', 'A&amp;B']
  const sst = `<sst>${strings.map((s) => `<si><t>${s}</t><rPh><t>ルビ</t></rPh></si>`).join('')}</sst>`
  const sheet = (n: number) => `<sheetData>
    <row r="4"><c r="B4" t="s"><v>0</v></c><c r="C4" t="s"><v>1</v></c><c r="D4" t="s"><v>2</v></c><c r="E4" t="s"><v>7</v></c></row>
    <row r="5"><c r="B5"><v>46296</v></c><c r="C5" t="s"><v>${n}</v></c><c r="D5" t="s"><v>4</v></c></row>
    <row r="6"><c r="B6"><v>46297</v></c><c r="D6" t="s"><v>6</v></c><c r="E6" t="s"><v>3</v></c></row>
    <row r="7"><c r="B7"><v>46326</v></c><c r="C7" t="s"><v>3</v></c></row>
    <row r="40"><c r="B40" t="s"><v>5</v></c><c r="C40" t="s"><v>3</v></c></row>
  </sheetData>`
  const sheets = { 早番: sheet(4), 中番: sheet(4), 遅番: sheet(3) }

  it('rows, month and missing sheets', () => {
    const app = parseWorkbook({ workbook: '', rels: '', sharedStrings: sst, sheets })
    expect(server.parseWorkbook({ sharedStrings: sst, sheets })).toEqual(app)
    expect(app.month).toBe('2026-10-01')
    expect(app.rows.length).toBeGreaterThan(0)
    const partial = { 遅番: sheet(3) }
    expect(server.parseWorkbook({ sharedStrings: sst, sheets: partial })).toEqual(parseWorkbook({ workbook: '', rels: '', sharedStrings: sst, sheets: partial }))
  })

  it('sheet paths and cells', () => {
    const wb = '<sheets><sheet name="遅番" sheetId="1" r:id="rId9"/><sheet name="A&amp;B" r:id="rId2"/></sheets>'
    const rels = '<Relationships><Relationship Id="rId9" Target="worksheets/sheet12.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>'
    expect(server.sheetPaths(wb, rels)).toEqual(sheetPaths(wb, rels))
    for (const raw of ['①11-17.5', '⑤23-7', '①23-11', '③ 12 - 17', '⑤7-7', 'x', '①25-3']) expect(server.parseCell(raw)).toEqual(parseCell(raw))
  })
})
