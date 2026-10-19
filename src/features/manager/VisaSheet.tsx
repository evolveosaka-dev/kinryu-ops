import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Sheet } from '../../components/Sheet'
import { Spinner } from '../../components/ui'
import { formatMin, STORE_BY_MARK, type Assignment } from '../../domain/schedule'
import { VISA_LIMIT_MIN, visaFix, visaRuns, type VisaWeek, type VisaWindow } from '../../domain/shiftChange'
import { addDays, formatShortDate, tokyoParts, weekdayOf } from '../../domain/time'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { today } from './data'

const hours = (min: number) => Math.round((min / 60) * 10) / 10

/**
 * 週28時間超え (留学・家族滞在): per person the run of days over 28 h, every 7 days in a row over the limit, and the
 * shifts (today or later) to take off so that every 7 days are within 28 h again (owner, 2026-10-19).
 */
export function VisaSheet({ windows, onClose }: { windows: VisaWindow[]; onClose: () => void }) {
  const { t } = useTranslation('manager')
  const runs = visaRuns(windows)
  const names = [...new Set(runs.map((r) => r.name))]
  const from = runs.reduce((m, r) => (r.from < m ? r.from : m), runs[0]?.from ?? today())
  const to = runs.reduce((m, r) => (r.to > m ? r.to : m), runs[0]?.to ?? today())
  const shifts = useQuery({
    queryKey: ['admin', 'visa_shifts', names.join(','), from, to],
    enabled: names.length > 0,
    queryFn: async () =>
      unwrap<(Assignment & { roster_name: string })[]>(
        await supabase
          .from('shift_assignments')
          .select('roster_name, business_date, shift, store_mark, start_min, end_min')
          .in('roster_name', names)
          .gte('business_date', from)
          .lte('business_date', to)
          .order('business_date')
          .order('start_min'),
      ),
  })
  const tp = tokyoParts(new Date())
  const now = { date: tp.date, min: tp.hour * 60 + tp.minute }
  const day = (d: string) => `${formatShortDate(d)}(${t(`weekday.${weekdayOf(d)}`)})`
  const week = (w: VisaWeek) => t('dashboard.visaWeekLine', { from: day(w.from), to: day(w.to), h: hours(w.minutes), over: hours(w.minutes - VISA_LIMIT_MIN) })

  return (
    <Sheet title={t('dashboard.visaOver')} onClose={onClose}>
      <p className="rounded-xl bg-sky-50 p-3 text-sm font-bold whitespace-pre-line text-sky-900">{t('dashboard.visaHow')}</p>
      {shifts.isLoading && <Spinner />}
      <ul className="flex flex-col gap-2">
        {runs.map((r) => {
          const mine = (shifts.data ?? []).filter((a) => a.roster_name === r.name)
          // windows of this run: first day from r.from to r.to − 6
          const fix = shifts.data ? visaFix(mine, r.from, addDays(r.to, -6), now.date, now.min) : null
          return (
            <li key={`${r.name}${r.from}`} className="flex flex-col gap-1.5 rounded-xl border border-red-200 bg-white p-3">
              <b>
                {r.name}（{t('dashboard.visaLabel')}）
              </b>
              <span className="text-sm text-red-800">{t('users.visa.over', { from: formatShortDate(r.from), to: formatShortDate(r.to), h: hours(r.maxMin) })}</span>
              {fix && (
                <>
                  <h4 className="mt-1 text-sm font-bold">{t('dashboard.visaWeeks', { n: fix.over.length })}</h4>
                  <ul className="flex flex-col text-sm tabular-nums">
                    {fix.over.map((w) => (
                      <li key={w.from} className="border-b border-line py-0.5">
                        {week(w)}
                      </li>
                    ))}
                  </ul>
                  {fix.remove.length > 0 && (
                    <div className="mt-1 rounded-lg bg-amber-50 p-2 text-sm">
                      <b className="block text-amber-900">💡 {t('dashboard.visaFix', { n: fix.remove.length, h: hours(fix.remove.reduce((m, a) => m + a.end_min - a.start_min, 0)) })}</b>
                      <ul className="mt-1 flex flex-col tabular-nums">
                        {fix.remove.map((a) => (
                          <li key={`${a.business_date}${a.start_min}`}>
                            ✂️ {day(a.business_date)} {t(`common:shift.${a.shift}`)} {STORE_BY_MARK[a.store_mark]?.short ?? a.store_mark} {formatMin(a.start_min)}–{formatMin(a.end_min)}（{hours(a.end_min - a.start_min)}{t('dashboard.visaHourUnit')}）
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1 text-xs text-amber-900">{t('dashboard.visaFixNote')}</p>
                    </div>
                  )}
                  {fix.after.length > 0 && (
                    <p className="text-xs text-slate-700">{t('dashboard.visaPast', { list: fix.after.map((w) => `${formatShortDate(w.from)}〜${formatShortDate(w.to)}`).join('・') })}</p>
                  )}
                </>
              )}
            </li>
          )
        })}
      </ul>
      <Link to="/all-shifts" className="text-center font-bold text-brand underline">
        🗓️ {t('dashboard.visaShifts')}
      </Link>
    </Sheet>
  )
}

