import { describe, expect, it } from 'vitest'
import { dayTypeCache, type WeatherMap } from './forecast'
import { compareDay, latestActual } from './salesCompare'
import { slotKey, type Ctx } from './salesAnalysis'
import { addDays, weekdayOf } from './time'

// 2025-09-01 … 2026-10-17, one store, two shifts: weekdays 100 / 50, other days 200 / 80; 2026 a little higher
const sales = new Map<string, number>()
for (let d = '2025-09-01'; d <= '2026-10-17'; d = addDays(d, 1)) {
  const off = [0, 6].includes(weekdayOf(d))
  const up = d >= '2026-01-01' ? 10 : 0
  sales.set(slotKey(d, 'S', 'early'), (off ? 200 : 100) + up)
  sales.set(slotKey(d, 'S', 'late'), (off ? 80 : 50) + up)
}
const holidays = new Set<string>()
const ctx: Ctx = { sales, targets: [], events: [], holidays, storeIds: ['S'], shifts: ['early', 'late'] }
const typeOf = dayTypeCache(holidays)
const wx: WeatherMap = new Map()

describe('実績・予測・前年', () => {
  it('actual, the forecast made from the days before, and the same weekday a year before', () => {
    const c = compareDay(ctx, typeOf, wx, '2026-10-15', '2025-01-01') // Thursday
    expect(c.lastYearDate).toBe('2025-10-16')
    expect(weekdayOf(c.lastYearDate)).toBe(weekdayOf('2026-10-15'))
    const early = c.rows.find((r) => r.shift === 'early')!
    expect(early).toMatchObject({ actual: 110, lastYear: 100 })
    expect(early.forecast.value).toBe(110)
    expect(c.sums.all).toEqual({ actual: 170, forecast: 170, lastYear: 150 })
    expect(c.sums.S).toEqual(c.sums.all)
  })
  it('the forecast of a day ignores that day and later figures', () => {
    const changed = new Map(sales)
    changed.set(slotKey('2026-10-15', 'S', 'early'), 999)
    changed.set(slotKey('2026-10-16', 'S', 'early'), 999)
    const a = compareDay(ctx, typeOf, wx, '2026-10-15', '2025-01-01').rows[0]!.forecast.value
    const b = compareDay({ ...ctx, sales: changed }, typeOf, wx, '2026-10-15', '2025-01-01').rows[0]!
    expect(b.forecast.value).toBe(a)
    expect(b.actual).toBe(999)
  })
  it('a total is empty when a slot has no figure; the latest day with figures', () => {
    const c = compareDay(ctx, typeOf, wx, '2026-10-18', '2025-01-01')
    expect(c.sums.all.actual).toBeNull()
    expect(c.sums.all.forecast).not.toBeNull()
    expect(latestActual(ctx, '2026-10-18')).toBe('2026-10-17')
    expect(latestActual({ ...ctx, sales: new Map() }, '2026-10-18')).toBeNull()
  })
})
