import { describe, expect, it } from 'vitest'
import { learnText, matchesSearch, sortItems, youtubeId, type LearnItem } from './learn'

const ID = 'dQw4w9WgXcQ'

describe('youtubeId', () => {
  it('reads the usual link forms', () => {
    for (const url of [
      `https://youtu.be/${ID}`,
      `https://youtu.be/${ID}?si=abc`,
      `https://www.youtube.com/watch?v=${ID}&t=10s`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://youtube.com/shorts/${ID}`,
      `https://www.youtube.com/embed/${ID}`,
      `https://www.youtube.com/live/${ID}?feature=share`,
      ` https://youtu.be/${ID} `,
    ]) {
      expect(youtubeId(url), url).toBe(ID)
    }
  })
  it('refuses other sites and broken ids', () => {
    expect(youtubeId('https://example.com/watch?v=' + ID)).toBeNull()
    expect(youtubeId('https://youtu.be/short')).toBeNull()
    expect(youtubeId('not a link')).toBeNull()
    expect(youtubeId(null)).toBeNull()
  })
})

const item = (over: Partial<LearnItem> = {}): LearnItem => ({
  id: '1',
  kind: 'manual',
  category: 'service',
  title: 'お見送り',
  summary: 'お客様が帰るとき',
  steps: [
    { text: '「おおきに」と言う', image: null },
    { text: '笑顔で見送る', image: 'a/b.jpg' },
  ],
  mistakes: '声が小さい',
  video_url: null,
  translations: { vi: { title: 'Tiễn khách', summary: 'Khi khách về', steps: ['Nói 「おおきに」'], mistakes: 'Nói nhỏ' } },
  translated_at: '2026-10-14T03:00:00+00:00',
  content_updated_at: '2026-10-14T02:00:00+00:00',
  recommended: false,
  published: true,
  sort_order: 0,
  updated_at: '2026-10-14T03:00:00+00:00',
  ...over,
})

describe('learnText', () => {
  it('uses a fresh translation; a missing step falls back to Japanese', () => {
    const t = learnText(item(), 'vi')
    expect(t).toMatchObject({ title: 'Tiễn khách', translated: true })
    expect(t.steps).toEqual(['Nói 「おおきに」', '笑顔で見送る'])
  })
  it('shows Japanese when the Japanese changed after the translation, or when asked', () => {
    expect(learnText(item({ content_updated_at: '2026-10-14T04:00:00+00:00' }), 'vi')).toMatchObject({ title: 'お見送り', translated: false })
    expect(learnText(item(), 'vi', true)).toMatchObject({ title: 'お見送り', translated: false })
    expect(learnText(item(), 'ne')).toMatchObject({ title: 'お見送り', translated: false })
    expect(learnText(item(), 'ja').translated).toBe(false)
  })
})

describe('matchesSearch / sortItems', () => {
  it('finds the shown text and the Japanese', () => {
    const it = item()
    const shown = learnText(it, 'vi')
    expect(matchesSearch(it, shown, 'tiễn')).toBe(true)
    expect(matchesSearch(it, shown, 'おおきに')).toBe(true)
    expect(matchesSearch(it, shown, '券売機')).toBe(false)
  })
  it('puts recommended first, then the order number', () => {
    const xs = sortItems([item({ id: 'a', sort_order: 2 }), item({ id: 'b', recommended: true, sort_order: 9 }), item({ id: 'c', sort_order: 1 })])
    expect(xs.map((x) => x.id)).toEqual(['b', 'c', 'a'])
  })
})
