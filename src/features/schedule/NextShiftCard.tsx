import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useMe } from '../../app/auth'
import { Card } from '../../components/ui'
import { chainMinutes, daysUntil, LONG_CHAIN_MIN, nextShift, weekDates } from '../../domain/schedule'
import { formatShortDate, tokyoParts } from '../../domain/time'
import { cx } from '../../lib/cx'
import { useMySchedule } from './data'
import { ShiftChip, StoreLabel, TimeRange } from './parts'
import { hours, SHIFT_STYLE, useDayLabel } from './style'

/** Home: the shift in progress or the next one, plus this week's strip. */
export function NextShiftCard() {
  const { t } = useTranslation('shift')
  const { t: tc } = useTranslation()
  const me = useMe()
  const dayLabel = useDayLabel()
  const schedule = useMySchedule(me.roster_name)
  if (!me.roster_name || !schedule.data) return null

  const now = new Date()
  const today = tokyoParts(now).date
  const next = nextShift(schedule.data, now)
  const chains = chainMinutes(schedule.data)
  const week = weekDates(today)

  let when = ''
  if (next) {
    const d = daysUntil(next.assignment, now)
    when = next.inProgress ? t('schedule.now') : d <= 0 ? t('schedule.today') : d === 1 ? t('schedule.tomorrow') : t('schedule.inDays', { n: d })
  }
  const chain = next ? (chains.get(next.assignment) ?? 0) : 0

  return (
    <Card className="border-blue-200">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-bold text-brand">{next?.inProgress ? t('schedule.now') : t('schedule.next')}</p>
        {next && !next.inProgress && <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-sm font-bold text-brand-dark">{when}</span>}
      </div>
      {next ? (
        <div className="flex flex-col gap-1.5">
          <p className="flex flex-wrap items-center gap-2 text-[19px] font-bold">
            {dayLabel(next.assignment.business_date)}
            <ShiftChip shift={next.assignment.shift} />
          </p>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[17px]">
            <span className="font-bold">
              ⏰ <TimeRange a={next.assignment} />
            </span>
            <StoreLabel mark={next.assignment.store_mark} />
          </p>
          {chain >= LONG_CHAIN_MIN && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">⚠️ {t('schedule.long', { h: hours(chain) })}</p>
          )}
        </div>
      ) : (
        <p className="text-muted">{t('schedule.none')}</p>
      )}

      <p className="mt-4 mb-1.5 text-sm font-bold text-muted">{t('schedule.thisWeek')}</p>
      <ol className="grid grid-cols-7 gap-1">
        {week.map((d) => {
          const shifts = schedule.data.filter((a) => a.business_date === d)
          return (
            <li key={d} className={cx('flex min-h-16 flex-col items-center gap-1 rounded-lg border py-1', d === today ? 'border-brand bg-brand-soft' : 'border-line')}>
              <span className="text-xs font-bold">{tc(`wd.${new Date(`${d}T00:00:00Z`).getUTCDay()}`)}</span>
              <span className="text-xs text-muted">{formatShortDate(d)}</span>
              {shifts.map((a) => (
                <span key={a.id} className={cx('w-[90%] rounded text-center text-[11px] leading-4 font-bold', SHIFT_STYLE[a.shift].chip)}>
                  {Math.floor(a.start_min / 60)}
                </span>
              ))}
            </li>
          )
        })}
      </ol>
      <Link to="/schedule" className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-xl border-[1.5px] border-brand font-bold text-brand-dark hover:bg-brand-soft">
        📅 {t('schedule.open')}
      </Link>
    </Card>
  )
}
