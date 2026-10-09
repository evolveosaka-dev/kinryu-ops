import { describe, expect, it } from 'vitest'
import { ALL_STEPS_DONE } from './types'
import {
  actionItems,
  choreiPeople,
  choreiSlots,
  completion,
  itemAverages,
  patrolHours,
  patrolSummary,
  skippedSteps,
  slotDue,
  staffRanking,
  weekStart,
  weeklyTrend,
  type StatChorei,
  type StatPatrol,
} from './stats'

const jst = (s: string) => new Date(`${s}+09:00`)

let n = 0
const patrol = (p: Partial<StatPatrol>): StatPatrol => ({
  id: `p${n++}`,
  patroller_id: 'u1',
  store_id: 'M',
  business_date: '2026-10-12',
  shift: 'early',
  patrol_type: 'in_shift',
  started_at: '',
  ended_at: '',
  score_smile: 4,
  score_voice: 4,
  score_grooming: 4,
  score_clean: 4,
  score_quality: 4,
  total: 20,
  max_total: 25,
  judgement: 'good',
  duration_min: 12,
  needs_time_review: false,
  mask_worn: false,
  staff_names: [],
  follow_up_done_at: null,
  status: 'valid',
  ...p,
})
const chorei = (c: Partial<StatChorei>): StatChorei => ({
  id: `c${n++}`,
  store_id: 'M',
  business_date: '2026-10-12',
  shift: 'early',
  leader_id: 'u1',
  participants_extra: [],
  steps_done: ALL_STEPS_DONE,
  skip_reason: null,
  status: 'valid',
  ...c,
})

describe('weeks and slots', () => {
  it('weeks start on Monday', () => {
    expect(weekStart('2026-10-12')).toBe('2026-10-12') // Mon
    expect(weekStart('2026-10-18')).toBe('2026-10-12') // Sun
    expect(weekStart('2026-10-19')).toBe('2026-10-19')
  })
  it('a slot is due 30 min after the meeting time', () => {
    expect(slotDue('2026-10-12', 'middle', jst('2026-10-12T17:29:00'))).toBe(false)
    expect(slotDue('2026-10-12', 'middle', jst('2026-10-12T17:30:00'))).toBe(true)
    expect(slotDue('2026-10-11', 'late', jst('2026-10-12T01:00:00'))).toBe(true)
  })
  it('completion counts only due slots', () => {
    const slots = choreiSlots([chorei({})], ['2026-10-12'], ['M', 'S'], jst('2026-10-12T18:00:00'))
    expect(slots).toHaveLength(6)
    // due: early M (done), early S, middle M, middle S → 1/4
    expect(completion(slots)).toEqual({ done: 1, due: 4, rate: 25 })
  })
})

describe('patrol aggregation', () => {
  const ps = [
    patrol({ total: 20, max_total: 25, judgement: 'good', staff_names: ['A', 'B'] }),
    patrol({ total: 12, max_total: 20, score_quality: null, judgement: 'improve', staff_names: ['A'], mask_worn: true }),
    patrol({ total: 10, max_total: 25, judgement: 'coaching', staff_names: [] }),
    patrol({ total: 25, status: 'void' }),
    patrol({ total: null, max_total: null, status: 'draft', needs_time_review: true }),
  ]
  it('summary uses the 25-point scale and ignores void/drafts', () => {
    expect(patrolSummary(ps)).toEqual({ count: 3, average: 15, good: 1, improve: 1, coaching: 1, mask: 1 })
  })
  it('item averages skip unchecked quality', () => {
    expect(itemAverages(ps).find((i) => i.key === 'score_quality')).toEqual({ key: 'score_quality', count: 2, average: 4 })
  })
  it('ranks staff by the average of the patrols they were listed in', () => {
    expect(staffRanking(ps)).toEqual([
      { name: 'B', count: 1, average: 20, best: 20, worst: 20, rank: 1 },
      { name: 'A', count: 2, average: 17.5, best: 20, worst: 15, rank: 2 },
    ])
  })
  it('ties share a rank', () => {
    const r = staffRanking([patrol({ staff_names: ['X', 'Y'] }), patrol({ total: 10, staff_names: ['Z'] })])
    expect(r.map((x) => [x.name, x.rank])).toEqual([
      ['X', 1],
      ['Y', 1],
      ['Z', 3],
    ])
  })
  it('action items: open coaching and time reviews', () => {
    const a = actionItems([...ps, patrol({ judgement: 'coaching', follow_up_done_at: '2026-10-12T10:00:00Z' })])
    expect(a.coaching).toHaveLength(1)
    expect(a.timeReview).toHaveLength(1)
  })
  it('patrol hours per patroller', () => {
    const h = patrolHours([patrol({ duration_min: 12 }), patrol({ duration_min: 18, patrol_type: 'random', needs_time_review: true }), patrol({ patroller_id: 'u2' })])
    expect(h.find((x) => x.patrollerId === 'u1')).toMatchObject({ count: 2, minutes: 30, over: 1, review: 1, byType: { in_shift: 1, random: 1 } })
  })
  it('weekly trend', () => {
    const w = weeklyTrend([patrol({}), patrol({ business_date: '2026-10-19', total: 15 })], [], '2026-10-12', '2026-10-25', ['M'], jst('2026-10-26T12:00:00'))
    expect(w.map((x) => [x.week, x.count, x.average, x.chorei.due])).toEqual([
      ['2026-10-12', 1, 20, 21],
      ['2026-10-19', 1, 15, 21],
    ])
  })
})

describe('朝礼 aggregation', () => {
  const rs = [
    chorei({ leader_id: 'u1', participants_extra: ['A', 'B'] }),
    chorei({ leader_id: 'u2', participants_extra: ['A'], steps_done: { ...ALL_STEPS_DONE, grooming: false }, skip_reason: '混雑' }),
    chorei({ leader_id: 'u1', status: 'void' }),
  ]
  it('counts leaders and participants', () => {
    const p = choreiPeople(rs, (id) => (id === 'u1' ? '山田' : '佐藤'))
    expect(p.leaders).toEqual([
      { name: '佐藤', count: 1 },
      { name: '山田', count: 1 },
    ])
    expect(p.participants).toEqual([
      { name: 'A', count: 2 },
      { name: 'B', count: 1 },
    ])
  })
  it('skipped steps with reasons', () => {
    expect(skippedSteps(rs).find((s) => s.step === 'grooming')).toEqual({ step: 'grooming', count: 1, reasons: ['混雑'] })
  })
})
