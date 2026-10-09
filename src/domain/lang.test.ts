import { describe, expect, it } from 'vitest'
import { needsTranslation } from './lang'

describe('needsTranslation', () => {
  it.each([
    ['スープの線が少なかった', false],
    ['大丈夫', false],
    ['120杯', false],
    ['', false],
    ['   ', false],
    ['ネギ ok', false], // contains kana → already Japanese
    ['Súp ít hơn vạch mẫu', true],
    ['Loud and clear greeting', true],
    ['හඬ හොඳින් ඇසුණා', true],
    ['आवाज ठूलो र स्पष्ट', true],
  ])('%s → %s', (text, expected) => expect(needsTranslation(text)).toBe(expected))
})
