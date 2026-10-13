// 学ぶ: 仕事のマニュアル and 見本動画 written by managers (table learn_items).
import type { Locale } from './types'

export const LEARN_KINDS = ['manual', 'video'] as const
export type LearnKind = (typeof LEARN_KINDS)[number]

export const LEARN_CATEGORIES = ['shift', 'position', 'service', 'trouble', 'hygiene', 'other'] as const
export type LearnCategory = (typeof LEARN_CATEGORIES)[number]

export const CATEGORY_ICON: Record<LearnCategory, string> = {
  shift: '🕒',
  position: '🍜',
  service: '😊',
  trouble: '🆘',
  hygiene: '🧽',
  other: '📌',
}

export const MAX_STEPS = 30

export interface LearnStep {
  text: string
  /** path in the Storage bucket "learn" */
  image: string | null
}

export interface LearnText {
  title: string
  summary: string
  steps: string[]
  mistakes: string
}

export interface LearnItem {
  id: string
  kind: LearnKind
  category: LearnCategory
  title: string
  summary: string | null
  steps: LearnStep[]
  mistakes: string | null
  video_url: string | null
  translations: Partial<Record<Locale, LearnText>>
  translated_at: string | null
  content_updated_at: string
  recommended: boolean
  published: boolean
  sort_order: number
  updated_at: string
}

/** YouTube video id from the usual link forms (watch?v=, youtu.be/, shorts/, embed/, live/), else null. */
export function youtubeId(url: string | null | undefined): string | null {
  if (!url) return null
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return null
  }
  const host = u.hostname.replace(/^(www|m|music)\./, '')
  let id: string | null = null
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0] ?? null
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = u.searchParams.get('v') ?? /^\/(?:shorts|embed|live)\/([^/?#]+)/.exec(u.pathname)?.[1] ?? null
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null
}

export const youtubeEmbed = (id: string, locale: Locale) =>
  `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1&cc_load_policy=1&cc_lang_pref=${locale}&hl=${locale}`

export const youtubeThumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

/** The text to show: the translation when it is newer than the Japanese, else the Japanese (translated = false). */
export function learnText(item: LearnItem, locale: Locale, forceJa = false): LearnText & { translated: boolean } {
  const ja: LearnText = {
    title: item.title,
    summary: item.summary ?? '',
    steps: item.steps.map((s) => s.text),
    mistakes: item.mistakes ?? '',
  }
  const tr = item.translations[locale]
  const fresh = Boolean(tr && item.translated_at && Date.parse(item.translated_at) >= Date.parse(item.content_updated_at))
  if (locale === 'ja' || forceJa || !tr || !fresh) return { ...ja, translated: false }
  return { ...tr, steps: ja.steps.map((s, i) => tr.steps[i] ?? s), translated: true }
}

/** Search over the shown text and the Japanese. */
export function matchesSearch(item: LearnItem, shown: LearnText, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const hay = [shown.title, shown.summary, shown.mistakes, ...shown.steps, item.title, item.summary ?? '', item.mistakes ?? '', ...item.steps.map((s) => s.text)]
  return hay.some((h) => h.toLowerCase().includes(q))
}

/** Recommended first, then sort_order, then title (Japanese). */
export const sortItems = (xs: LearnItem[]) =>
  [...xs].sort((a, b) => Number(b.recommended) - Number(a.recommended) || a.sort_order - b.sort_order || a.title.localeCompare(b.title, 'ja'))
