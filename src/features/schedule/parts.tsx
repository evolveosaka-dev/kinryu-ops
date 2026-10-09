import { useTranslation } from 'react-i18next'
import { formatRange, STORE_BY_MARK, type Assignment } from '../../domain/schedule'
import type { Shift } from '../../domain/types'
import { cx } from '../../lib/cx'
import { useCoworkers } from './data'
import { SHIFT_STYLE, STORE_DOT } from './style'

export function ShiftChip({ shift, className }: { shift: Shift; className?: string }) {
  const { t } = useTranslation()
  return <span className={cx('rounded-md px-2 py-0.5 text-sm font-bold', SHIFT_STYLE[shift].chip, className)}>{t(`shift.${shift}`)}</span>
}

export function StoreLabel({ mark }: { mark: string }) {
  const store = STORE_BY_MARK[mark]
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cx('inline-block size-2.5 rounded-full', STORE_DOT[mark] ?? 'bg-slate-400')} />
      {store?.ja ?? mark}
    </span>
  )
}

export function TimeRange({ a }: { a: Pick<Assignment, 'start_min' | 'end_min'> }) {
  return <span className="tabular-nums">{formatRange(a)}</span>
}

/** Coworkers in the same shift at the same store. */
export function Coworkers({ a }: { a: Assignment }) {
  const { t } = useTranslation('shift')
  const q = useCoworkers(a)
  return (
    <div>
      <p className="mb-1 text-sm font-bold text-muted">👥 {t('schedule.coworkers')}</p>
      {q.isLoading ? (
        <p className="text-sm text-muted">…</p>
      ) : (q.data ?? []).length === 0 ? (
        <p className="text-sm text-muted">{t('schedule.noCoworkers')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {q.data!.map((c) => (
            <li key={c.roster_name} className="flex justify-between gap-2 rounded-lg bg-surface px-3 py-2">
              <span className="font-bold">{c.roster_name}</span>
              <TimeRange a={c} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
