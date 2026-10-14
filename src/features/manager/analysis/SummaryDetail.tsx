import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../../../components/Sheet'
import { lastYear, rateOf, type DayView, type MonthSummary } from '../../../domain/salesAnalysis'
import { formatShortDate, weekdayOf } from '../../../domain/time'
import { cx } from '../../../lib/cx'

export type SummaryKind = 'achievement' | 'yoy' | 'forecast' | 'best'

const n = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString())
/** in the tables: with the unit */
const nb = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toLocaleString()}杯`)

function Formula({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-sky-50 p-3 text-sm font-bold text-sky-900">{children}</p>
}

function Table({ head, rows, foot }: { head: string[]; rows: { key: string; cells: ReactNode[]; muted?: boolean }[]; foot?: ReactNode[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-slate-600">
        <tr>
          {head.map((h, i) => (
            <th key={h} className={i === 0 ? 'text-left' : 'text-right'}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className={cx('border-t border-line', r.muted && 'text-slate-400')}>
            {r.cells.map((c, i) => (
              <td key={i} className={cx('py-1 tabular-nums', i === 0 ? 'text-left' : 'text-right')}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {foot && (
        <tfoot>
          <tr className="border-t-2 border-line font-bold">
            {foot.map((c, i) => (
              <td key={i} className={cx('py-1.5 tabular-nums', i === 0 ? 'text-left' : 'text-right')}>
                {c}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  )
}

/** How a summary figure of 管理 → 分析 is calculated, with the numbers of each day. */
export function SummaryDetail({ kind, days, summary, today, onClose }: { kind: SummaryKind; days: DayView[]; summary: MonthSummary; today: string; onClose: () => void }) {
  const { t } = useTranslation('manager')
  const day = (d: string) => `${formatShortDate(d)}(${t(`weekday.${weekdayOf(d)}`)})`
  const type = (d: DayView) => t(`chorei:target.${d.dayType}`)

  if (kind === 'achievement') {
    const used = days.filter((d) => d.actual !== null)
    return (
      <Sheet title={t('analysis.achievement')} onClose={onClose}>
        <Formula>{t('analysis.how.achievement', { actual: n(summary.actual), target: n(summary.target), rate: summary.rate ?? '—' })}</Formula>
        <p className="text-xs text-muted">{t('analysis.how.achievementNote')}</p>
        <Table
          head={[t('analysis.how.day'), t('analysis.actual'), t('analysis.target'), t('analysis.rate')]}
          rows={used.map((d) => ({
            key: d.date,
            cells: [
              <>
                {day(d.date)}
                <span className="block text-[11px] text-slate-500">
                  {type(d)}
                  {d.events.length ? `・${d.events.join('・')}` : ''}
                  {!d.complete ? `・${t('analysis.how.partial')}` : ''}
                </span>
              </>,
              nb(d.actual),
              nb(d.target),
              `${rateOf(d.actual, d.target) ?? '—'}%`,
            ],
          }))}
          foot={[t('analysis.total'), nb(summary.actual), nb(summary.target), `${summary.rate ?? '—'}%`]}
        />
      </Sheet>
    )
  }

  if (kind === 'yoy') {
    const used = days.filter((d) => d.actual !== null)
    const cur = used.filter((d) => d.lastYear !== null).reduce((s, d) => s + d.actual!, 0)
    return (
      <Sheet title={t('analysis.yoy')} onClose={onClose}>
        <Formula>{t('analysis.how.yoy', { cur: n(cur), ly: n(summary.lyActual), yoy: summary.yoy === null ? '—' : `${summary.yoy > 0 ? '+' : ''}${summary.yoy}` })}</Formula>
        <p className="text-xs text-muted">{t('analysis.how.yoyNote')}</p>
        <Table
          head={[t('analysis.how.day'), t('analysis.how.thisYear'), t('analysis.how.lastYearDay'), t('analysis.how.diff')]}
          rows={used.map((d) => {
            const diff = d.lastYear ? Math.round((d.actual! / d.lastYear - 1) * 1000) / 10 : null
            return {
              key: d.date,
              muted: d.lastYear === null,
              cells: [
                day(d.date),
                nb(d.actual),
                <>
                  {nb(d.lastYear)}
                  <span className="block text-[11px] text-slate-500">
                    {lastYear(d.date).slice(0, 4)}/{day(lastYear(d.date))}
                  </span>
                </>,
                diff === null ? t('analysis.how.notCompared') : <b className={diff >= 0 ? 'text-green-700' : 'text-red-700'}>{`${diff > 0 ? '+' : ''}${diff}%`}</b>,
              ],
            }
          })}
          foot={[t('analysis.total'), nb(cur), nb(summary.lyActual), summary.yoy === null ? '—' : `${summary.yoy > 0 ? '+' : ''}${summary.yoy}%`]}
        />
      </Sheet>
    )
  }

  if (kind === 'forecast') {
    const rest = days.filter((d) => d.actual === null && d.date >= today)
    const restSum = rest.reduce((s, d) => s + (d.targetAll ?? 0), 0)
    return (
      <Sheet title={t('analysis.forecast')} onClose={onClose}>
        <Formula>{t('analysis.how.forecast', { actual: n(summary.actual), rest: n(restSum), days: rest.length, forecast: n(summary.forecast) })}</Formula>
        <p className="text-xs text-muted">{t('analysis.how.forecastNote')}</p>
        <Table
          head={[t('analysis.how.day'), t('analysis.how.dayType'), t('analysis.target')]}
          rows={rest.map((d) => ({ key: d.date, cells: [day(d.date), <>{type(d)}{d.events.length ? <span className="block text-[11px] text-slate-500">{d.events.join('・')}</span> : null}</>, nb(d.targetAll)] }))}
          foot={[t('analysis.how.restTotal'), '', nb(restSum)]}
        />
      </Sheet>
    )
  }

  const complete = days.filter((d) => d.complete && d.actual !== null).sort((a, b) => b.actual! - a.actual!)
  return (
    <Sheet title={t('analysis.bestWorst')} onClose={onClose}>
      <Formula>{t('analysis.how.best')}</Formula>
      <p className="text-xs text-muted">{t('analysis.how.bestNote')}</p>
      <Table
        head={[t('analysis.how.rank'), t('analysis.how.day'), t('analysis.actual'), t('analysis.target'), t('analysis.rate')]}
        rows={complete.map((d, i) => ({
          key: d.date,
          cells: [
            i + 1,
            <>
              {day(d.date)}
              <span className="block text-[11px] text-slate-500">{type(d)}</span>
            </>,
            <b>{nb(d.actual)}</b>,
            nb(d.target),
            `${rateOf(d.actual, d.target) ?? '—'}%`,
          ],
        }))}
      />
    </Sheet>
  )
}
