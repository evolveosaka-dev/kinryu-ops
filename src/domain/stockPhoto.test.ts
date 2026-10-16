import { describe, expect, it } from 'vitest'
import type { StockItem } from './stock'
import { checkItem, flagLevel, parseStandard, standardDiffs, tempsOk, type ReadItem } from './stockPhoto'

const item = (over: Partial<StockItem> = {}): StockItem => ({
  id: 'i1', store_id: 's', code: 'rice', name_ja: '米', unit: 'bag', pack_size: 6, pack_unit: 'box', standard: null, sort_order: 1, active: true, ...over,
})
const read = (over: Partial<ReadItem> = {}): ReadItem => ({
  code: 'rice', present: true, standard_text: null, carry: 37, ins: [], outs: [], used: 1, left: 36, unsure: [], note: null, ...over,
})
const mv = (place: string, qty: number) => ({ place, place_text: place, person: null, qty })

describe('checkItem', () => {
  it('a sheet that adds up has no flags', () => {
    expect(checkItem(read({ ins: [mv('vendor', 24)], outs: [mv('ebisubashi', 6)], left: 54 }), item(), 37)).toEqual([])
  })

  it('米 on the 9/12 sheet: 37 + 24 − 6 − 1 = 54 but 52 written → red with the expected value', () => {
    const f = checkItem(read({ ins: [mv('vendor', 24)], outs: [mv('ebisubashi', 6)], left: 52 }), item(), 37)
    expect(f).toEqual([{ kind: 'sum', expected: 54 }])
    expect(flagLevel(f[0]!)).toBe('red')
  })

  it('a misread decimal point (2.5 → 21.5) breaks the sum', () => {
    const f = checkItem(read({ carry: 22.5, outs: [mv('ebisubashi', 4)], used: 21.5, left: 16 }), item(), null)
    expect(f.map((x) => x.kind)).toEqual(['sum'])
  })

  it('繰越 different from the previous shift and unsure fields are amber', () => {
    const f = checkItem(read({ carry: 37, left: 36, unsure: ['carry'], note: '37?? と 36' }), item(), 36)
    expect(f.map((x) => [x.kind, flagLevel(x)])).toEqual([
      ['carry_prev', 'amber'],
      ['unsure', 'amber'],
    ])
  })

  it('missing 次シフト繰越, unknown place, unusual amount', () => {
    const f = checkItem(read({ left: null, outs: [mv('other', 2)], used: 40 }), item({ standard: 10 }), null)
    expect(f.map((x) => x.kind)).toEqual(['left_missing', 'unusual', 'place_other'])
  })

  it('items not on the paper are not checked', () => {
    expect(checkItem(read({ present: false, left: null }), item(), 5)).toEqual([])
  })
})

describe('standards', () => {
  it('段 / 缶 / plain numbers in the item unit', () => {
    expect(parseStandard('15段{', { pack_size: 50, pack_unit: 'tier' })).toBe(750)
    expect(parseStandard('46.0{', { pack_size: 23.3, pack_unit: 'can' })).toBe(46)
    expect(parseStandard('４', { pack_size: null, pack_unit: null })).toBe(4)
    expect(parseStandard(null, { pack_size: null, pack_unit: null })).toBeNull()
  })

  it('only differences are reported', () => {
    const items = [item({ code: 'noodle', pack_size: 50, pack_unit: 'tier', standard: 750 }), item({ id: 'i2', code: 'kimchi', pack_size: null, pack_unit: null, standard: 4 })]
    const d = standardDiffs(
      { items: [read({ code: 'noodle', standard_text: '15段' }), read({ code: 'kimchi', standard_text: '3' })], temps_start: [], temps_end: [], store_text: null, date_text: null, shift_text: null },
      items,
    )
    expect(d.map((x) => [x.item.code, x.paper, x.app])).toEqual([['kimchi', 3, 4]])
  })
})

it('temperatures need one per fridge', () => {
  expect(tempsOk([3, 3, 1, 1], 4)).toBe(true)
  expect(tempsOk([3, 3, 1], 4)).toBe(false)
  expect(tempsOk([3, null, 1, 1], 4)).toBe(false)
})
