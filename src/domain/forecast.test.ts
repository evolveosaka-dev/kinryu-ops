import { describe, expect, it } from 'vitest'
import { backtest, baseline, dayTypeCache, eventFactor, forecastSlot, rainFactors, shiftRain, type RainMap } from './forecast'
import { slotKey, type Ctx } from './salesAnalysis'
import { addDays, weekdayOf } from './time'

// 2026-08-03 … 2026-10-15: weekdays 100 bowls (rainy days 80), Saturdays 200
const sales = new Map<string, number>()
const rain: RainMap = new Map()
for (let d = '2026-08-03'; d <= '2026-10-15'; d = addDays(d, 1)) {
  const wd = weekdayOf(d)
  const rainy = wd === 2 // every Tuesday rains in the early shift
  if (rainy) rain.set(`${d}|early`, 5)
  sales.set(slotKey(d, 'S', 'early'), wd === 6 ? 200 : rainy ? 80 : 100)
}
const holidays = new Set<string>()
const ctx: Ctx = {
  sales,
  targets: [],
  events: [{ id: 'e', event_date: '2026-10-24', name: 'ハロウィン', store_id: null, early_pct: 10, middle_pct: 0, late_pct: 0, active: true, note: null }],
  holidays,
  storeIds: ['S'],
  shifts: ['early'],
}
const typeOf = dayTypeCache(holidays)

describe('杯数の予測', () => {
  it('rain per shift from hourly data (遅番 = 23:00 … 6:59 of the next day)', () => {
    const r = shiftRain({ time: ['2026-10-16T06:00', '2026-10-16T08:00', '2026-10-16T18:00', '2026-10-16T23:00'], precipitation: [1, 2, 0.5, 3] })
    expect(r.get('2026-10-15|late')).toBe(1)
    expect(r.get('2026-10-16|early')).toBe(2)
    expect(r.get('2026-10-16|middle')).toBe(0.5)
    expect(r.get('2026-10-16|late')).toBe(3)
  })
  it('baseline = same day type in the 6 weeks before', () => {
    expect(baseline(ctx, typeOf, '2026-10-17', 'S', 'early')).toEqual({ value: 200, days: 6 }) // Saturdays
    const wd = baseline(ctx, typeOf, '2026-10-16', 'S', 'early') // a Friday → 'friday' type = Fridays only
    expect(wd.value).toBe(100)
  })
  it('events multiply; rain factor measured on rainy days', () => {
    expect(eventFactor(ctx, '2026-10-24', 'S', 'early')).toEqual({ factor: 1.1, names: ['ハロウィン +10%'] })
    const f = rainFactors(ctx, typeOf, rain, '2026-08-03', '2026-10-15')
    expect(f.early.days).toBeGreaterThanOrEqual(5)
    expect(f.early.factor).toBeLessThan(0.9)
    const sat = forecastSlot(ctx, typeOf, '2026-10-24', 'S', 'early', rain, f)
    expect(sat).toMatchObject({ value: 220, base: 200, events: ['ハロウィン +10%'] })
    const wetTue = forecastSlot(ctx, typeOf, '2026-10-20', 'S', 'early', new Map([['2026-10-20|early', 4]]), f)
    expect(wetTue.value).toBeLessThan(wetTue.base!)
  })
  it('backtest error over the last 28 days', () => {
    const f = rainFactors(ctx, typeOf, rain, '2026-08-03', '2026-10-15')
    const b = backtest(ctx, typeOf, rain, f, '2026-10-16')
    expect(b.slots).toBe(28)
    expect(b.error).not.toBeNull()
    expect(b.error!).toBeLessThan(15)
  })
})
