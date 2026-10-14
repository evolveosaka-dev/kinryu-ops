import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui'
import { formatShortDate } from '../../domain/time'
import { cx } from '../../lib/cx'
import { usePeople, type usePeriod } from './data'

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

export { Sheet } from '../../components/Sheet'

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

/** Who sent a report (朝礼の誘導者, 巡回の担当): managers can put it on another account. */
export function PersonSelect({ label, value, onChange }: { label: string; value: string; onChange: (id: string) => void }) {
  const people = usePeople()
  const list = (people.data ?? []).filter((p) => p.status === 'active' || p.id === value).sort((a, b) => people.name(a.id).localeCompare(people.name(b.id), 'ja'))
  return (
    <label className="flex flex-col gap-1 text-sm font-bold">
      {label}
      <select className="min-h-12 rounded-xl border border-slate-400 bg-white px-2 text-base font-normal" value={value} onChange={(e) => onChange(e.target.value)}>
        {list.map((p) => (
          <option key={p.id} value={p.id}>
            {people.name(p.id)}
            {p.roster_name && p.roster_name !== people.name(p.id) ? `（${p.roster_name}）` : ''}
          </option>
        ))}
      </select>
    </label>
  )
}