import { describe, expect, it } from 'vitest'
import { GENKO_STEPS, parseRuby, plainJa } from './genko'
import { CHOREI_STEPS } from './types'

describe('parseRuby', () => {
  it('splits furigana marks', () => {
    expect(parseRuby('これから{朝礼|ちょうれい}を{始|はじ}めます')).toEqual([
      { text: 'これから' },
      { text: '朝礼', reading: 'ちょうれい' },
      { text: 'を' },
      { text: '始', reading: 'はじ' },
      { text: 'めます' },
    ])
  })
  it('plainJa removes readings', () => {
    expect(plainJa('{一|ひとつ}、お{客様|きゃくさま}{第一|だいいち}！')).toBe('一、お客様第一！')
  })
})

describe('GENKO_STEPS', () => {
  it('follows the 6 steps of the 朝礼 record, in order', () => {
    expect(GENKO_STEPS.map((s) => s.id)).toEqual([...CHOREI_STEPS])
  })
  it('takes about 4–5 minutes', () => {
    const total = GENKO_STEPS.reduce((s, x) => s + (x.seconds ?? 0), 0)
    expect(total).toBe(255)
  })
})
