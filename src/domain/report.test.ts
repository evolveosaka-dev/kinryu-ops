import { describe, expect, it } from 'vitest'
import { rate, reportPeriods } from './report'

describe('AIレポート', () => {
  it('periods from a Thursday', () => {
    expect(reportPeriods('2026-10-15')).toEqual([
      { key: 'lastWeek', kind: 'weekly', from: '2026-10-05', to: '2026-10-11' },
      { key: 'thisWeek', kind: 'weekly', from: '2026-10-12', to: '2026-10-14' },
      { key: 'lastMonth', kind: 'monthly', from: '2026-09-01', to: '2026-09-30' },
      { key: 'thisMonth', kind: 'monthly', from: '2026-10-01', to: '2026-10-14' },
    ])
  })
  it('on a Monday the 1st there is no "this week / this month" yet', () => {
    expect(reportPeriods('2027-03-01').map((p) => p.key)).toEqual(['lastWeek', 'lastMonth'])
  })
  it('rate', () => {
    expect(rate(85, 100)).toBe(85)
    expect(rate(10, null)).toBeNull()
  })
})
