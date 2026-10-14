import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Segmented } from '../../components/ui'
import { dateSpan, formatDayRanges, isAvailable, monthDates, paidLeaveConflicts, type DayChoice } from '../../domain/shiftRequest'
import { weekdayOf } from '../../domain/time'
import type { Shift } from '../../domain/types'
import { cx } from '../../lib/cx'

/**
 * シフト希望提出 → 有給休暇の日: tap days one by one, or the first and last day of a run.
 * A day marked 出勤できる above cannot be chosen (error at once).
 */
export function PaidLeavePicker({
  month,
  value,
  onChange,
  days,
  shifts,
}: {
  month: string
  value: string[]
  onChange: (v: string[]) => void
  days: Record<string, DayChoice>
  shifts: Shift[]
}) {
  const { t } = useTranslation('shift')
  const [mode, setMode] = useState<'single' | 'range'>('single')
  const [start, setStart] = useState<string | null>(null)
  const [refused, setRefused] = useState<string[]>([])
  const dates = monthDates(month)
  const chosen = new Set(value)
  // days that became 出勤できる after being chosen
  const conflicts = paidLeaveConflicts(value, days, shifts)
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
  const lead = (weekdayOf(dates[0]!) + 6) % 7 // Monday first

  const tap = (d: string) => {
    setRefused([])
    if (mode === 'single') {
      if (chosen.has(d)) return onChange(value.filter((x) => x !== d))
      if (isAvailable(days[d], shifts)) return setRefused([d])
      return onChange([...value, d].sort())
    }
    if (!start) {
      if (isAvailable(days[d], shifts)) return setRefused([d])
      return setStart(d)
    }
    const span = dateSpan(start, d)
    setStart(null)
    const bad = span.filter((x) => isAvailable(days[x], shifts))
    if (bad.length) return setRefused(bad)
    onChange([...new Set([...value, ...span])].sort())
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-surface p-2">
      <Segmented
        label={t('paid.label')}
        value={mode}
        onChange={(m) => {
          setMode(m)
          setStart(null)
          setRefused([])
        }}
        options={[
          { value: 'single', label: t('paid.single') },
          { value: 'range', label: t('paid.range') },
        ]}
      />
      <p className="text-sm text-muted">{mode === 'single' ? t('paid.singleHint') : start ? t('paid.rangeEnd', { d: md(start) }) : t('paid.rangeStart')}</p>
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
          const on = chosen.has(d)
          const avail = isAvailable(days[d], shifts)
          const bad = refused.includes(d) || (on && avail)
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              onClick={() => tap(d)}
              className={cx(
                'flex min-h-11 flex-col items-center justify-center rounded-lg border text-sm font-bold',
                bad ? 'border-red-500 bg-red-100 text-red-800' : on ? 'border-brand bg-brand text-white' : start === d ? 'border-brand bg-brand-soft' : 'border-line bg-white',
              )}
            >
              {Number(d.slice(8, 10))}
              {avail && <span className={cx('text-[10px] leading-none font-normal', on || bad ? '' : 'text-green-700')}>{t('paid.work')}</span>}
            </button>
          )
        })}
      </div>
      {refused.length > 0 && <p className="rounded-lg bg-red-50 px-2 py-1.5 text-sm font-bold text-red-800">✗ {t('paid.refused', { days: formatDayRanges(refused) })}</p>}
      {conflicts.length > 0 && <p className="rounded-lg bg-red-50 px-2 py-1.5 text-sm font-bold text-red-800">✗ {t('err.paidLeaveConflict')}（{formatDayRanges(conflicts)}）</p>}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold">{value.length ? t('paid.selected', { days: formatDayRanges(value), n: value.length }) : t('paid.none')}</p>
        {value.length > 0 && (
          <button type="button" className="min-h-10 px-2 text-sm font-bold text-brand underline" onClick={() => onChange([])}>
            {t('days.clear')}
          </button>
        )}
      </div>
    </div>
  )
}
