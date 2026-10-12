import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Checkbox } from '../../components/ui'
import { hasTag, ISSUE_CATEGORIES, keepStaff, tagsByStaff, toggleTag, type IssueTag } from '../../domain/issues'
import { cx } from '../../lib/cx'
import { supabase } from '../../lib/supabase'

export interface IssueValue {
  issueTags?: IssueTag[]
  /** 特定の人ではない（全体・改善点なし） */
  issueNone?: boolean
  /** the current tags came from AI and were not touched yet */
  issueAi?: boolean
}

async function suggest(text: string, staff: string[]): Promise<IssueTag[]> {
  const { data, error } = await supabase.functions.invoke<{ tags: IssueTag[] }>('staff-ai', { body: { action: 'tags', text, staff } })
  if (error || !data) throw new Error('ai failed')
  return data.tags
}

/**
 * 改善点の対象: per person on shift, which kinds of points the 改善点 is about.
 * AI fills a suggestion once the 改善点 has been written (or on the button); the writer confirms.
 */
export function IssueTagsPicker({
  staff,
  text,
  value,
  onChange,
  missing,
  auto = true,
}: {
  staff: string[]
  text: string
  value: IssueValue
  onChange: (v: IssueValue) => void
  missing: boolean
  /** suggest by itself after typing stops (the form); off for managers' corrections */
  auto?: boolean
}) {
  const { t } = useTranslation('patrol')
  const tags = keepStaff(value.issueTags ?? [], staff)
  const ai = useMutation({
    mutationFn: () => suggest(text.trim(), staff),
    onSuccess: (found) => found.length && onChange({ issueTags: found, issueNone: false, issueAi: true }),
  })
  const { mutate, isPending } = ai
  const tried = useRef('')
  const key = `${text.trim()}\u0000${staff.join(',')}`
  const canSuggest = Boolean(text.trim() && staff.length)

  useEffect(() => {
    if (!auto || !canSuggest || tags.length || value.issueNone || isPending || tried.current === key) return
    const id = window.setTimeout(() => {
      tried.current = key
      mutate()
    }, 2500)
    return () => window.clearTimeout(id)
  }, [auto, canSuggest, tags.length, value.issueNone, isPending, mutate, key])

  const answered = Boolean(value.issueNone || tags.length)
  return (
    <fieldset className={cx('flex flex-col gap-2 rounded-xl border border-line p-2.5', missing && !answered && 'ring-2 ring-red-600')}>
      <legend className="px-1 text-[15px] font-bold text-ink">{t('issues.title')}</legend>
      <p className="text-sm text-slate-600">{t('issues.hint')}</p>
      {staff.length === 0 && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">{t('issues.needStaff')}</p>}
      {staff.map((name) => (
        <div key={name} className={cx('flex flex-col gap-1', value.issueNone && 'opacity-40')}>
          <p className="font-bold">{name}</p>
          <div className="flex flex-wrap gap-1.5">
            {ISSUE_CATEGORIES.map((c) => {
              const on = hasTag(tags, { staff: name, category: c })
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  disabled={value.issueNone}
                  onClick={() => onChange({ issueTags: toggleTag(tags, { staff: name, category: c }), issueNone: false, issueAi: false })}
                  className={cx(
                    'min-h-10 rounded-full border-[1.5px] px-3 text-sm font-bold',
                    on ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink',
                  )}
                >
                  {t(`issues.cat.${c}`)}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <Checkbox checked={Boolean(value.issueNone)} onChange={(issueNone) => onChange({ issueNone, issueTags: issueNone ? [] : tags, issueAi: false })}>
        {t('issues.none')}
      </Checkbox>
      {staff.length > 0 && (
        <button
          type="button"
          className="min-h-10 self-start text-sm font-bold text-brand underline disabled:text-slate-400 disabled:no-underline"
          disabled={!canSuggest || ai.isPending}
          onClick={() => {
            tried.current = key
            ai.mutate()
          }}
        >
          {ai.isPending ? t('issues.aiRunning') : t('issues.ai')}
        </button>
      )}
      {value.issueAi && tags.length > 0 && <p className="rounded-lg bg-blue-50 p-2 text-sm text-blue-900">{t('issues.aiNote')}</p>}
      {ai.isError && <p className="text-sm text-red-700">{t('issues.aiFailed')}</p>}
      {ai.isSuccess && ai.data.length === 0 && !tags.length && !value.issueNone && <p className="text-sm text-amber-900">{t('issues.aiEmpty')}</p>}
      {missing && !answered && <p className="text-sm font-bold text-red-700">{t('issues.need')}</p>}
    </fieldset>
  )
}

/** "カン：声出し・接客用語、清潔" per person, or 全体; nothing for records sent before tags existed. */
export function IssueTagsView({ tags, highlight }: { tags: IssueTag[] | null | undefined; highlight?: string }) {
  const { t } = useTranslation('patrol')
  if (!tags) return null
  if (!tags.length) return <span>{t('issues.all')}</span>
  return (
    <span className="flex flex-col">
      {tagsByStaff(tags).map(([name, cats]) => (
        <span key={name} className={cx(highlight === name && 'font-bold text-red-800')}>
          {name}：{cats.map((c) => t(`issues.cat.${c}`)).join('、')}
        </span>
      ))}
    </span>
  )
}
