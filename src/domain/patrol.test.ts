import { describe, expect, it } from 'vitest'
import { durationMinutes, formatHoursMinutes, judgePatrol, judgementOf, normalizedTo25, suggestPatrol } from './patrol'

const jst = (s: string) => new Date(`${s}+09:00`)

describe('judgement (5 items, max 25)', () => {
  it.each([
    [25, 'good'],
    [20, 'good'],
    [19, 'improve'],
    [15, 'improve'],
    [14, 'coaching'],
    [5, 'coaching'],
  ] as const)('%i → %s', (total, j) => expect(judgementOf(total, 25)).toBe(j))
})

describe('judgement (4 items, ⑤ = －, max 20)', () => {
  it.each([
    [20, 'good'],
    [16, 'good'],
    [15, 'improve'],
    [12, 'improve'],
    [11, 'coaching'],
    [4, 'coaching'],
  ] as const)('%i → %s', (total, j) => expect(judgementOf(total, 20)).toBe(j))
})

describe('judgePatrol', () => {
  it('counts quality when checked', () => {
    expect(judgePatrol({ smile: 4, voice: 4, grooming: 4, clean: 4, quality: 4 })).toEqual({
      total: 20,
      max: 25,
      judgement: 'good',
    })
  })
  it('uses the 20-point scale when quality is not checked', () => {
    expect(judgePatrol({ smile: 4, voice: 3, grooming: 4, clean: 4, quality: null })).toEqual({
      total: 15,
      max: 20,
      judgement: 'improve',
    })
  })
  it('normalises to 25', () => {
    expect(normalizedTo25(16, 20)).toBe(20)
  })
})

describe('durationMinutes', () => {
  it('floors to whole minutes', () => {
    expect(durationMinutes(jst('2026-10-12T17:10:00'), jst('2026-10-12T17:24:59'))).toBe(14)
  })
  it('formats h:mm', () => {
    expect(formatHoursMinutes(0)).toBe('0:00')
    expect(formatHoursMinutes(125)).toBe('2:05')
  })
})

describe('suggestPatrol', () => {
  it('06:35 → 勤務前 patrol of own store, previous 遅番', () => {
    expect(suggestPatrol(jst('2026-10-13T06:35:00'), 'home', 'other')).toEqual({
      patrolType: 'before_shift',
      storeId: 'home',
      businessDate: '2026-10-12',
      shift: 'late',
    })
  })
  it('17:20 → after-shift patrol of other store, 中番', () => {
    expect(suggestPatrol(jst('2026-10-13T17:20:00'), 'home', 'other')).toEqual({
      patrolType: 'after_shift',
      storeId: 'other',
      businessDate: '2026-10-13',
      shift: 'middle',
    })
  })
  it('07:15 after a 遅番 → other store 早番', () => {
    expect(suggestPatrol(jst('2026-10-13T07:15:00'), 'home', 'other')).toMatchObject({
      shift: 'early',
      businessDate: '2026-10-13',
    })
  })
})
