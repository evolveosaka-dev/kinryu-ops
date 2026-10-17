import { describe, expect, it } from 'vitest'
import type { PayrollSource } from '../../supabase/functions/_shared/payrollWorkbook'
import { computePayroll, EMPTY_INPUT, legalHours, xlRound, xlRoundUp, type PayrollRates } from './payroll'

const rates: PayrollRates = { normal: 1000, night: 1250, overtime: 1250, training_normal: 1000, training_night: 1250, day_leader_unit: 100, training_allowance_unit: 50, busy_unit: 200 }
const staff = { roster_name: 'ミナミ', staff_code: 'EVO1', kind: '早番', commute_unit: 400, leader_unit: 0, shift_make_amount: 0 }
const base: PayrollSource = {
  month: '2026-10-01',
  shifts: { early: {}, middle: {}, late: {} },
  hours: { early: { '⑤7-17': { normal: 8.75, night: 0 } }, middle: { '⑤17-23': { normal: 4.25, night: 1 } }, late: { '⑤23-7': { normal: 1.75, night: 5.25 } } },
  kintai: { early: [], middle: [], late: [] },
  dayLeader: [],
  trainingAllowance: [],
}

describe('給与計算 (formulas of the payroll workbook)', () => {
  it('hours from the shift cells, 勤怠 adjustments, allowances, rounding', () => {
    const src: PayrollSource = {
      ...base,
      shifts: { early: { ミナミ: { '1': { code: '⑤7-17', training: 0 }, '2': { code: '⑤7-17', training: 0 } } }, middle: { ミナミ: { '3': { code: '⑤17-23', training: 0 } } }, late: {} },
      // day 2: 0.5 h less break (N = −0.5 → +0.5 h), 1 h シフト外 (V); someone else's rows are ignored
      kintai: { early: [{ day: 2, name: 'ミナミ', v: { N: -0.5, V: 1 } }, { day: 2, name: 'キタ', v: { V: 5 } }], middle: [], late: [] },
      dayLeader: [{ name: 'ミナミ', hours: 8.75 }],
      trainingAllowance: [{ name: 'ミナミ', hours: 3.75 }],
    }
    const r = computePayroll(src, staff, rates, { ...EMPTY_INPUT, paid_daily: 7000.4, paid_days: 1, commute_adjust: 1, referral_amount: 3000 })
    expect(r.days[1]).toMatchObject({ normal: 8.75, normalAdj: 0.5, normalExtra: 1, total: 10.25 })
    expect(r.totalHours).toBe(8.75 + 10.25 + 5.25)
    expect(r.normalHours).toBe(8.75 + 9.25 + 1 + 4.25)
    expect(r.nightHours).toBe(1)
    expect(r.workDays).toBe(3)
    expect(r.report).toMatchObject({ normal: 22.25, extraNormal: 1 })
    expect(r.allowances).toMatchObject({ paid: 7000, dayLeader: 875, trainingAllowance: 188, commute: 1600, commuteDays: 4, referral: 3000 })
    expect(r.total).toBe(xlRoundUp(1000 * 23.25 + 1250 * 1 + 7000 + 875 + 188 + 1600 + 3000))
  })

  it('over the legal hours: the extra hours come out of the normal hours at the overtime rate', () => {
    const days: Record<string, { code: string; training: number }> = {}
    for (let d = 1; d <= 21; d++) days[String(d)] = { code: '⑤7-17', training: 0 }
    const r = computePayroll({ ...base, shifts: { early: { ミナミ: days }, middle: {}, late: {} } }, staff, rates)
    expect(legalHours('2026-10-01')).toBe(177.14)
    expect(r.totalHours).toBeCloseTo(183.75)
    expect(r.overtimeHours).toBeCloseTo(183.75 - 177.14)
    expect(r.normalHours).toBeCloseTo(177.14)
    expect(r.pay.overtime).toBeCloseTo(1250 * (183.75 - 177.14))
  })

  it('研修: 1st = シフト外 (STM), 2nd–10th = オーダー外, the rest = 11–30', () => {
    const src: PayrollSource = {
      ...base,
      shifts: { early: { ミナミ: { '1': { code: '⑤7-17', training: 2 }, '2': { code: '⑤7-17', training: 12 } } }, middle: {}, late: {} },
    }
    const r = computePayroll(src, staff, rates)
    expect(r.trainingNormalHours).toBe(17.5)
    expect(r.normalHours).toBe(0)
    expect(r.report).toMatchObject({ training10Normal: 8.75, training11Normal: 8.75 })
    expect(r.trainingCount).toBe(2)
  })

  it('Excel rounding', () => {
    expect([xlRound(2.5), xlRound(-2.5), xlRound(187.5), xlRoundUp(10.01), xlRoundUp(10)]).toEqual([3, -3, 188, 11, 10])
  })
})
