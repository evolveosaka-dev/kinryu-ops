import { describe, expect, it } from 'vitest'
import { attendanceScores, gradeOf, labelOf, type AttendanceEvent } from './attendance'
import { coverCandidates, coverProblemOf, leaveOptions, maxRollingWeek, noticeMinutes, reasonsFor, reportable, visaRuns } from './shiftChange'

const a = (roster_name: string, business_date: string, shift: 'early' | 'middle' | 'late', start_min: number, end_min: number) => ({
  roster_name,
  business_date,
  shift,
  store_mark: '⑤',
  start_min,
  end_min,
})
const jst = (s: string) => new Date(`${s}+09:00`)

describe('休み連絡', () => {
  it('reasons: 店の都合 for managers, no 有給 (requested with シフト希望)', () => {
    expect(reasonsFor('absence', false)).toEqual(['sick', 'family', 'transport', 'personal', 'other'])
    expect(reasonsFor('late', true)).toEqual(['sick', 'family', 'transport', 'personal', 'store', 'other'])
  })
  it('reportable shifts: not over, within the window, in order', () => {
    const xs = [a('A', '2026-10-20', 'early', 420, 1020), a('A', '2026-10-14', 'late', 1380, 1860), a('A', '2026-10-13', 'early', 420, 1020)]
    expect(reportable(xs, jst('2026-10-15T02:00:00')).map((x) => x.business_date)).toEqual(['2026-10-14', '2026-10-20'])
    expect(reportable(xs, jst('2026-10-15T02:00:00'), 3).map((x) => x.business_date)).toEqual(['2026-10-14'])
  })
  it('early-leave times every 30 min; notice in minutes', () => {
    expect(leaveOptions({ start_min: 1020, end_min: 1170 })).toEqual([1050, 1080, 1110, 1140])
    expect(noticeMinutes(a('A', '2026-10-15', 'early', 420, 1020), jst('2026-10-15T05:00:00'))).toBe(120)
    expect(noticeMinutes(a('A', '2026-10-15', 'early', 420, 1020), jst('2026-10-15T07:20:00'))).toBe(-20)
  })
  it('replacement candidates: conflicts, 12 h in a row, weekly limit', () => {
    const change = { kind: 'absence' as const, roster_name: 'A', business_date: '2026-10-15', shift: 'middle' as const, store_mark: '⑤', start_min: 1020, end_min: 1380, leave_min: null }
    const rows = [
      a('A', '2026-10-15', 'middle', 1020, 1380),
      a('B', '2026-10-15', 'middle', 1020, 1380), // already there
      a('C', '2026-10-15', 'late', 1380, 1860), // 中番+遅番 = 14 h
      a('D', '2026-10-13', 'early', 420, 1020), // 10 h this week, limit 15 h
      a('D', '2026-10-17', 'early', 420, 720),
    ]
    const out = coverCandidates(change, rows, ['A', 'B', 'C', 'D', 'E'], new Map([['D', 15 * 60]]))
    expect(out.map((c) => c.name)).toEqual(['E', 'C', 'D', 'B'])
    expect(out.find((c) => c.name === 'C')).toMatchObject({ conflict: false, chainMin: 840 })
    expect(out.find((c) => c.name === 'D')).toMatchObject({ weekMin: 1260, overLimit: true })
    expect(out.find((c) => c.name === 'B')!.conflict).toBe(true)
  })
  it('7 days in a row (not Mon–Sun): the worst window around the date', () => {
    // Sat 10/17 … Fri 10/23: 5 h each on 10/17, 10/18 (weekend) and 10/19–10/21 → 25 h in 10/17–10/23
    const xs = ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21'].map((d) => a('A', d, 'early', 420, 720))
    expect(maxRollingWeek(xs, '2026-10-19')).toBe(25 * 60)
    expect(maxRollingWeek(xs, '2026-10-12')).toBe(10 * 60) // 10/12–10/18 has 10/17 and 10/18
  })
  it('runs of windows over 28 h', () => {
    const w = (name: string, from: string, minutes: number) => ({ roster_name: name, visa: 'student' as const, window_from: from, window_to: from, minutes })
    const fix = (x: ReturnType<typeof w>) => ({ ...x, window_to: new Date(Date.parse(`${x.window_from}T00:00:00Z`) + 6 * 86400_000).toISOString().slice(0, 10) })
    const runs = visaRuns([w('A', '2026-10-13', 1700), w('A', '2026-10-14', 1800), w('A', '2026-10-15', 1600), w('A', '2026-10-25', 1700), w('B', '2026-10-13', 1680)].map(fix))
    expect(runs).toEqual([
      { name: 'A', visa: 'student', from: '2026-10-13', to: '2026-10-20', maxMin: 1800 },
      { name: 'A', visa: 'student', from: '2026-10-25', to: '2026-10-31', maxMin: 1700 },
    ])
  })
  it('早退: the replacement only needs the rest of the shift', () => {
    const change = { kind: 'early_leave' as const, roster_name: 'A', business_date: '2026-10-15', shift: 'middle' as const, store_mark: '⑤', start_min: 1020, end_min: 1380, leave_min: 1200 }
    const [c] = coverCandidates(change, [a('B', '2026-10-15', 'middle', 1020, 1200)], ['B'], new Map())
    expect(c).toMatchObject({ conflict: false, chainMin: 360 })
  })
})

