import { describe, expect, it } from 'vitest'
import { dayView, eventEffects, indexSales, isoWeek, monthlyTrend, monthSummary, patrolBands, typeTable, typeYears, weekly, weeklyTrend, type Ctx, type Sale } from './salesAnalysis'
import type { TargetEvent, TargetRow } from './targets'
import { addDays } from './time'
import type { Shift } from './types'

const H = new Set<string>(['2026-10-12'])
const SH: Shift[] = ['early', 'middle', 'late']
// 2026-10-01..2026-10-10 each shift 100 bowls at store s; last year (−364 days) 80
const sales: Sale[] = []
for (let i = 0; i < 10; i++) {
  const d = addDays('2026-10-01', i)
  for (const shift of SH) {
    sales.push({ store_id: 's', business_date: d, shift, bowls: 100 })
    sales.push({ store_id: 's', business_date: addDays(d, -364), shift, bowls: 80 })
  }
}
const targets: TargetRow[] = ['weekday', 'friday', 'saturday', 'sunday_holiday', 'long_holiday', 'peak'].flatMap((t) =>
  SH.map((shift) => ({ store_id: 's', month: '2026-10-01', shift, day_type: t, bowls: t === 'weekday' ? 100 : 125 })),
)
const ev: TargetEvent = { id: 'e', event_date: '2026-10-07', name: '阪神', store_id: 's', early_pct: 0, middle_pct: -20, late_pct: 0, active: true, note: null }
const ctx: Ctx = { sales: indexSales(sales), targets, events: [ev], holidays: H, storeIds: ['s'], shifts: SH }

describe('salesAnalysis', () => {
  it('figures before 2025 are never used', () => {
    expect(indexSales([{ store_id: 's', business_date: '2024-12-31', shift: 'early', bowls: 9 }, { store_id: 's', business_date: '2025-01-01', shift: 'early', bowls: 7 }]).size).toBe(1)
  })
  it('a day: actual, target with events, same weekday last year', () => {
    const v = dayView(ctx, '2026-10-07') // Wed, 阪神 中番 −20%
    expect(v).toMatchObject({ actual: 300, target: 280, lastYear: 240, complete: true, events: ['阪神'], dayType: 'weekday' })
    expect(dayView(ctx, '2026-10-20')).toMatchObject({ actual: null, target: null, targetAll: 300, complete: false })
  })
  it('month summary: 達成率, YoY, forecast with the targets of the days left', () => {
    const s = monthSummary(ctx, '2026-10-01', '2026-10-11')
    expect(s.actual).toBe(3000)
    expect(s.yoy).toBe(25) // 100 vs 80
    expect(s.daysWithData).toBe(10)
    // 10/11 (Sun, 3-day weekend) … 10/31: targets of the remaining days are added
    expect(s.forecast).toBeGreaterThan(3000)
    expect(s.best && s.worst).toBeTruthy()
  })
  it('type table, trend, weekly, patrol bands and event effects', () => {
    const rows = typeTable(ctx, '2026-10-01')
    const wd = rows.find((r) => r.dayType === 'weekday')!
    expect(wd.cells.early).toEqual({ actual: 100, target: 100, rate: 100 })
    expect(monthlyTrend(ctx, '2026-09-01', '2026-10-01').map((m) => m.avg)).toEqual([null, 300])
    const w = weekly(ctx, '2026-10-05', '2026-10-11', [{ business_date: '2026-10-06', store_id: 's', shift: 'early', score25: 21 }])
    expect(w[0]).toMatchObject({ monday: '2026-10-05', avg: 300, lyAvg: 240, yoy: 25, patrol: 21, patrols: 1 })
    expect(patrolBands(ctx, [{ business_date: '2026-10-06', store_id: 's', shift: 'early', score25: 21 }])[0]).toEqual({ key: 'good', slots: 1, rate: 100 })
    const eff = eventEffects(ctx, [ev])
    expect(eff[0]!.shifts.find((x) => x.shift === 'middle')).toEqual({ shift: 'middle', set: -20, measured: 0, slots: 1 })
  })
  it('weekly trend by ISO week and the day types against the same month of the years before', () => {
    expect(isoWeek('2026-01-01')).toEqual({ year: '2026', week: 1 })
    expect(isoWeek('2027-01-01')).toEqual({ year: '2026', week: 53 })
    expect(isoWeek('2026-10-05')).toEqual({ year: '2026', week: 41 })
    const w = weeklyTrend(ctx, '2026-10-05', '2026-10-11')
    expect(w).toEqual([{ monday: '2026-10-05', year: '2026', week: 41, avg: 300, days: 6 }])
    const ty = typeYears(ctx, '2026-10-01')
    expect(ty.years).toEqual(['2025', '2026'])
    const wd = ty.rows.find((r) => r.dayType === 'weekday')!
    expect(wd.cells['2026']!.avg).toBe(300)
    expect(wd.cells['2025']!.avg).toBe(240)
    expect(typeYears(ctx, '2026-11-01').years).toEqual([])
  })
})
