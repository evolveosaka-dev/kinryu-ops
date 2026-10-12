import { describe, expect, it } from 'vitest'
import { escalationStep, ESCALATION_STEPS, keepStaff, tagsByStaff, toggleTag } from './issues'

describe('issue tags', () => {
  it('toggles a tag on and off', () => {
    const one = toggleTag([], { staff: 'カン', category: 'voice' })
    expect(one).toEqual([{ staff: 'カン', category: 'voice' }])
    expect(toggleTag(one, { staff: 'カン', category: 'voice' })).toEqual([])
  })

  it('drops tags of people no longer on shift', () => {
    expect(keepStaff([{ staff: 'カン', category: 'voice' }, { staff: 'ド', category: 'clean' }], ['ド'])).toEqual([{ staff: 'ド', category: 'clean' }])
  })

  it('groups per person in category order', () => {
    expect(
      tagsByStaff([
        { staff: 'カン', category: 'clean' },
        { staff: 'ド', category: 'smile' },
        { staff: 'カン', category: 'smile' },
      ]),
    ).toEqual([
      ['カン', ['smile', 'clean']],
      ['ド', ['smile']],
    ])
  })

  it('escalation step follows the number of 面談, capped at the last step', () => {
    expect(escalationStep(1)).toBe(ESCALATION_STEPS[0])
    expect(escalationStep(2)).toBe(ESCALATION_STEPS[1])
    expect(escalationStep(9)).toBe(ESCALATION_STEPS[ESCALATION_STEPS.length - 1])
  })
})
