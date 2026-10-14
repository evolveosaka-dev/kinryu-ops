import { describe, expect, it } from 'vitest'
import { cashSummary, cashTotal, minutesToTime, noodleCheck, parseInteger, signedDiff, targetRate, ticketTotal } from './sales'

describe('販売日報', () => {
  it('the paper sheet of 9/12: 食券 180, 麺 180 − 0 − 0 → 0±, 現金 24,700 → 0±', () => {
    expect(ticketTotal({ ramen: 154, chashu: 26, coupon: 0 })).toBe(180)
    expect(noodleCheck(180, 180, 0, 0)).toEqual({ out: 180, diff: 0 })
    const counts = { '5000': 1, '1000': 11, '500': 7, '100': 52 }
    expect(cashTotal(counts)).toBe(24700)
    expect(cashSummary(24700, [], counts)).toEqual({ cashIn: 0, cashOut: 0, expected: 24700, actual: 24700, diff: 0 })
    expect(signedDiff(0, '円')).toBe('0±円')
  })
  it('廃棄 and refunds', () => {
    // 麺: 使用 175 + 廃棄 5 = 出庫 180; 180 − (180 − 0 − 5) = 5 → more tickets than noodles
    expect(noodleCheck(180, 175, 5, 0)).toEqual({ out: 180, diff: 5 })
    expect(noodleCheck(180, null, 0, 0)).toBeNull()
    const s = cashSummary(1000, [{ time: '10:00', type: 'refund', detail: '', name: '', amount: 100, reason: 'x' }, { time: '', type: 'in', detail: '', name: '', amount: 50 }], { '500': 1, '100': 4 })
    expect(s).toEqual({ cashIn: 50, cashOut: 100, expected: 950, actual: 900, diff: -50 })
    expect(signedDiff(-50, '円')).toBe('−50円')
  })
  it('helpers', () => {
    expect(targetRate(180, 187)).toBe(96)
    expect(targetRate(180, null)).toBeNull()
    expect(parseInteger('２４，７００円')).toBe(24700)
    expect(parseInteger('')).toBeUndefined()
    expect(parseInteger('1.5')).toBeNaN()
    expect(minutesToTime(1860)).toBe('07:00')
    expect(minutesToTime(1050)).toBe('17:30')
  })
})
