import { describe, expect, it } from 'vitest'
import { answerCells, dateSpan, EMPTY_ANSWERS, formatDayRanges, formatPeriod, isRequestOpen, monthDates, nextMonth, paidLeaveConflicts, requestDeadline, sheetCell, sheetDayLabel, sheetRows, validateRequest } from './shiftRequest'

describe('dates', () => {
  it('lists every day of the month', () => {
    expect(monthDates('2026-11-01')).toHaveLength(30)
    expect(monthDates('2026-10-01').at(-1)).toBe('2026-10-31')
  })
  it('next month', () => {
    expect(nextMonth('2026-10-10')).toBe('2026-11-01')
    expect(nextMonth('2026-12-31')).toBe('2027-01-01')
  })
  it('row label like the workbook', () => {
    expect(sheetDayLabel('2026-10-01')).toBe('10月 [1日　(木)]')
  })
})

describe('deadline: the 20th of the previous month', () => {
  it('computes the deadline', () => {
    expect(requestDeadline('2026-11-01')).toBe('2026-10-20')
    expect(requestDeadline('2027-01-01')).toBe('2026-12-20')
  })
  it('is open up to and including the 20th', () => {
    expect(isRequestOpen('2026-11-01', '2026-10-20')).toBe(true)
    expect(isRequestOpen('2026-11-01', '2026-10-21')).toBe(false)
  })
})

describe('cells use the workbook wording', () => {
  it('早番 with 17:30', () => {
    expect(sheetCell('early', { early: 'full', early_until_1730: true })).toBe('出勤可（7-17）, 17:30まで勤務可')
    expect(sheetCell('early', { early: 'morning' })).toBe('7-11のみ可')
    expect(sheetCell('early', {})).toBe('')
  })
  it('中番 / 遅番', () => {
    expect(sheetCell('middle', { middle: 'from_1730' })).toBe('出勤可（17:30～）')
    expect(sheetCell('late', { late: 'from_2200' })).toBe('22:00出勤可')
    expect(sheetCell('late', undefined)).toBe('')
  })
})

describe('sheetRows', () => {
  const req = {
    name: '山田 太郎',
    email: 'y@example.com',
    submittedAt: '2026/10/20 10:00:00',
    shifts: ['early' as const],
    days: { '2026-11-02': { early: 'afternoon' as const } },
    answers: { ...EMPTY_ANSWERS, paidLeave: 'want' as const, paidLeaveDays: ['2026-11-04', '2026-11-03'], paidLeaveComment: '理由: 帰省', checkedNotice: true, checkedIrregular: true },
  }
  it('one column per person who requested the shift, rows like the sheet', () => {
    const rows = sheetRows('early', '2026-11-01', [req])
    expect(rows[0]).toEqual(['タイムスタンプ', '2026/10/20 10:00:00'])
    expect(rows[2]).toEqual(['名前', '山田 太郎'])
    expect(rows[3 + 1]).toEqual(['11月 [2日　(月)]', '11-17のみ可'])
    expect(rows.find((r) => r[0] === '有給希望')).toEqual(['有給希望', '有給休暇の取得を希望する'])
    expect(rows).toHaveLength(3 + 30 + 10)
    expect(sheetRows('late', '2026-11-01', [req])[0]).toEqual(['タイムスタンプ'])
  })
})

describe('validateRequest', () => {
  it('needs a shift, the dates for yes-answers and both confirmations', () => {
    expect(validateRequest([], EMPTY_ANSWERS)).toEqual(['shifts', 'checks'])
    expect(validateRequest(['late'], { ...EMPTY_ANSWERS, homeTrip: 'yes', resign: 'yes', checkedNotice: true, checkedIrregular: true })).toEqual([
      'homeTripWhen',
      'resignWhen',
    ])
    expect(validateRequest(['late'], { ...EMPTY_ANSWERS, checkedNotice: true, checkedIrregular: true })).toEqual([])
  })
})

describe('有給休暇の日', () => {
  it('runs of days, conflicts with 出勤できる日, validation', () => {
    expect(dateSpan('2026-11-05', '2026-11-03')).toEqual(['2026-11-03', '2026-11-04', '2026-11-05'])
    expect(formatDayRanges(['2026-11-14', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-20'])).toBe('11/3〜11/5、11/14、11/20')
    const days = { '2026-11-04': { early: 'full' as const }, '2026-11-05': { late: 'ok' as const } }
    expect(paidLeaveConflicts(['2026-11-03', '2026-11-04', '2026-11-05'], days, ['early'])).toEqual(['2026-11-04'])
    const base = { ...EMPTY_ANSWERS, checkedNotice: true, checkedIrregular: true, paidLeave: 'want' as const }
    expect(validateRequest(['early'], base, days)).toEqual(['paidLeaveDays'])
    expect(validateRequest(['early'], { ...base, paidLeaveDays: ['2026-11-04'] }, days)).toEqual(['paidLeaveConflict'])
    expect(validateRequest(['early'], { ...base, paidLeaveDays: ['2026-11-03'] }, days)).toEqual([])
  })
})

describe('学校の長期休暇期間', () => {
  it('a period over two months, with the pledge', () => {
    const base = { ...EMPTY_ANSWERS, checkedNotice: true, checkedIrregular: true, schoolHolidayHas: 'yes' as const }
    expect(validateRequest(['early'], base)).toEqual(['schoolHoliday', 'schoolPledge'])
    const ok = { ...base, schoolHolidayFrom: '2026-12-20', schoolHolidayTo: '2027-01-10', schoolHolidayPledge: true }
    expect(validateRequest(['early'], ok)).toEqual([])
    expect(formatPeriod('2026-12-20', '2027-01-10')).toBe('2026/12/20〜2027/1/10')
    expect(answerCells(ok)[5]).toBe('2026/12/20〜2027/1/10（誓約済み・証明書提出可）')
    expect(answerCells({ ...EMPTY_ANSWERS, schoolHoliday: '12/20〜1/10' })[5]).toBe('12/20〜1/10')
  })
})
