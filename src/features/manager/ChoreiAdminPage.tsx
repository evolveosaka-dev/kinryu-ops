import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, ErrorBox, Spinner } from '../../components/ui'
import { choreiSlots, completion, dateRange } from '../../domain/stats'
import { formatShortDate, weekdayOf } from '../../domain/time'
import { SHIFTS } from '../../domain/types'
import { currentLocale } from '../../i18n'
import { cx } from '../../lib/cx'
import { errorMessage, storeName } from '../../lib/format'
import { useStores } from '../../lib/queries'
import { PeriodBar, Stat } from './common'
import { usePeople, useRecords, type AdminChorei, usePeriod } from './data'
import { ChoreiDetail } from './details'
import { ManagerTabs } from './ManagerTabs'

export function ChoreiAdminPage() {
  const { t } = useTranslation('manager')
  const period = usePeriod('week')
  const stores = useStores()
  const people = usePeople()
  const { chorei, isLoading, error } = useRecords(period.range)
  const [selected, setSelected] = useState<AdminChorei | null>(null)

  if (isLoading || stores.isLoading) return <Spinner />
  if (error) return <ErrorBox message={errorMessage(error)} />

  const storeIds = (stores.data ?? []).map((s) => s.id)
  const dates = dateRange(period.range.from, period.range.to)
  const slots = choreiSlots(chorei.data ?? [], dates, storeIds, new Date())
  const total = completion(slots)
  const voided = (chorei.data ?? []).filter((r) => r.status === 'void')
  const short = (id: string) => storeName(stores.data?.find((s) => s.id === id), 'ja').replace('店', '')
  const wd = (d: string) => t(`weekday.${weekdayOf(d)}`)

  return (
    <div className="flex flex-col gap-3">
      <ManagerTabs />
      <h1 className="text-xl font-bold">📣 {t('choreiList.title')}</h1>
      <PeriodBar period={period} />
      <div className="grid grid-cols-2 gap-2">
        <Stat label={t('dashboard.choreiRate')} value={total.rate === null ? '—' : `${total.rate}%`} sub={`${total.done}/${total.due}`} />
        <Stat label={t('choreiList.missing')} value={total.due - total.done} tone={total.due - total.done > 0 ? 'warn' : 'good'} />
      </div>

      <Card className="overflow-x-auto p-2">
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
            <tr className="text-slate-500">
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
                  {formatShortDate(d)}({wd(d)})
                </th>
                {storeIds.flatMap((sid) =>
                  SHIFTS.map((shift, i) => {
                    const slot = slots.find((x) => x.date === d && x.storeId === sid && x.shift === shift)!
                    return (
                      <td key={`${sid}-${shift}`} className={cx(i === 0 && 'border-l border-slate-200')}>
                        {slot.record ? (
                          <button type="button" onClick={() => setSelected(slot.record!)} className="min-h-9 w-full font-bold text-green-700 underline">
                            ✓
                          </button>
                        ) : (
                          <span className={slot.state === 'missing' ? 'font-bold text-red-700' : 'text-slate-300'}>{slot.state === 'missing' ? '✗' : '―'}</span>
                        )}
                      </td>
                    )
                  }),
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-left text-xs text-slate-500">{t('choreiList.legend')}</p>
      </Card>

      <Card>
        <h2 className="mb-1 font-bold">{t('choreiList.byShift')}</h2>
        <ul className="grid grid-cols-3 gap-2 text-center text-sm">
          {storeIds.flatMap((sid) =>
            SHIFTS.map((shift) => {
              const c = completion(slots.filter((s) => s.storeId === sid && s.shift === shift))
              return (
                <li key={`${sid}-${shift}`} className="rounded-lg bg-slate-50 p-2">
                  <span className="block text-xs">
                    {short(sid)} {t(`common:shift.${shift}`)}
                  </span>
                  <b>{c.rate === null ? '—' : `${c.rate}%`}</b>
                </li>
              )
            }),
          )}
        </ul>
      </Card>

      {voided.length > 0 && (
        <Card>
          <h2 className="mb-1 font-bold">{t('choreiList.voided')}</h2>
          <ul className="text-sm">
            {voided.map((r) => (
              <li key={r.id}>
                <button type="button" className="underline" onClick={() => setSelected(r)}>
                  {formatShortDate(r.business_date)} {t(`common:shift.${r.shift}`)} {storeName(stores.data?.find((s) => s.id === r.store_id), currentLocale())} — {r.void_reason}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {selected && <ChoreiDetail record={selected} leaderName={people.name(selected.leader_id)} onClose={() => setSelected(null)} />}
    </div>
  )
}
