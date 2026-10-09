import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui'
import { formatShortDate } from '../../domain/time'
import { cx } from '../../lib/cx'
import type { usePeriod } from './data'

export function PeriodBar({ period, allowModes = true }: { period: ReturnType<typeof usePeriod>; allowModes?: boolean }) {
  const { t } = useTranslation('manager')
  const { mode, setMode, range, move } = period
  const label =
    mode === 'week' ? `${formatShortDate(range.from)} – ${formatShortDate(range.to)}` : t('period.month', { y: range.from.slice(0, 4), m: Number(range.from.slice(5, 7)) })
  return (
    <div className="flex flex-col gap-2">
      {allowModes && (
        <div className="grid grid-cols-2 gap-2">
          {(['week', 'month'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cx('min-h-10 rounded-xl text-sm font-bold', mode === m ? 'bg-slate-800 text-white' : 'bg-white border border-line')}
            >
              {t(`period.${m}Mode`)}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between rounded-xl bg-white p-1 border border-line">
        <Button variant="ghost" onClick={() => move(-1)} aria-label={t('period.prev')}>
          ◀
        </Button>
        <span className="font-bold">{label}</span>
        <Button variant="ghost" onClick={() => move(1)} aria-label={t('period.next')}>
          ▶
        </Button>
      </div>
    </div>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <div className="rounded-2xl bg-white p-3 border border-line">
      <p className="text-xs font-bold text-slate-600">{label}</p>
      <p className={cx('text-2xl font-bold', tone === 'good' && 'text-green-700', tone === 'warn' && 'text-amber-700', tone === 'bad' && 'text-red-700')}>
        {value}
      </p>
      {sub && <p className="text-xs text-slate-600">{sub}</p>}
    </div>
  )
}

/** Full-screen panel for record details. */
export function Sheet({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex justify-center bg-black/50">
      <div className="flex max-h-dvh w-full max-w-lg flex-col bg-white">
        <header className="flex items-center justify-between border-b border-line bg-white px-4 py-3">
          <h2 className="font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="min-h-11 min-w-11 text-xl" aria-label={t('action.close')}>
            ✕
          </button>
        </header>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}

/** Simple horizontal bar (0..max). */
export function Bar({ value, max, target }: { value: number | null; max: number; target?: number }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className="relative h-3 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={cx('h-full', target !== undefined && value !== null && value < target ? 'bg-amber-500' : 'bg-green-600')} style={{ width: `${pct}%` }} />
      {target !== undefined && <div className="absolute top-0 h-full w-0.5 bg-slate-700" style={{ left: `${(target / max) * 100}%` }} />}
    </div>
  )
}

/** Flat status dot (instead of emoji). */
export function Dot({ tone }: { tone: 'red' | 'amber' | 'blue' }) {
  const color = tone === 'red' ? 'bg-red-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-blue-500'
  return <span aria-hidden className={cx('inline-block size-2 shrink-0 rounded-full', color)} />
}
