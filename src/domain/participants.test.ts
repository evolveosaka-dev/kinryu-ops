import { describe, expect, it } from 'vitest'
import { checkParticipants } from './participants'

const early = [
  { roster_name: 'A', start_min: 420, end_min: 660 }, // 7–11
  { roster_name: 'B', start_min: 420, end_min: 1020 }, // 7–17
  { roster_name: 'L', start_min: 420, end_min: 1020 }, // the leader
  { roster_name: 'C', start_min: 660, end_min: 1020 }, // 11–17: not at the 7:00 meeting
]

describe('checkParticipants', () => {
  it('everything matches (the leader counts as present; later starters are not expected)', () => {
    expect(checkParticipants('early', ['A', 'B'], ['L'], early)).toBeNull()
  })
  it('lists who is missing and who is not scheduled', () => {
    const c = checkParticipants('early', ['A', 'X'], ['L'], early)!
    expect(c.missing).toEqual(['B'])
    expect(c.extra).toEqual(['X'])
    expect(c.atMeeting.map((s) => [s.roster_name, s.present, s.leader])).toEqual([['A', true, false], ['B', false, false], ['L', true, true]])
    expect(c.later.map((s) => s.roster_name)).toEqual(['C'])
  })
  it('a later starter who came early is not "extra"; no shift table → no check', () => {
    expect(checkParticipants('early', ['A', 'B', 'C'], ['L'], early)).toBeNull()
    expect(checkParticipants('early', ['X'], ['L'], [])).toBeNull()
  })
  it('遅番 23:00 meeting', () => {
    const late = [{ roster_name: 'N', start_min: 1380, end_min: 1860 }]
    expect(checkParticipants('late', [], ['L'], late)!.missing).toEqual(['N'])
  })
})
