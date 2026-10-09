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

/**
 * Family name (姓) for the header: the first part of the full name, which is entered in
 * residence-card order (surname first). ALL-CAPS Latin names are shown as "Nguyen".
 */
export function familyName(fullName: string | null | undefined, fallback = ''): string {
  const first = (fullName ?? '').trim().split(/\s+/)[0] ?? ''
  if (!first) return fallback.trim() || '?'
  return /^[A-Z][A-Z'-]+$/.test(first) ? first.charAt(0) + first.slice(1).toLowerCase() : first
}
