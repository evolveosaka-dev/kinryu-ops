import { describe, expect, it } from 'vitest'
import { patrolCompletion, patrolSlots, slotClosed, type GridDuty, type GridPatrol } from './patrolGrid'

const p = (over: Partial<GridPatrol>): GridPatrol => ({ id: 'p', store_id: 's', business_date: '2026-10-13', shift: 'late', status: 'valid', total: 21, max_total: 25, judgement: 'good', ...over })
const duty = (over: Partial<GridDuty>): GridDuty => ({ business_date: '2026-10-13', shift: 'late', store_id: 's', roster_name: 'A', ...over })

describe('slotClosed', () => {
  it('shift end + 1 h (遅番 ends the next morning)', () => {
    expect(slotClosed('2026-10-13', 'early', new Date('2026-10-13T17:59:00+09:00'))).toBe(false)
    expect(slotClosed('2026-10-13', 'early', new Date('2026-10-13T18:00:00+09:00'))).toBe(true)
    expect(slotClosed('2026-10-13', 'middle', new Date('2026-10-13T23:30:00+09:00'))).toBe(false)
    expect(slotClosed('2026-10-13', 'middle', new Date('2026-10-14T00:00:00+09:00'))).toBe(true)
    expect(slotClosed('2026-10-13', 'late', new Date('2026-10-14T07:30:00+09:00'))).toBe(false)
    expect(slotClosed('2026-10-13', 'late', new Date('2026-10-14T08:00:00+09:00'))).toBe(true)
  })
})

describe('patrolSlots', () => {
  const now = new Date('2026-10-14T12:00:00+09:00')
  it('done / in progress / missed duty / planned duty / nothing', () => {
    const slots = patrolSlots(
      ['2026-10-13', '2026-10-14'],
      ['s'],
      [p({}), p({ id: 'd', business_date: '2026-10-13', shift: 'early', status: 'draft' }), p({ id: 'v', shift: 'middle', status: 'void' })],
      [duty({}), duty({ shift: 'middle' }), duty({ business_date: '2026-10-14', shift: 'middle' })],
      now,
    )
    const st = (d: string, s: string) => slots.find((x) => x.date === d && x.shift === s)!.state
    expect(st('2026-10-13', 'late')).toBe('done')
    expect(st('2026-10-13', 'early')).toBe('progress')
    expect(st('2026-10-13', 'middle')).toBe('missed') // void patrol does not count
    expect(st('2026-10-14', 'middle')).toBe('planned')
    expect(st('2026-10-14', 'early')).toBe('none')
    expect(patrolCompletion(slots)).toEqual({ done: 1, due: 2, rate: 50, missed: 1, extra: 0 })
  })
})
