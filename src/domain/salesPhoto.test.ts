import { describe, expect, it } from 'vitest'
import { normTime, photoToReport, slotMismatch, type SalesPhotoRead } from './salesPhoto'

// shaped like the 千日前 早番 sheet of 2025-09-12 (names changed)
const read = (patch: Partial<SalesPhotoRead> = {}): SalesPhotoRead => ({
  store: 'sennichimae',
  date: '2025-09-12',
  shift: 'early',
  tickets: { ramen: 154, chashu: 26, coupon: 0, total: 180 },
  calc_time: '16:30',
  calculator: 'A',
  calc_text: '180-(180-0-0)=0',
  noodle_diff: 0,
  meals: [],
  other_out: [],
  staff: [
    { written: 'テ', roster_name: 'テー', start: '7:00', end: '11:00' },
    { written: 'ケイ', roster_name: 'ケイ', start: '11:00', end: '17:00' },
  ],
  cash_book: [],
  cash_counts: { '10000': null, '5000': 1, '2000': null, '1000': 11, '500': 7, '100': 52, '50': null, '10': null, '5': null, '1': null },
  cash_actual_total: 24700,
  cash_carried: 24700,
  cash_in: 0,
  cash_out: 0,
  cash_expected: 24700,
  cash_diff: 0,
  cash_calculator: 'A',
  water: [
    { hour: '07', value: '5903' },
    { hour: '17', value: '5915' },
  ],
  notes: null,
  unsure: [],
  note: null,
  ...patch,
})
const plan = [
  { roster_name: 'テー', start_min: 420, end_min: 660 },
  { roster_name: 'ケイ', start_min: 660, end_min: 1020 },
]

describe('販売日報 from a photo', () => {
  it('fills tickets, staff, counts, 繰越 (no previous report) and the meter', () => {
    const { report, flags } = photoToReport(read(), null, { shift: 'early' }, plan, null)
    expect(report.tickets).toEqual({ ramen: 154, chashu: 26, coupon: 0 })
    expect(report.staff.map((s) => `${s.name} ${s.start}-${s.end}`)).toEqual(['テー 07:00-11:00', 'ケイ 11:00-17:00'])
    expect(report.cash_counts).toEqual({ '5000': 1, '1000': 11, '500': 7, '100': 52 })
    expect(report.cash_carried).toBe(24700)
    expect(report.cash_carried_manual).toBe(true)
    expect(report.water).toEqual({ '07:00': '5903', '17:00': '5915' })
    expect(flags).toEqual([])
  })

  it('points out what does not fit', () => {
    const r = read({
      tickets: { ramen: 154, chashu: 26, coupon: 0, total: 181 },
      staff: [{ written: 'ド', roster_name: null, start: '7:00', end: '11:00' }, { written: 'ケイ', roster_name: 'ケイ', start: '11:00', end: '17:30' }],
      cash_counts: { '10000': null, '5000': 1, '2000': null, '1000': null, '500': 7, '100': 52, '50': null, '10': null, '5': null, '1': null },
      water: [{ hour: '11', value: '5910' }],
      other_out: [{ name: 'ケイ', time: '12:00', qty: 1, detail: '落とした' }],
    })
    const { report, flags } = photoToReport(r, null, { shift: 'early' }, plan, 24000)
    expect(flags.map((f) => f.kind)).toEqual(['ticketTotal', 'staffUnknown', 'staffTime', 'staffNotOnPaper', 'countsTotal', 'carried', 'waterHour', 'otherOut'])
    // the person planned but not on the paper stays, to be marked 欠勤 if so
    expect(report.staff.map((s) => s.name)).toEqual(['ド', 'ケイ', 'テー'])
    // with a previous report the app's 繰越 is used
    expect(report.cash_carried_manual).toBe(false)
  })

  it('only the total, without counts per denomination', () => {
    const empty = Object.fromEntries(['10000', '5000', '2000', '1000', '500', '100', '50', '10', '5', '1'].map((d) => [d, null]))
    const { report, flags } = photoToReport(read({ cash_counts: empty, cash_actual_total: 21200 }), null, { shift: 'early' }, plan, null)
    expect(report.cash_counts).toEqual({})
    expect(flags).toContainEqual({ kind: 'countsMissing', total: 21200 })
  })

  it('photo of another slot', () => {
    expect(slotMismatch(read(), { storeCode: 'midosuji', date: '2025-09-12', shift: 'early' })).toEqual({ kind: 'slot', store: 'sennichimae', date: null, shift: null })
    expect(slotMismatch(read({ date: null, shift: 'unknown' }), { storeCode: 'sennichimae', date: '2026-10-16', shift: 'late' })).toBeNull()
  })

  it('times', () => {
    expect(normTime('7:00')).toBe('07:00')
    expect(normTime('１７：３０')).toBe('17:30')
    expect(normTime('7時')).toBeNull()
  })
})
