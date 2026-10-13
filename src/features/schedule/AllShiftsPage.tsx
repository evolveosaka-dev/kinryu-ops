import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMe } from '../../app/auth'
import { Card, ErrorBox, PageTitle, Spinner } from '../../components/ui'
import { STORE_BY_MARK, weekDates } from '../../domain/schedule'
import { addDays, tokyoParts } from '../../domain/time'
import { SHIFTS, type Shift } from '../../domain/types'
import { cx } from '../../lib/cx'
import { errorMessage } from '../../lib/format'
import { useMonthImported, useStoreMonth, useTestRosterNames, type AssignmentRow } from './data'
import { ExtensionNote, ShiftChip, TimeRange } from './parts'
import { SHIFT_STYLE, STORE_DOT, useDayLabel } from './style'

// order of the store buttons
const STORE_MARKS = ['⑤', '①']

const shiftMonth = (month: string, n: number) => {
  const d = new Date(`${month}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 10)
}

const toggleClass = (on: boolean) =>
  cx(
    'flex min-h-11 items-center justify-center rounded-xl border-[1.5px] px-1 text-[15px] font-bold',
    on ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink hover:bg-surface',
  )

/** メニュー → 全店舗シフト (managers): one store's month as a calendar with a dot per shift; a day → who works when. */
export function AllShiftsPage() {
  const { t } = useTranslation('shift')
  const { t: tc } = useTranslation()
  const dayLabel = useDayLabel()
  const today = tokyoParts(new Date()).date
  const [month, setMonth] = useState(`${today.slice(0, 7)}-01`)
  const [store, setStore] = useState<string | null>(null)
  const [shifts, setShifts] = useState<Shift[]>([...SHIFTS])
  const [day, setDay] = useState<string | null>(today)
  const prev = useMonthImported(shiftMonth(month, -1))
  const next = useMonthImported(shiftMonth(month, 1))
  const data = useStoreMonth(store, month)
  // a test account sees its own copied shifts; real managers never do
  const me = useMe()
  const testNames = useTestRosterNames(!me.is_test_account)

  const goMonth = (n: number) => {
    const m = shiftMonth(month, n)
    setMonth(m)
    setDay(today.startsWith(m.slice(0, 7)) ? today : null)
  }
  const allOn = shifts.length === SHIFTS.length
  // from 「すべて」 a tap shows only that shift; otherwise it adds / removes it (one stays on)
  const toggle = (s: Shift) =>
    setShifts((cur) =>
      cur.length === SHIFTS.length ? [s] : cur.includes(s) ? (cur.length > 1 ? cur.filter((x) => x !== s) : cur) : SHIFTS.filter((x) => x === s || cur.includes(x)),
    )

  const hidden = new Set(testNames.data ?? [])
  const rows = (data.data ?? []).filter((a) => !hidden.has(a.roster_name))
  const on = (d: string, s: Shift) => rows.filter((a) => a.business_date === d && a.shift === s)

  const monthEnd = addDays(shiftMonth(month, 1), -1)
  const gridDates: string[] = []
  for (let d = weekDates(month)[0]!; d <= monthEnd || gridDates.length % 7 !== 0; d = addDays(d, 1)) gridDates.push(d)

  const arrow = (n: number, enabled: boolean, label: string, text: string) => (
    <button
      type="button"
      className="min-h-11 min-w-11 rounded-xl border border-line bg-white text-xl font-bold disabled:opacity-30"
      aria-label={label}
      disabled={!enabled}
      onClick={() => goMonth(n)}
    >
      {text}
    </button>
  )

  return (
    <div className="flex flex-col gap-3">
      <PageTitle title={t('allShifts.title')} />

      <div className="flex items-center justify-between gap-2">
        {arrow(-1, prev.data === true, t('schedule.prevMonth'), '‹')}
        <p className="text-lg font-bold">{t('monthLabel', { y: month.slice(0, 4), m: Number(month.slice(5, 7)) })}</p>
        {arrow(1, next.data === true, t('schedule.nextMonth'), '›')}
      </div>

      <div role="radiogroup" aria-label={t('allShifts.pickStore')} className="grid grid-cols-2 gap-2">
        {STORE_MARKS.map((mark) => (
          <button key={mark} type="button" role="radio" aria-checked={store === mark} onClick={() => setStore(mark)} className={cx(toggleClass(store === mark), 'min-h-12 gap-1.5')}>
            <span aria-hidden className={cx('inline-block size-2.5 rounded-full ring-1 ring-white', STORE_DOT[mark])} />
            {STORE_BY_MARK[mark]!.ja}
          </button>
        ))}
      </div>

      {!store ? (
        <Card className="text-muted">{t('allShifts.pickStore')}</Card>
      ) : data.isLoading ? (
        <Spinner />
      ) : data.error ? (
        <ErrorBox message={errorMessage(data.error)} />
      ) : rows.length === 0 ? (
        <Card className="text-muted">{t('schedule.noMonth')}</Card>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2">
            <button type="button" aria-pressed={allOn} onClick={() => setShifts([...SHIFTS])} className={toggleClass(allOn)}>
              {t('allShifts.all')}
            </button>
            {SHIFTS.map((s) => (
              <button key={s} type="button" aria-pressed={shifts.includes(s)} onClick={() => toggle(s)} className={cx(toggleClass(!allOn && shifts.includes(s)), 'gap-1')}>
                <span aria-hidden className={cx('inline-block size-3 rounded-full ring-1 ring-white', SHIFT_STYLE[s].dot)} />
                {tc(`shift.${s}`)}
              </button>
            ))}
          </div>

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
                return (
                  <li key={d}>
                    <button
                      type="button"
                      disabled={!inMonth}
                      aria-pressed={day === d}
                      onClick={() => setDay(d)}
                      className={cx(
                        'flex min-h-[4.75rem] w-full flex-col items-center gap-0.5 rounded-lg border py-1',
                        !inMonth
                          ? 'border-transparent opacity-0'
                          : day === d
                            ? 'border-brand bg-brand-soft ring-2 ring-brand'
                            : d === today
                              ? 'border-brand bg-white'
                              : 'border-line bg-white',
                      )}
                    >
                      <span className="text-sm font-bold">{Number(d.slice(8, 10))}</span>
                      {inMonth &&
                        shifts.map((s) => {
                          const n = on(d, s).length
                          return (
                            <span key={s} className={cx('flex items-center gap-1 text-[11px] leading-4 font-bold tabular-nums', n === 0 && 'invisible')}>
                              <span aria-hidden className={cx('inline-block size-2.5 rounded-full', SHIFT_STYLE[s].dot)} />
                              {n}
                            </span>
                          )
                        })}
                    </button>
                  </li>
                )
              })}
            </ol>
            <p className="mt-1 text-xs text-muted">{t('allShifts.legend')}</p>
          </div>

          {!day || !day.startsWith(month.slice(0, 7)) ? (
            <p className="text-sm text-muted">{t('allShifts.tapDay')}</p>
          ) : (
            <section className="flex flex-col gap-2">
              <h2 className="text-lg font-bold">
                {dayLabel(day)}・{STORE_BY_MARK[store]!.ja}
              </h2>
              {shifts.map((s) => (
                <DayShift key={s} shift={s} rows={on(day, s)} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}

function DayShift({ shift, rows }: { shift: Shift; rows: AssignmentRow[] }) {
  const { t } = useTranslation('shift')
  return (
    <Card className={cx('flex flex-col gap-2 border', SHIFT_STYLE[shift].soft)}>
      <p className="flex items-center gap-2">
        <ShiftChip shift={shift} />
        <span className="font-bold">{t('allShifts.people', { n: rows.length })}</span>
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t('allShifts.nobody')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((a) => (
            <li key={a.id} className="flex flex-col rounded-lg bg-white px-3 py-2">
              <span className="flex justify-between gap-2">
                <span className="font-bold">{a.roster_name}</span>
                <span className="font-bold">
                  <TimeRange a={a} />
                </span>
              </span>
              <ExtensionNote a={a} short />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
