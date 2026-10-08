import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { cx } from '../../lib/cx'
import { SCORES, type PatrolItem, type Score } from '../../domain/patrol'

/** One of the 5 items: score buttons with the criteria text next to each. */
export function ScoreItem({
  item,
  value,
  onChange,
}: {
  item: PatrolItem
  /** undefined = not scored yet, null = "－" (quality only) */
  value: Score | null | undefined
  onChange: (v: Score | null) => void
}) {
  const { t } = useTranslation('patrol')
  const headingId = useId()
  const hasDesc = item === 'grooming' || item === 'clean' || item === 'quality'
  return (
    <div role="radiogroup" aria-labelledby={headingId} className="flex flex-col gap-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-baseline justify-between">
        <h2 id={headingId} className="text-lg font-bold">{t(`items.${item}.name`)}</h2>
        <span className={cx('text-2xl font-bold', value === undefined ? 'text-slate-300' : 'text-brand')}>
          {value === undefined ? '?' : value === null ? '－' : value}
        </span>
      </div>
      {hasDesc && <p className="text-xs text-slate-600">{t(`items.${item}.desc`)}</p>}
      <div className="flex flex-col gap-1.5">
        {SCORES.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={value === s}
            onClick={() => onChange(s)}
            className={cx(
              'flex min-h-12 items-center gap-3 rounded-xl border px-3 py-2 text-left',
              value === s ? 'border-brand bg-red-50 ring-2 ring-brand' : 'border-slate-200 bg-white',
            )}
          >
            <span className={cx('flex size-9 shrink-0 items-center justify-center rounded-full text-lg font-bold', value === s ? 'bg-brand text-white' : 'bg-slate-100')}>
              {s}
            </span>
            <span className="text-sm leading-snug">{t(`items.${item}.${s}`)}</span>
          </button>
        ))}
        {item === 'quality' && (
          <button
            type="button"
            role="radio"
            aria-checked={value === null}
            onClick={() => onChange(null)}
            className={cx(
              'min-h-12 rounded-xl border px-3 py-2 text-left text-sm font-bold',
              value === null ? 'border-slate-700 bg-slate-100 ring-2 ring-slate-700' : 'border-dashed border-slate-300 bg-white',
            )}
          >
            {t('items.quality.none')}
          </button>
        )}
      </div>
    </div>
  )
}
