import { describe, expect, it } from 'vitest'
import { resources } from '../i18n'

// 管理 in all six languages (owner, 2026-10-19): every language has every key of ja, with the same {{placeholders}}.
type Tree = { [k: string]: string | Tree }
const flat = (t: Tree, p = ''): [string, string][] =>
  Object.entries(t).flatMap(([k, v]) => (typeof v === 'string' ? [[p + k, v] as [string, string]] : flat(v, `${p}${k}.`)))
const holes = (s: string) => (s.match(/\{\{\s*[\w.]+\s*\}\}/g) ?? []).sort()

describe('manager texts', () => {
  const ja = new Map(flat(resources.ja.manager as Tree))
  for (const lng of ['en', 'vi', 'ne', 'si', 'my'] as const) {
    it(`${lng} has every key with the same placeholders`, () => {
      const other = new Map(flat(resources[lng].manager as Tree))
      expect([...other.keys()].sort()).toEqual([...ja.keys()].sort())
      const wrong = [...ja].filter(([k, v]) => holes(other.get(k)!).join() !== holes(v).join()).map(([k]) => k)
      expect(wrong).toEqual([])
    })
  }
})
