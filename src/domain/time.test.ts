import { describe, expect, it } from 'vitest'
import { businessDateFor, currentSlot, dayType, detectShift, previousSlot, tokyoParts } from './time'

const jst = (s: string) => new Date(`${s}+09:00`)

describe('tokyoParts', () => {
  it('converts UTC to Tokyo', () => {
    expect(tokyoParts(new Date('2026-10-12T15:30:00Z'))).toMatchObject({ date: '2026-10-13', hour: 0, minute: 30 })
  })
})

describe('detectShift / business date', () => {
  it.each([
    ['2026-10-12T06:00:00', 'early', '2026-10-12'],
    ['2026-10-12T11:59:00', 'early', '2026-10-12'],
    ['2026-10-12T16:00:00', 'middle', '2026-10-12'],
    ['2026-10-12T21:59:00', 'middle', '2026-10-12'],
    ['2026-10-12T22:00:00', 'late', '2026-10-12'],
    ['2026-10-12T23:10:00', 'late', '2026-10-12'],
    ['2026-10-13T00:30:00', 'late', '2026-10-12'],
    ['2026-10-13T05:59:00', 'late', '2026-10-12'],
  ])('%s → %s on %s', (t, shift, date) => {
    expect(detectShift(jst(t))).toBe(shift)
    expect(currentSlot(jst(t))).toEqual({ shift, businessDate: date })
  })

  it('a 遅番 record entered at 06:30 belongs to the previous day', () => {
    expect(businessDateFor(jst('2026-10-13T06:30:00'), 'late')).toBe('2026-10-12')
  })
})

describe('previousSlot', () => {
  it('early → previous day late', () => {
    expect(previousSlot('2026-10-13', 'early')).toEqual({ businessDate: '2026-10-12', shift: 'late' })
  })
  it('middle → same day early, late → same day middle', () => {
    expect(previousSlot('2026-10-13', 'middle')).toEqual({ businessDate: '2026-10-13', shift: 'early' })
    expect(previousSlot('2026-10-13', 'late')).toEqual({ businessDate: '2026-10-13', shift: 'middle' })
  })
})

describe('dayType', () => {
  const holidays = new Set(['2026-10-12'])
  it('weekday / weekend / holiday', () => {
    expect(dayType('2026-10-13', holidays)).toBe('weekday') // Tue
    expect(dayType('2026-10-17', holidays)).toBe('weekend_holiday') // Sat
    expect(dayType('2026-10-18', holidays)).toBe('weekend_holiday') // Sun
    expect(dayType('2026-10-12', holidays)).toBe('weekend_holiday') // スポーツの日
  })
})
