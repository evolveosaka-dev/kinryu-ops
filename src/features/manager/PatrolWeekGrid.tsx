import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Card, Spinner } from '../../components/ui'
import { patrolCompletion, patrolSlots, type GridDuty } from '../../domain/patrolGrid'
import { dateRange } from '../../domain/stats'
import { addDays, formatShortDate, weekdayOf } from '../../domain/time'
import { SHIFTS } from '../../domain/types'
import { cx } from '../../lib/cx'
import { storeName } from '../../lib/format'
import { unwrap, useStores } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { Stat } from './common'
import { JUDGE_STYLE, today, useRecords, type AdminPatrol } from './data'

function useDuties(from: string, to: string) {
  return useQuery({
    queryKey: ['admin', 'patrol_duties', from, to],
    queryFn: async () =>
      unwrap<GridDuty[]>(
        await supabase.from('duty_assignments').select('business_date, shift, store_id, roster_name').eq('kind', 'patrol').gte('business_date', from).lte('business_date', to),
      ),
  })
}

/** 管理 → 巡回: the last 7 days × store × shift, like 管理 → 朝礼, compared with the patrol duties. */
export function PatrolWeekGrid({ onOpen }: { onOpen: (p: AdminPatrol) => void }) {
  const { t } = useTranslation('manager')
  const stores = useStores()
  const to = today()
  const from = addDays(to, -6)
  const { patrols, isLoading } = useRecords({ from, to })
  const duties = useDuties(from, to)

  if (isLoading || duties.isLoading || stores.isLoading) return <Spinner />
  const storeIds = (stores.data ?? []).map((s) => s.id)
  const dates = dateRange(from, to)
  const slots = patrolSlots(dates, storeIds, patrols.data ?? [], duties.data ?? [], new Date())
  const total = patrolCompletion(slots)
  const short = (id: string) => storeName(stores.data?.find((s) => s.id === id), 'ja').replace('店', '')

  return (
    <Card className="flex flex-col gap-2 p-2">
      <h2 className="px-1 font-bold">{t('patrolList.weekTitle')}</h2>
      <div className="grid grid-cols-3 gap-2">
        <Stat label={t('patrolList.rate')} value={total.rate === null ? '—' : `${total.rate}%`} sub={`${total.done}/${total.due}`} />
        <Stat label={t('patrolList.missed')} value={total.missed} tone={total.missed > 0 ? 'warn' : 'good'} />
        <Stat label={t('patrolList.extra')} value={total.extra} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] text-center text-xs">
          <thead>
            <tr>
              <th />
              {storeIds.map((sid) => (
                <th key={sid} colSpan={3} className="border-l border-slate-200 py-1">
                  {short(sid)}
                </th>
              ))}
            </tr>
            <tr className="text-slate-600">
              <th />
              {storeIds.flatMap((sid) =>
                SHIFTS.map((s, i) => (
                  <th key={`${sid}-${s}`} className={cx('py-1 font-normal', i === 0 && 'border-l border-slate-200')}>
                    {t(`common:shift.${s}`)}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {dates.map((d) => (
              <tr key={d} className="border-t border-slate-100">
                <th className="py-1 text-left font-normal whitespace-nowrap">
                  {formatShortDate(d)}({t(`weekday.${weekdayOf(d)}`)})
                </th>
                {storeIds.flatMap((sid) =>
                  SHIFTS.map((shift, i) => {
                    const slot = slots.find((x) => x.date === d && x.storeId === sid && x.shift === shift)!
                    const duty = slot.dutyNames.length ? `${t('patrolList.duty')}: ${slot.dutyNames.join('、')}` : undefined
                    return (
                      <td key={`${sid}-${shift}`} className={cx('align-middle', i === 0 && 'border-l border-slate-200')}>
                        {slot.state === 'done' ? (
                          <span className="flex flex-col gap-0.5 p-0.5">
                            {slot.patrols.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                title={duty}
                                onClick={() => onOpen(p)}
                                className={cx('min-h-8 w-full rounded font-bold underline', p.judgement ? JUDGE_STYLE[p.judgement] : 'bg-green-100 text-green-900')}
                              >
                                {p.total ?? '✓'}
                              </button>
                            ))}
                          </span>
                        ) : slot.state === 'progress' ? (
                          <button type="button" title={t('patrolList.inProgress')} onClick={() => onOpen(slot.patrols[0]!)} className="min-h-8 w-full rounded bg-slate-100 font-bold text-slate-600">
                            …
                          </button>
                        ) : slot.state === 'missed' ? (
                          <span title={duty} className="block min-h-8 rounded bg-red-50 py-2 font-bold text-red-700">
                            ✗
                          </span>
                        ) : slot.state === 'planned' ? (
                          <span title={duty} className="block min-h-8 py-2 font-bold text-sky-700">
                            {t('patrolList.plannedShort')}
                          </span>
                        ) : (
                          <span className="text-slate-300">―</span>
                        )}
                      </td>
                    )
                  }),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-1 text-left text-xs text-slate-600">{t('patrolList.legend')}</p>
    </Card>
  )
}
