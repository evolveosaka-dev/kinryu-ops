import { describe, expect, it } from 'vitest'
import { findTarget, isPeak, targetDayType, type TargetEvent, type TargetRow } from './targets'

// holidays around the dates below (2026–2027)
const H = new Set(['2026-10-12', '2026-11-03', '2026-11-23', '2027-01-01', '2027-01-11', '2027-03-21', '2027-03-22', '2027-05-03', '2027-05-04', '2027-05-05'])

describe('targetDayType', () => {
  it('weekdays, Friday and the day before a holiday', () => {
    expect(targetDayType('2026-10-14', H)).toBe('weekday') // Wed
    expect(targetDayType('2026-10-16', H)).toBe('friday') // Fri
    expect(targetDayType('2026-11-02', H)).toBe('friday') // Mon before 11/3 (Tue holiday)
  })
  it('a normal weekend: Saturday / Sunday (last day off)', () => {
    expect(targetDayType('2026-10-17', H)).toBe('saturday')
    expect(targetDayType('2026-10-18', H)).toBe('sunday_holiday')
  })
  it('a 3-day weekend: Saturday and Sunday are 連休中, the Monday holiday is the last day', () => {
    expect(targetDayType('2026-10-10', H)).toBe('long_holiday')
    expect(targetDayType('2026-10-11', H)).toBe('long_holiday')
    expect(targetDayType('2026-10-12', H)).toBe('sunday_holiday')
    expect(targetDayType('2026-11-03', H)).toBe('sunday_holiday') // single holiday on a Tuesday
  })
  it('peak: 年末年始 and お盆 win over everything', () => {
    expect(targetDayType('2026-12-29', H)).toBe('peak')
    expect(targetDayType('2027-01-03', H)).toBe('peak')
    expect(targetDayType('2027-08-13', H)).toBe('peak')
    expect(isPeak('2027-01-04')).toBe(false)
  })
  it('peak: GW and SW except their last day; a normal 3-day weekend in September stays 連休中', () => {
    const G = new Set(['2026-04-29', '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06', '2026-09-21', '2026-09-22', '2026-09-23', '2027-09-20'])
    expect(targetDayType('2026-04-29', G)).toBe('sunday_holiday') // 昭和の日 alone (Wed)
    expect(targetDayType('2026-05-01', G)).toBe('friday')
    expect(['2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05'].map((d) => targetDayType(d, G))).toEqual(['peak', 'peak', 'peak', 'peak'])
    expect(targetDayType('2026-05-06', G)).toBe('sunday_holiday') // last day of GW
    expect(['2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22'].map((d) => targetDayType(d, G))).toEqual(['peak', 'peak', 'peak', 'peak'])
    expect(targetDayType('2026-09-23', G)).toBe('sunday_holiday') // last day of SW
    expect(targetDayType('2027-09-18', G)).toBe('long_holiday') // 3-day weekend, not SW
    expect(targetDayType('2027-09-20', G)).toBe('sunday_holiday')
  })
})

describe('findTarget', () => {
  const rows: TargetRow[] = [
    { store_id: 's', month: '2026-10-01', shift: 'middle', day_type: 'weekday', bowls: 150 },
    { store_id: 's', month: '2026-09-01', shift: 'middle', day_type: 'weekday', bowls: 140 },
    { store_id: 's', month: '2026-09-01', shift: 'middle', day_type: 'weekend_holiday', bowls: 200 },
  ]
  const ev = (over: Partial<TargetEvent>): TargetEvent => ({ id: '1', event_date: '2026-10-14', name: '阪神', store_id: 's', early_pct: 0, middle_pct: -20, late_pct: 0, active: true, note: null, ...over })
  it('uses the six day types, then applies the events of the date (store or both)', () => {
    expect(findTarget(rows, [], 's', '2026-10-14', 'middle', H)).toEqual({ bowls: 150, base: 150, dayType: 'weekday', events: [] })
    const r = findTarget(rows, [ev({}), ev({ id: '2', name: '全店', store_id: null, middle_pct: 10 }), ev({ id: '3', active: false, middle_pct: 50 }), ev({ id: '4', store_id: 'x', middle_pct: 50 })], 's', '2026-10-14', 'middle', H)
    expect(r).toEqual({ bowls: 132, base: 150, dayType: 'weekday', events: [{ name: '阪神', pct: -20 }, { name: '全店', pct: 10 }] })
  })
  it('falls back to 平日 / 土日祝 for the months before; nothing when there is no row', () => {
    expect(findTarget(rows, [], 's', '2026-09-26', 'middle', H)?.bowls).toBe(200) // Saturday → weekend_holiday
    expect(findTarget(rows, [], 's', '2026-10-17', 'middle', H)).toBeNull() // no saturday row for October
  })
})
