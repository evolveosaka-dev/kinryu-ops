import { describe, expect, it } from 'vitest'
import { fmtQty, latestTemps, packsOf, parseQty, parseTemp, stockState, type StockEvent, type StockItem } from './stock'

const item = (id: string, over: Partial<StockItem> = {}): StockItem => ({
  id,
  store_id: 's',
  code: id,
  name_ja: id,
  unit: 'bag',
  pack_size: null,
  pack_unit: null,
  standard: null,
  sort_order: 0,
  active: true,
  ...over,
})

let n = 0
const ev = (kind: StockEvent['kind'], lines: [string, number][], over: Partial<StockEvent> = {}): StockEvent => ({
  id: String(++n),
  store_id: 's',
  business_date: '2026-10-14',
  shift: 'early',
  kind,
  place: null,
  note: null,
  lines: lines.map(([item, qty]) => ({ item, qty })),
  temps: null,
  author_id: 'u',
  author_name: 'A',
  created_at: `2026-10-14T00:00:${String(n).padStart(2, '0')}Z`,
  voided_at: null,
  voided_by_name: null,
  ...over,
})

describe('stockState', () => {
  const noodle = item('noodle', { unit: 'piece', standard: 750, pack_size: 50, pack_unit: 'tier' })
  const kimchi = item('kimchi', { standard: 4 })
  const moyashi = item('moyashi')

  it('carries the previous count, adds 受入, takes 払出 and computes 使用 (the paper sheet of 9/10)', () => {
    const prev = [ev('close', [['noodle', 164], ['kimchi', 1.5], ['moyashi', 10.8]])]
    const cur = [
      ev('in', [['noodle', 400], ['kimchi', 2]]),
      ev('out', [['moyashi', 4]]),
      ev('close', [['noodle', 481], ['kimchi', 3], ['moyashi', 5]]),
    ]
    const [a, b, c] = stockState([noodle, kimchi, moyashi], cur, prev)
    expect(a).toMatchObject({ opening: 164, received: 400, now: 564, left: 481, used: 83, suggestion: 186 })
    expect(b).toMatchObject({ opening: 1.5, now: 3.5, used: 0.5, suggestion: 0.5 })
    expect(c).toMatchObject({ opening: 10.8, sent: 4, now: 6.8, used: 1.8, suggestion: null })
  })

  it('a recount replaces the carried value; the latest count wins; cancelled rows are ignored', () => {
    const prev = [ev('close', [['kimchi', 3]])]
    const cur = [
      ev('open', [['kimchi', 2]]),
      ev('close', [['kimchi', 1]]),
      ev('close', [['kimchi', 1.5]]),
      ev('in', [['kimchi', 9]], { voided_at: '2026-10-14T09:00:00Z' }),
    ]
    const [k] = stockState([kimchi], cur, prev)
    expect(k).toMatchObject({ carried: 3, opening: 2, recounted: true, received: 0, left: 1.5, used: 0.5 })
  })

  it('without a previous count the opening and 使用 are unknown', () => {
    const [k] = stockState([kimchi], [ev('in', [['kimchi', 2]]), ev('close', [['kimchi', 1]])], [])
    expect(k).toMatchObject({ opening: null, now: null, used: null, suggestion: null, received: 2 })
  })
})

describe('helpers', () => {
  it('packs, formatting and parsing', () => {
    expect(packsOf(197, { pack_size: 50 })).toBe(4)
    expect(packsOf(5, { pack_size: null })).toBeNull()
    expect(fmtQty(2.25)).toBe('2.3')
    expect(fmtQty(null)).toBe('—')
    expect(parseQty('１２．５')).toBe(12.5)
    expect(parseQty('2,5')).toBe(2.5)
    expect(parseQty('')).toBeNull()
    expect(parseQty('1.25')).toBeUndefined()
    expect(parseQty('-1')).toBeUndefined()
    expect(parseTemp('-18')).toBe(-18)
    expect(parseTemp('99')).toBeUndefined()
  })
  it('latest temperatures', () => {
    const a = ev('temp_start', [], { temps: [3, 3, 1, 1] })
    const b = ev('temp_start', [], { temps: [4, 3, 1, 1] })
    expect(latestTemps([a, b, ev('temp_end', [], { temps: [2, 3, 1, 0] })], 'temp_start')?.temps).toEqual([4, 3, 1, 1])
  })
})
