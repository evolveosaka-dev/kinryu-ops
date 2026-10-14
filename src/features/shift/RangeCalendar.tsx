import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { monthDates } from '../../domain/shiftRequest'
import { weekdayOf } from '../../domain/time'
import { cx } from '../../lib/cx'

const shiftMonth = (m: string, by: number) => {
  const d = new Date(`${m.slice(0, 7)}-01T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + by)
  return d.toISOString().slice(0, 10)
}

/**
 * Pick a period that may run over several months: tap the first day, move with ‹ › if needed,
 * tap the last day. Tapping again starts a new period.
 */
export function RangeCalendar({ from, to, onChange, startMonth }: { from: string; to: string; onChange: (from: string, to: string) => void; startMonth: string }) {
  const { t } = useTranslation('shift')
  const [month, setMonth] = useState((from || startMonth).slice(0, 8) + '01')
  const dates = monthDates(month)
  const lead = (weekdayOf(dates[0]!) + 6) % 7
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
  const tap = (d: string) => {
    if (!from || to) return onChange(d, '')
    if (d < from) return onChange(d, from)
    onChange(from, d)
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-surface p-2">
      <div className="flex items-center justify-between">
        <button type="button" className="min-h-10 min-w-10 rounded-lg border border-line bg-white font-bold" aria-label="prev" onClick={() => setMonth(shiftMonth(month, -1))}>
          ‹
        </button>
        <b>{t('monthLabel', { y: month.slice(0, 4), m: Number(month.slice(5, 7)) })}</b>
        <button type="button" className="min-h-10 min-w-10 rounded-lg border border-line bg-white font-bold" aria-label="next" onClick={() => setMonth(shiftMonth(month, 1))}>
          ›
        </button>
      </div>
      <p className="text-sm text-muted">{!from || to ? t('school.pickStart') : t('school.pickEnd', { d: md(from) })}</p>
      <div className="grid grid-cols-7 gap-1 text-center">
        {[1, 2, 3, 4, 5, 6, 0].map((w) => (
          <span key={w} className={cx('text-xs font-bold', (w === 0 || w === 6) && 'text-red-700')}>
            {t(`common:wd.${w}`)}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`e${i}`} />
        ))}
        {dates.map((d) => {
          const edge = d === from || d === to
          const inside = from && to && d > from && d < to
          return (
            <button
              key={d}
              type="button"
              onClick={() => tap(d)}
              className={cx('min-h-10 rounded-lg border text-sm font-bold', edge ? 'border-brand bg-brand text-white' : inside ? 'border-sky-200 bg-sky-100 text-sky-900' : 'border-line bg-white')}
            >
              {Number(d.slice(8, 10))}
            </button>
          )
        })}
      </div>
    </div>
  )
}
