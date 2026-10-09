import type { Store } from './types'
import type { Locale } from '../domain/types'

export function storeName(store: Pick<Store, 'name_ja' | 'name_en'> | undefined, locale: Locale): string {
  if (!store) return '—'
  return locale === 'ja' ? store.name_ja : `${store.name_en}（${store.name_ja}）`
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function isNetworkError(err: unknown): boolean {
  const m = errorMessage(err)
  return /Failed to fetch|NetworkError|Load failed|network/i.test(m) || (typeof navigator !== 'undefined' && !navigator.onLine)
}

/** Two letters for the avatar (people's names are never translated). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return (parts.length > 1 ? parts[0]!.charAt(0) + parts[1]!.charAt(0) : name.trim().slice(0, 2)).toUpperCase() || '?'
}
