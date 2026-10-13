import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, ErrorBox, Spinner, PageTitle } from '../../components/ui'
import { choreiSlots, completion, dateRange, missSummary, type ChoreiSlotView } from '../../domain/stats'
import { formatShortDate, weekdayOf } from '../../domain/time'
import { MISS_ICON, SHIFTS } from '../../domain/types'
import { currentLocale } from '../../i18n'
import { cx } from '../../lib/cx'
import { errorMessage, storeName } from '../../lib/format'
import { useStores } from '../../lib/queries'
import { PeriodBar, Stat } from './common'
import { usePeople, useRecords, type AdminChorei, usePeriod } from './data'
import { ChoreiMissSheet } from './ChoreiMissSheet'
import { ChoreiDetail } from './details'
import { ManagerTabs } from './ManagerTabs'

export function ChoreiAdminPage() {
  const { t } = useTranslation('manager')
  const period = usePeriod('week')
  const stores = useStores()
  const people = usePeople()
  const { chorei, misses, isLoading, error } = useRecords(period.range)
  // by id, so the sheet shows the record again after a refetch (e.g. a new comment)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // a slot without a record (✗ / reason / manager's ✓), by key
  const [missKey, setMissKey] = useState<string | null>(null)

  if (isLoading || stores.isLoading) return <Spinner />
  if (error) return <ErrorBox message={errorMessage(error)} />

  const selected = (chorei.data ?? []).find((r) => r.id === selectedId) ?? null
  const setSelected = (r: AdminChorei | null) => setSelectedId(r?.id ?? null)
  const storeIds = (stores.data ?? []).map((s) => s.id)
  const dates = dateRange(period.range.from, period.range.to)
  const slots = choreiSlots(chorei.data ?? [], dates, storeIds, new Date(), misses.data ?? [])
  const missStats = missSummary(slots)
  const keyOf = (s: ChoreiSlotView<unknown>) => `${s.date}|${s.storeId}|${s.shift}`
  const missSlot = slots.find((s) => keyOf(s) === missKey) ?? null
  const total = completion(slots)
  const voided = (chorei.data ?? []).filter((r) => r.status === 'void')
  const short = (id: string) => storeName(stores.data?.find((s) => s.id === id), 'ja').replace('店', '')
  const wd = (d: string) => t(`weekday.${weekdayOf(d)}`)

  return (
    <div className="flex flex-col gap-3">
      <ManagerTabs />
      <PageTitle title={t('choreiList.title')} />
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
                        ) : slot.state === 'done' || slot.state === 'missing' ? (
                          <button
                            type="button"
                            onClick={() => setMissKey(keyOf(slot))}
                            title={slot.miss?.reason ? t(`chorei:miss.reason.${slot.miss.reason}`) : undefined}
                            className={cx(
                              'min-h-9 w-full rounded font-bold',
                              slot.state === 'done' ? 'bg-teal-50 text-teal-800' : slot.miss ? 'bg-amber-100' : 'text-red-700',
                            )}
                          >
                            {slot.state === 'done' ? `✓${t('misses.confirmedShort')}` : slot.miss?.reason ? MISS_ICON[slot.miss.reason] : '✗'}
                          </button>
                        ) : (
                          <span className="text-slate-300" title={slot.state === 'off' ? t('testPeriod') : undefined}>―</span>
                        )}
                      </td>
                    )
                  }),
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-left text-xs text-slate-600">{t('choreiList.legend')}</p>
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
                  {(missStats.byStoreShift.get(`${sid}|${shift}`) ?? 0) > 0 && (
                    <span className="block text-xs text-red-700">{t('misses.count', { n: missStats.byStoreShift.get(`${sid}|${shift}`) })}</span>
                  )}
                </li>
              )
            }),
          )}
        </ul>
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="font-bold">{t('misses.title')}</h2>
        {missStats.total === 0 ? (
          <p className="text-sm text-slate-600">{t('misses.none')}</p>
        ) : (
          <>
            <ul className="flex flex-col gap-1 text-sm">
              {missStats.byReason.map(({ reason, count }) => (
                <li key={reason ?? 'none'} className={cx('flex items-center justify-between rounded-lg px-2 py-1', reason ? 'bg-amber-50' : 'bg-red-50 font-bold text-red-800')}>
                  <span>{reason ? `${MISS_ICON[reason]} ${t(`chorei:miss.reason.${reason}`)}` : `✗ ${t('misses.unreported')}`}</span>
                  <span>{t('misses.count', { n: count })}</span>
                </li>
              ))}
            </ul>
            <h3 className="text-sm font-bold">{t('misses.byWeekday')}</h3>
            <ul className="grid grid-cols-7 gap-1 text-center text-xs">
              {[1, 2, 3, 4, 5, 6, 0].map((wd) => (
                <li key={wd} className="rounded-lg bg-slate-50 p-1">
                  <span className="block">{t(`weekday.${wd}`)}</span>
                  <b className={missStats.byWeekday[wd] ? 'text-red-700' : 'text-slate-400'}>{missStats.byWeekday[wd]}</b>
                </li>
              ))}
            </ul>
          </>
        )}
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
      {missSlot && (
        <ChoreiMissSheet
          key={missKey}
          slot={missSlot}
          title={`${missSlot.date} ${t(`common:shift.${missSlot.shift}`)} ${storeName(stores.data?.find((s) => s.id === missSlot.storeId), currentLocale())}`}
          reporterName={people.name}
          onClose={() => setMissKey(null)}
        />
      )}
      {selected && <ChoreiDetail record={selected} leaderName={people.name(selected.leader_id)} onClose={() => setSelected(null)} />}
    </div>
  )
}
