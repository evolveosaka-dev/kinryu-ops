import { describe, expect, it } from 'vitest'
import { familyName } from './format'

describe('familyName', () => {
  it.each([
    ['山田 太郎', '', '山田'],
    ['山田　太郎', '', '山田'], // full-width space
    ['NGUYEN VAN AN', '', 'Nguyen'],
    ['Perera Kasun', '', 'Perera'],
    [null, 'タナカ', 'タナカ'],
    ['', '', '?'],
  ])('%s → %s', (full, fallback, expected) => expect(familyName(full, fallback)).toBe(expected))
})
