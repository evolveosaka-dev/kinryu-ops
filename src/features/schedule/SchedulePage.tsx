import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMe } from '../../app/auth'
import { Sheet } from '../../components/Sheet'
import { Card, ErrorBox, PageTitle, Segmented, Spinner } from '../../components/ui'
import { chainMinutes, LONG_CHAIN_MIN, weekDates } from '../../domain/schedule'
import { addDays, tokyoParts } from '../../domain/time'
import { errorMessage } from '../../lib/format'
import { cx } from '../../lib/cx'
import { useMySchedule, type AssignmentRow } from './data'
import { Coworkers, ShiftChip, StoreLabel, TimeRange } from './parts'
import { hours, SHIFT_STYLE, useDayLabel } from './style'

type View = 'list' | 'calendar'
const VIEW_KEY = 'kinryu.scheduleView'

function loadView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'calendar' ? 'calendar' : 'list'
  } catch {
    return 'list'
  }
}

const shiftMonth = (month: string, n: number) => {
  const d = new Date(`${month}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 10)
}

function DayDetail({ date, rows, chains, onClose }: { date: string; rows: AssignmentRow[]; chains: Map<AssignmentRow, number>; onClose: () => void }) {
  const { t } = useTranslation('shift')
  const dayLabel = useDayLabel()
  return (
    <Sheet title={dayLabel(date)} onClose={onClose}>
      {rows.length === 0 && <p className="text-muted">{t('schedule.off')}</p>}
      {rows.map((a) => (
        <Card key={a.id} className={cx('flex flex-col gap-3 border', SHIFT_STYLE[a.shift].soft)}>
          <p className="flex flex-wrap items-center gap-2 text-lg font-bold">
            <ShiftChip shift={a.shift} />
            <TimeRange a={a} />
            <span className="text-sm font-normal text-muted">{t('schedule.hours', { h: hours(a.end_min - a.start_min) })}</span>
          </p>
          <StoreLabel mark={a.store_mark} />
          {(chains.get(a) ?? 0) >= LONG_CHAIN_MIN && (
            <p className="rounded-lg bg-amber-100 px-3 py-2 text-sm font-bold text-amber-900">⚠️ {t('schedule.long', { h: hours(chains.get(a)!) })}</p>
          )}
          <Coworkers a={a} />
        </Card>
      ))}
    </Sheet>
  )
}

/** メニュー → シフトスケジュール: my shifts by month, as a list (default) or a calendar. */
export function SchedulePage() {
  const { t } = useTranslation('shift')
  const { t: tc } = useTranslation()
  const me = useMe()
  const dayLabel = useDayLabel()
  const today = tokyoParts(new Date()).date
  const [month, setMonth] = useState(`${today.slice(0, 7)}-01`)
  const [view, setViewState] = useState<View>(loadView)
  const [openDate, setOpenDate] = useState<string | null>(null)
  const schedule = useMySchedule(me.roster_name)

  const setView = (v: View) => {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* private mode */
    }
  }

  if (!me.roster_name) {
    return (
      <div className="flex flex-col gap-3">
        <PageTitle title={t('schedule.title')} />
        <Card>{t('schedule.notLinked')}</Card>
      </div>
    )
  }
  if (schedule.isLoading) return <Spinner />
  if (schedule.error) return <ErrorBox message={errorMessage(schedule.error)} />

  const all = schedule.data ?? []
  const chains = chainMinutes(all)
  const rows = all.filter((a) => a.business_date.startsWith(month.slice(0, 7)))
  const totalMin = rows.reduce((s, a) => s + a.end_min - a.start_min, 0)
  const days = new Set(rows.map((a) => a.business_date)).size
  const firstMonth = `${all[0]?.business_date.slice(0, 7) ?? today.slice(0, 7)}-01`
  const lastMonth = `${all.at(-1)?.business_date.slice(0, 7) ?? today.slice(0, 7)}-01`
  const byDate = (d: string) => rows.filter((a) => a.business_date === d)

  // calendar: Monday-start weeks covering the month
  const monthEnd = addDays(shiftMonth(month, 1), -1)
  const gridDates: string[] = []
  for (let d = weekDates(month)[0]!; d <= monthEnd || gridDates.length % 7 !== 0; d = addDays(d, 1)) gridDates.push(d)

  return (
    <div className="flex flex-col gap-3">
      <PageTitle title={t('schedule.title')} />

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-xl border border-line bg-white text-xl font-bold disabled:opacity-30"
          aria-label={t('schedule.prevMonth')}
          disabled={month <= firstMonth}
          onClick={() => setMonth(shiftMonth(month, -1))}
        >
          ‹
        </button>
        <p className="text-lg font-bold">{t('monthLabel', { y: month.slice(0, 4), m: Number(month.slice(5, 7)) })}</p>
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-xl border border-line bg-white text-xl font-bold disabled:opacity-30"
          aria-label={t('schedule.nextMonth')}
          disabled={month >= lastMonth}
          onClick={() => setMonth(shiftMonth(month, 1))}
        >
          ›
        </button>
      </div>

      <Segmented
        label=""
        value={view}
        onChange={setView}
        options={[
          { value: 'list', label: `☰ ${t('schedule.list')}` },
          { value: 'calendar', label: `📅 ${t('schedule.calendar')}` },
        ]}
      />

      {rows.length === 0 ? (
        <Card className="text-muted">{t('schedule.noMonth')}</Card>
      ) : (
        <p className="font-bold">{t('schedule.summary', { days, hours: hours(totalMin) })}</p>
      )}

      {view === 'list' && rows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rows.map((a) => {
            const chain = chains.get(a) ?? 0
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setOpenDate(a.business_date)}
                  className={cx(
                    'flex w-full items-center gap-3 rounded-2xl border bg-white p-3 text-left hover:bg-surface',
                    a.business_date === today ? 'border-brand ring-2 ring-brand/30' : 'border-line',
                    a.business_date < today && 'opacity-70',
                  )}
                >
                  <span className="w-[5.5rem] shrink-0 font-bold">{dayLabel(a.business_date)}</span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <ShiftChip shift={a.shift} />
                      <span className="font-bold">
                        <TimeRange a={a} />
                      </span>
                    </span>
                    <span className="text-sm">
                      <StoreLabel mark={a.store_mark} />
                    </span>
                    {chain >= LONG_CHAIN_MIN && <span className="text-sm font-bold text-amber-800">⚠️ {t('schedule.longShort', { h: hours(chain) })}</span>}
                  </span>
                  <span aria-hidden className="text-xl text-slate-500">
                    ›
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {view === 'calendar' && (
        <div>
          <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs font-bold text-muted">
            {[1, 2, 3, 4, 5, 6, 0].map((w) => (
              <span key={w} className={cx(w === 0 && 'text-red-700', w === 6 && 'text-blue-700')}>
                {tc(`wd.${w}`)}
              </span>
            ))}
          </div>
          <ol className="grid grid-cols-7 gap-1">
            {gridDates.map((d) => {
              const inMonth = d.startsWith(month.slice(0, 7))
              const list = inMonth ? byDate(d) : []
              return (
                <li key={d}>
                  <button
                    type="button"
                    disabled={!inMonth}
                    onClick={() => setOpenDate(d)}
                    className={cx(
                      'flex min-h-16 w-full flex-col items-center gap-0.5 rounded-lg border py-1',
                      !inMonth ? 'border-transparent opacity-0' : d === today ? 'border-brand bg-brand-soft' : 'border-line bg-white',
                    )}
                  >
                    <span className="text-sm font-bold">{Number(d.slice(8, 10))}</span>
                    {list.map((a) => (
                      <span key={a.id} className={cx('w-[88%] rounded text-[11px] leading-4 font-bold', SHIFT_STYLE[a.shift].chip)}>
                        {Math.floor(a.start_min / 60)}
                      </span>
                    ))}
                  </button>
                </li>
              )
            })}
          </ol>
          <p className="mt-2 flex flex-wrap gap-3 text-sm">
            {(['early', 'middle', 'late'] as const).map((s) => (
              <span key={s} className="inline-flex items-center gap-1">
                <span className={cx('inline-block size-3 rounded', SHIFT_STYLE[s].chip)} />
                {tc(`shift.${s}`)}
              </span>
            ))}
          </p>
        </div>
      )}

      {openDate && <DayDetail date={openDate} rows={byDate(openDate)} chains={chains} onClose={() => setOpenDate(null)} />}
    </div>
  )
}