const ev = (name: string, kind: AttendanceEvent['kind'], points: number, extra: Partial<AttendanceEvent> = {}): AttendanceEvent => ({
  event_key: `${name}-${kind}-${points}-${Math.random()}`,
  roster_name: name,
  business_date: '2026-10-15',
  shift: 'early',
  kind,
  reason: null,
  minutes: null,
  notice_min: null,
  reported: true,
  base_points: points,
  points,
  excluded: false,
  note: null,
  ...extra,
})

describe('出勤評価', () => {
  it('grades', () => {
    expect([100, 95, 94, 85, 84, 70, 69].map(gradeOf)).toEqual(['A', 'A', 'B', 'B', 'C', 'C', 'D'])
  })
  it('labels', () => {
    expect(labelOf(ev('A', 'absence', -10))).toBe('noShow')
    expect(labelOf(ev('A', 'absence', -5))).toBe('sameDay')
    expect(labelOf(ev('A', 'absence', -1))).toBe('advance')
    expect(labelOf(ev('A', 'absence', 0, { reason: 'store' }))).toBe('advance')
  })
  it('the proposal examples: 山田 A, 佐藤 B, トラン C', () => {
    const events = [
      ev('山田', 'late', -1),
      ev('山田', 'late', -1),
      ev('山田', 'cover', 2),
      ev('佐藤', 'absence', -3),
      ev('佐藤', 'absence', -5),
      ev('佐藤', 'late', -2),
      ev('トラン', 'absence', -10),
      ev('トラン', 'late', -3),
      ev('トラン', 'late', -3),
      ev('トラン', 'late', -3),
    ]
    const s = attendanceScores(events, ['新人'])
    expect(s.map((p) => [p.name, p.score, p.grade])).toEqual([
      ['トラン', 81, 'C'],
      ['佐藤', 90, 'B'],
      ['山田', 100, 'A'],
      ['新人', 100, 'A'],
    ])
    expect(s[0]).toMatchObject({ interview: true, urgent: false })
    expect(s[0]!.counts).toMatchObject({ noShow: 1, late: 3 })
  })
  it('capped at 100; two 無断欠勤 are urgent; excluded events do not count', () => {
    const s = attendanceScores([ev('A', 'perfect', 3), ev('B', 'absence', -10), ev('B', 'absence', -10), ev('C', 'absence', 0, { base_points: -10, excluded: true })])
    expect(s.find((p) => p.name === 'A')!.score).toBe(100)
    expect(s.find((p) => p.name === 'B')).toMatchObject({ score: 80, urgent: true })
    expect(s.find((p) => p.name === 'C')).toMatchObject({ score: 100, counts: expect.objectContaining({ noShow: 0 }) })
  })
})

describe('cover problems from the server', () => {
  it('parses cover_problem:{json}', () => {
    const err = new Error('cover_problem:{"name": "キタ", "problem": "visa", "minutes": 2040, "from": "2026-10-20", "to": "2026-10-26"}')
    expect(coverProblemOf(err)).toEqual({ name: 'キタ', problem: 'visa', minutes: 2040, from: '2026-10-20', to: '2026-10-26' })
    expect(coverProblemOf({ message: 'cover_problem:{"name":"A","problem":"busy"}' })).toEqual({ name: 'A', problem: 'busy' })
    expect(coverProblemOf(new Error('not open'))).toBeNull()
  })
})
