import { describe, expect, it } from 'vitest'
import { backtest, baseline, dayTypeCache, eventFactor, forecastSlot, lastYearBase, rainFactors, rainOf, shiftRain, tempAnomaly, weatherFactors, weatherPart, yoyRatio, type RainMap, type WeatherMap } from './forecast'
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
    const sat = baseline(ctx, typeOf, '2026-10-17', 'S', 'early') // Saturdays
    expect(sat).toMatchObject({ value: 200, days: 6, weeks: 6, from: '2026-09-05' })
    expect(sat.samples.map((s) => s.date)).toEqual(['2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26', '2026-10-03', '2026-10-10'])
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
    // the error is the mean of the rows shown to managers
    expect(b.rows).toHaveLength(28)
    expect(Math.abs(b.rows.reduce((a, r) => a + r.errorPct, 0) / b.rows.length - b.error!)).toBeLessThan(0.1)
    expect(f.early.samples.length).toBeGreaterThanOrEqual(f.early.days)
  })

  it('② last year same month + ③ × this year level; the method with the smallest backtest error is used', () => {
    // every day: Sep 2025 = 120, Oct 2025 = 150 (10/22 = 300, a yearly event day), Sep 2026 = 90, Oct 2026 = 112.5
    const s2 = new Map<string, number>()
    const put = (from: string, to: string, v: number) => {
      for (let d = from; d <= to; d = addDays(d, 1)) s2.set(slotKey(d, 'S', 'early'), v)
    }
    put('2025-08-01', '2025-09-30', 120)
    put('2025-10-01', '2025-10-31', 150)
    s2.set(slotKey('2025-10-22', 'S', 'early'), 300)
    put('2026-08-01', '2026-09-30', 90)
    put('2026-10-01', '2026-10-29', 112.5)
    const c2: Ctx = { ...ctx, sales: s2, events: [{ ...ctx.events[0]!, event_date: '2026-10-22', name: '祭り' }] }
    const ly = lastYearBase(c2, typeOf, '2026-10-27', 'S', 'early') // a Tuesday → weekdays of Oct 2025
    expect(ly.month).toBe('2025-10')
    expect(ly.value).toBe(150)
    expect(ly.skipped).toEqual([{ date: '2025-10-22', event: '祭り' }])
    const r = yoyRatio(c2, typeOf, '2026-10-27', 'S', 'early')
    expect(r.allTypes).toBe(false)
    expect(r.value).toBeCloseTo(0.76, 1) // 6 weeks of Sep / early Oct: (90…112.5) ÷ (120…150)
    const f = rainFactors(c2, typeOf, new Map(), '2026-08-01', '2026-10-29')
    const one = forecastSlot(c2, typeOf, '2026-10-27', 'S', 'early', new Map(), f, 'seasonal')
    expect(one.detail.parts.method).toBe('seasonal')
    expect(one.value).toBe(Math.round(150 * r.value!))
    const b = backtest(c2, typeOf, new Map(), f, '2026-10-30')
    expect(b.chosen).toBe('seasonal')
    expect(b.methods.seasonal.error!).toBeLessThan(b.methods.recent.error!)
    expect(b.methods.seasonal.error!).toBeLessThan(b.methods.lastYear.error!)
    expect(b.methods.seasonal.slots).toBe(b.methods.recent.slots)
  })

  it('weather: hotter than the 6-week average sells less, heavy rain less; factors per band', () => {
    // 2026-04-01 … 09-30, every day: 20 °C and 100 bowls; every 4th day 26 °C → 85; every 7th day 8 mm rain → 80
    const s3 = new Map<string, number>()
    const wx: WeatherMap = new Map()
    let i = 0
    for (let d = '2026-04-01'; d <= '2026-09-30'; d = addDays(d, 1), i++) {
      const hot = i % 4 === 0
      const wet = i % 7 === 3
      wx.set(`${d}|early`, { temp: hot ? 26 : 20, mm: wet ? 8 : 0, hours: wet ? 4 : 0, source: 'archive' })
      s3.set(slotKey(d, 'S', 'early'), wet ? 80 : hot ? 85 : 100)
    }
    const c3: Ctx = { ...ctx, sales: s3, events: [] }
    expect(tempAnomaly(wx, '2026-09-28', 'early')!.band).toBe(4) // 26 °C vs ~21.5
    const wf = weatherFactors(c3, typeOf, wx, '2026-05-15', '2026-09-30')
    const hot = wf.early.temp[4]!
    const normal = wf.early.temp[2]!
    expect(hot.slots).toBeGreaterThanOrEqual(15)
    expect(hot.factor).toBeLessThan(normal.factor)
    expect(wf.early.rain[2]!.factor).toBeLessThan(1) // ≥ 6 mm
    const rf = rainFactors(c3, typeOf, rainOf(wx), '2026-05-15', '2026-09-30')
    const p = weatherPart(wx, '2026-09-28', 'early', 'rainTemp', rf, wf)
    expect(p.factor).toBeCloseTo(p.tempFactor * p.rainFactor)
    const b = backtest(c3, typeOf, rainOf(wx), rf, '2026-10-01', 28, { wx, factors: wf })
    expect(b.weather.rainTemp.error!).toBeLessThan(b.weather.rain.error!)
    expect(b.weatherChosen).toBe('rainTemp')
  })
})
