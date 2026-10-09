import { FunctionsHttpError } from '@supabase/supabase-js'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { needsTranslation } from '../../domain/lang'
import { currentLocale } from '../../i18n'
import { isNetworkError } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { TranslationReview, type ReviewItem } from './TranslationReview'

export interface GateField {
  key: string
  label: string
  text: string | null
}

export interface GateResult {
  /** final value per key (Japanese for translated fields, unchanged otherwise) */
  values: Record<string, string | null>
  /** originals of the translated fields, or null when nothing was translated */
  originals: Record<string, string> | null
  sourceLang: string | null
}

export class TranslationCancelled extends Error {
  constructor() {
    super('cancelled')
  }
}

interface Pending {
  items: ReviewItem[]
  sourceLang: string
  resolve: (r: Record<string, string> | null) => void
}

/**
 * Before saving: translate non-Japanese free text with the `translate` Edge Function and let the
 * writer confirm (and edit) the Japanese. Resolves immediately when everything is Japanese.
 */
export function useTranslationGate() {
  const { t } = useTranslation()
  const [pending, setPending] = useState<Pending | null>(null)
  const pendingRef = useRef<Pending | null>(null)

  const prepare = useCallback(
    async (fields: GateField[]): Promise<GateResult> => {
      const values: Record<string, string | null> = Object.fromEntries(fields.map((f) => [f.key, f.text]))
      const foreign = fields.filter((f) => needsTranslation(f.text))
      if (foreign.length === 0) return { values, originals: null, sourceLang: null }

      const { data, error } = await supabase.functions.invoke<{ sourceLang: string; fields: { key: string; ja: string; back: string }[] }>(
        'translate',
        { body: { fields: foreign.map((f) => ({ key: f.key, text: f.text })), backLang: currentLocale() } },
      )
      if (error || !data) {
        if (error instanceof FunctionsHttpError) {
          const json = (await (error.context as Response).json().catch(() => ({}))) as { error?: string }
          throw new Error(`${t('translate.failed')}: ${json.error ?? error.message}`)
        }
        throw new Error(isNetworkError(error) ? t('translate.offline') : `${t('translate.failed')}: ${String(error)}`)
      }

      const items: ReviewItem[] = data.fields.map((f) => {
        const field = foreign.find((x) => x.key === f.key)!
        return { key: f.key, label: field.label, original: field.text ?? '', ja: f.ja, back: f.back }
      })
      const confirmed = await new Promise<Record<string, string> | null>((resolve) => {
        const p = { items, sourceLang: data.sourceLang, resolve }
        pendingRef.current = p
        setPending(p)
      })
      if (!confirmed) throw new TranslationCancelled()

      const originals: Record<string, string> = {}
      for (const item of items) {
        values[item.key] = confirmed[item.key]?.trim() || item.ja
        originals[item.key] = item.original
      }
      return { values, originals, sourceLang: data.sourceLang }
    },
    [t],
  )

  const close = (result: Record<string, string> | null) => {
    pendingRef.current?.resolve(result)
    pendingRef.current = null
    setPending(null)
  }

  const review = pending ? (
    <TranslationReview items={pending.items} onConfirm={(ja) => close(ja)} onCancel={() => close(null)} />
  ) : null

  return { prepare, review }
}
