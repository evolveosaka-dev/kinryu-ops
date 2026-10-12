import { describe, expect, it } from 'vitest'
import { needsTranslation } from './lang'

describe('needsTranslation', () => {
  it.each([
    ['スープの線が少なかった', false],
    ['大丈夫', false],
    ['120杯', false],
    ['', false],
    ['   ', false],
    ['ネギ ok', false], // one loanword in Japanese
    ['QRコードで支払い', false],
    ['海外のお客様には『Thank you』も言いましょう。', false], // quoted phrase
    ['2×3列のテーブル', false],
    ['『Thank you』', true], // nothing Japanese around the quote
    ['良く声が出ていた', false],
    ['Everyone says いらっシャイwithin 3seconds\nCounters and tables are clean', true], // mixed
    ['いらっしゃいが小さい. Need louder', true],
    ['Clean', true],
    ['tốt', true],
    ['ok いいです xin chào', true],
    ['Súp ít hơn vạch mẫu', true],
    ['Loud and clear greeting', true],
    ['හඬ හොඳින් ඇසුණා', true],
    ['आवाज ठूलो र स्पष्ट', true],
  ])('%s → %s', (text, expected) => expect(needsTranslation(text)).toBe(expected))
})
