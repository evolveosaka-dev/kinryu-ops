import { FunctionsHttpError } from '@supabase/supabase-js'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Button, ErrorBox } from '../../components/ui'
import type { AiSuggestion, IncidentKind } from '../../domain/incident'
import { currentLocale } from '../../i18n'
import { cx } from '../../lib/cx'
import { errorMessage, isNetworkError } from '../../lib/format'
import { supabase } from '../../lib/supabase'

async function ask(kind: IncidentKind, description: string): Promise<AiSuggestion> {
  const { data, error } = await supabase.functions.invoke<AiSuggestion>('incident-ai', { body: { kind, description, backLang: currentLocale() } })
  if (error || !data) {
    if (error instanceof FunctionsHttpError) {
      const json = (await (error.context as Response).json().catch(() => ({}))) as { error?: string }
      throw new Error(json.error ?? error.message)
    }
    throw error ?? new Error('no proposal')
  }
  return data
}

/**
 * その場でしたこと, step 1: 「AIの提案」 = what to do now, built from how managers handled earlier cases, in
 * Japanese and in the writer's language. Then 「提案どおりにした」 (the Japanese goes into その場でしたこと) or
 * 「別の方法で対応した」 (the writer types it).
 */
export function AiProposal({
  kind,
  description,
  value,
  source,
  onValue,
  onChoose,
}: {
  kind: IncidentKind | null
  description: string
  value: AiSuggestion | null
  source: 'ai' | 'own' | null
  onValue: (s: AiSuggestion) => void
  onChoose: (source: 'ai' | 'own') => void
}) {
  const { t } = useTranslation()
  const run = useMutation({ mutationFn: () => ask(kind!, description.trim()), onSuccess: onValue })
  const ready = Boolean(kind && description.trim())
  const ja = currentLocale() === 'ja'
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-violet-200 bg-violet-50/60 p-3">
      <span className="text-[15px] font-bold">🤖 {t('incident.ai.title')}</span>
      <p className="text-sm text-slate-700">{t('incident.ai.hint')}</p>
      <Button variant="secondary" onClick={() => run.mutate()} disabled={!ready || run.isPending}>
        {run.isPending ? t('incident.ai.thinking') : value ? t('incident.ai.again') : t('incident.ai.ask')}
      </Button>
      {!ready && <p className="text-xs text-muted">{t('incident.ai.needDescription')}</p>}
      {run.error && <ErrorBox message={isNetworkError(run.error) ? t('translate.offline') : `${t('incident.ai.failed')}: ${errorMessage(run.error)}`} />}
      {value && (
        <div className="flex flex-col gap-2 rounded-xl border border-violet-300 bg-white p-3">
          <p className="text-xs font-bold text-violet-800">
            {value.basedOn.length > 0 ? t('incident.ai.basedOn', { n: value.basedOn.length }) : t('incident.ai.noCases')}
          </p>
          <p className="whitespace-pre-wrap">{value.ja}</p>
          {!ja && value.local && value.local !== value.ja && (
            <p className="whitespace-pre-wrap border-t border-violet-100 pt-2 text-slate-700" lang={value.lang}>
              {value.local}
            </p>
          )}
          <div className="grid grid-cols-1 gap-2">
            {(['ai', 'own'] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={source === s}
                onClick={() => onChoose(s)}
                className={cx(
                  'min-h-12 rounded-xl border-[1.5px] px-3 text-left font-bold',
                  source === s ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink',
                )}
              >
                {s === 'ai' ? `✅ ${t('incident.ai.followed')}` : `✍️ ${t('incident.ai.own')}`}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
