import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../../../components/Sheet'
import { lastYear, type DayView } from '../../../domain/salesAnalysis'
import { yoyPct } from '../../../domain/salesCompare'
import { formatShortDate, weekdayOf } from '../../../domain/time'
import { cx } from '../../../lib/cx'
import { Formula, Sources } from './explain'

// 分析 ④ 日別の前年比較 (owner, 2026-10-21): every day of the month vs the same weekday a year before (364 days back),
// for the selected stores / shifts; a day opens the store × shift detail.

const nm = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString())
const signed = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1).replace('-', '−')}%`)
const diff = (a: number | null, b: number | null) => (a === null || b === null ? '—' : `${a - b > 0 ? '+' : ''}${(a - b).toLocaleString()}`)
const yoyCls = (v: number | null) => (v === null ? 'text-slate-500' : v >= 0 ? 'text-green-700' : v > -5 ? 'text-amber-700' : 'text-red-700')

export function YoyDays({ days, storeLabel, holidays }: { days: DayView[]; storeLabel: (id: string) => string; holidays: ReadonlySet<string> }) {
  const { t } = useTranslation('manager')
  const [open, setOpen] = useState<DayView | null>(null)
  const label = (d: string) => `${formatShortDate(d)}(${t(`weekday.${weekdayOf(d)}`)})`
  // days with figures (a day not imported yet stays out)
  const rows = days.filter((d) => d.actual !== null)
  // the total over the days that have both figures
  const both = rows.filter((d) => d.actual !== null && d.lastYear !== null)
  const sumA = both.reduce((s, d) => s + d.actual!, 0)
  const sumL = both.reduce((s, d) => s + d.lastYear!, 0)
  if (!rows.length) return <p className="text-sm text-muted">{t('analysis.yoyDay.none')}</p>
  return (
    <>
      <div className="-mx-2 overflow-x-auto px-2">
        <table className="w-full min-w-[20rem] text-sm">
          <thead className="text-xs text-slate-600">
            <tr>
              <th className="text-left">{t('analysis.yoyDay.day')}</th>
              <th className="text-left">{t('analysis.yoyDay.lyDay')}</th>
              <th className="text-right">{t('analysis.actual')}</th>
              <th className="text-right">{t('analysis.lastYear')}</th>
              <th className="text-right">{t('analysis.yoyDay.rate')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const y = yoyPct(d.actual, d.lastYear)
              return (
                <tr key={d.date} className="border-t border-line">
                  <td className="py-0.5">
                    <button type="button" onClick={() => setOpen(d)} className={cx('min-h-9 text-left font-bold underline', holidays.has(d.date) ? 'text-red-700' : 'text-brand')}>
                      {label(d.date)}
                    </button>
                  </td>
                  <td className={cx('text-xs', holidays.has(lastYear(d.date)) ? 'text-red-700' : 'text-slate-600')}>{label(lastYear(d.date))}</td>
                  <td className="text-right font-bold tabular-nums">{nm(d.actual)}</td>
                  <td className="text-right text-slate-600 tabular-nums">{nm(d.lastYear)}</td>
                  <td className={cx('text-right font-bold tabular-nums', yoyCls(y))}>{signed(y)}</td>
                </tr>
              )
            })}
            {both.length > 0 && (
              <tr className="border-t-2 border-slate-400 bg-sky-50 font-bold">
                <td className="py-1">{t('analysis.total')}</td>
                <td className="text-xs font-normal text-slate-600">{t('analysis.yoyDay.days', { n: both.length })}</td>
                <td className="text-right tabular-nums">{nm(sumA)}</td>
                <td className="text-right tabular-nums">{nm(sumL)}</td>
                <td className={cx('text-right tabular-nums', yoyCls(yoyPct(sumA, sumL)))}>{signed(yoyPct(sumA, sumL))}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">{t('analysis.yoyDay.note')}</p>
      {open && <YoyDaySheet day={open} label={label} storeLabel={storeLabel} onClose={() => setOpen(null)} />}
    </>
  )
}

function YoyDaySheet({ day, label, storeLabel, onClose }: { day: DayView; label: (d: string) => string; storeLabel: (id: string) => string; onClose: () => void }) {
  const { t } = useTranslation('manager')
  const y = yoyPct(day.actual, day.lastYear)
  const ly = lastYear(day.date)
  return (
    <Sheet title={t('analysis.yoyDay.sheetTitle', { date: label(day.date), ly: `${ly.slice(0, 4)}/${label(ly)}` })} onClose={onClose}>
      {day.actual !== null && day.lastYear !== null ? (
        <Formula text={t('analysis.yoyDay.formula', { a: nm(day.actual), ly: nm(day.lastYear), p: signed(y) })} />
      ) : (
        <p className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">{t('analysis.yoyDay.missing')}</p>
      )}
      <table className="w-full text-sm">
        <thead className="text-xs text-slate-600">
          <tr>
            <th className="text-left">{t('analysis.slot')}</th>
            <th className="text-right">{t('analysis.actual')}</th>
            <th className="text-right">{t('analysis.lastYear')}</th>
            <th className="text-right">{t('analysis.yoyDay.diff')}</th>
            <th className="text-right">{t('analysis.yoyDay.rate')}</th>
          </tr>
        </thead>
        <tbody>
          {day.slots.map((s) => {
            const r = yoyPct(s.actual, s.lastYear)
            return (
              <tr key={`${s.store}${s.shift}`} className="border-t border-line">
                <td className="py-1.5">
                  {storeLabel(s.store)} {t(`common:shift.${s.shift}`)}
                </td>
                <td className="text-right font-bold tabular-nums">{nm(s.actual)}</td>
                <td className="text-right text-slate-600 tabular-nums">{nm(s.lastYear)}</td>
                <td className="text-right tabular-nums">{diff(s.actual, s.lastYear)}</td>
                <td className={cx('text-right font-bold tabular-nums', yoyCls(r))}>{signed(r)}</td>
              </tr>
            )
          })}
          <tr className="border-t-2 border-line font-bold">
            <td className="py-1.5">{t('analysis.total')}</td>
            <td className="text-right tabular-nums">{nm(day.actual)}</td>
            <td className="text-right tabular-nums">{nm(day.lastYear)}</td>
            <td className="text-right tabular-nums">{diff(day.actual, day.lastYear)}</td>
            <td className={cx('text-right tabular-nums', yoyCls(y))}>{signed(y)}</td>
          </tr>
        </tbody>
      </table>
      <p className="text-xs text-muted">{t('analysis.yoyDay.sheetNote')}</p>
      <Sources keys={['sales', 'lastYear']} />
    </Sheet>
  )
}
