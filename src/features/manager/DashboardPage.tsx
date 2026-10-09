import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Card, ErrorBox, Spinner } from '../../components/ui'
import { PATROL_TARGET_25 } from '../../domain/patrol'
import { choreiSlots, completion, dateRange, patrolSummary } from '../../domain/stats'
import { addDays, formatShortDate, formatTokyoTime } from '../../domain/time'
import { SHIFTS } from '../../domain/types'
import { currentLocale } from '../../i18n'
import { cx } from '../../lib/cx'
import { errorMessage, storeName } from '../../lib/format'
import { unwrap, useStores } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { Stat } from './common'
import { today, usePeople, useRecords, weekOf, type AdminPatrol } from './data'
import { PatrolDetail } from './details'
import { ManagerTabs } from './ManagerTabs'

/** Open coaching follow-ups and time reviews, whatever their date. */
function useOpenItems() {
  return useQuery({
    queryKey: ['admin', 'open-items'],
    queryFn: async () =>
      unwrap<AdminPatrol[]>(
        await supabase
          .from('patrol_checks')
          .select('*, attachments(id, kind, status, drive_url)')
          .neq('status', 'void')
          .or('needs_time_review.eq.true,and(judgement.eq.coaching,follow_up_done_at.is.null,status.eq.valid)')
          .order('started_at', { ascending: false }),
      ),
  })
}

export function DashboardPage() {
  const { t } = useTranslation('manager')
  const stores = useStores()
  const people = usePeople()
  const now = new Date()
  const day = today()
  const thisWeek = weekOf(day)
  const lastWeek = weekOf(addDays(thisWeek.from, -7))
  const records = useRecords({ from: addDays(day, -13), to: day })
  const open = useOpenItems()
  const [selected, setSelected] = useState<AdminPatrol | null>(null)

  if (records.isLoading || stores.isLoading) return <Spinner />
  if (records.error) return <ErrorBox message={errorMessage(records.error)} />

  const storeIds = (stores.data ?? []).map((s) => s.id)
  const chorei = records.chorei.data ?? []
  const patrols = records.patrols.data ?? []
  const todaySlots = choreiSlots(chorei, [day], storeIds, now)
  const missingSlots = choreiSlots(chorei, dateRange(addDays(day, -6), day), storeIds, now).filter((s) => s.state === 'missing')
  const inRange = (r: { from: string; to: string }) => patrols.filter((p) => p.business_date >= r.from && p.business_date <= r.to)
  const cur = patrolSummary(inRange(thisWeek))
  const prev = patrolSummary(inRange(lastWeek))
  const weekChorei = completion(choreiSlots(chorei, dateRange(thisWeek.from, day), storeIds, now))
  const coaching = (open.data ?? []).filter((p) => p.judgement === 'coaching' && !p.follow_up_done_at && p.status === 'valid')
  const timeReview = (open.data ?? []).filter((p) => p.needs_time_review)
  const pending = (people.data ?? []).filter((p) => p.status === 'pending').length
  const delta = cur.average !== null && prev.average !== null ? Math.round((cur.average - prev.average) * 10) / 10 : null
  const storeLabel = (id: string) => storeName(stores.data?.find((s) => s.id === id), currentLocale())

  return (
    <div className="flex flex-col gap-4">
      <ManagerTabs />
      <h1 className="text-xl font-bold">📊 {t('dashboard.title')}</h1>

      <Card className="flex flex-col gap-2">
        <h2 className="font-bold">{t('dashboard.today', { date: formatShortDate(day) })}</h2>
        <table className="w-full text-center text-sm">
          <thead>
            <tr>
              <th />
              {SHIFTS.map((s) => (
                <th key={s} className="py-1">
                  {t(`common:shift.${s}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {storeIds.map((sid) => (
              <tr key={sid} className="border-t border-slate-100">
                <th className="py-2 text-left">{storeLabel(sid)}</th>
                {SHIFTS.map((shift) => {
                  const slot = todaySlots.find((x) => x.storeId === sid && x.shift === shift)!
                  return (
                    <td key={shift} className={cx('py-2 font-bold', slot.state === 'done' ? 'text-green-700' : slot.state === 'missing' ? 'text-red-700' : 'text-slate-400')}>
                      {slot.state === 'done' ? `✓ ${formatTokyoTime(new Date(slot.record!.submitted_at))}` : slot.state === 'missing' ? `✗ ${t('dashboard.missing')}` : '―'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="font-bold">{t('dashboard.todo')}</h2>
        <ul className="flex flex-col gap-1 text-sm">
          <li>
            <Link to="/manager/patrol?filter=coaching" className="flex min-h-11 items-center justify-between rounded-xl bg-red-50 px-3 font-bold text-red-900">
              🔴 {t('dashboard.coaching')} <span>{coaching.length}</span>
            </Link>
          </li>
          <li>
            <Link to="/manager/patrol?filter=time" className="flex min-h-11 items-center justify-between rounded-xl bg-amber-50 px-3 font-bold text-amber-900">
              🟡 {t('dashboard.timeReview')} <span>{timeReview.length}</span>
            </Link>
          </li>
          <li>
            <Link to="/manager/chorei" className="flex min-h-11 items-center justify-between rounded-xl bg-amber-50 px-3 font-bold text-amber-900">
              🟡 {t('dashboard.missingChorei')} <span>{missingSlots.length}</span>
            </Link>
          </li>
          <li>
            <Link to="/manager/users" className="flex min-h-11 items-center justify-between rounded-xl bg-blue-50 px-3 font-bold text-blue-900">
              🔵 {t('dashboard.pendingUsers')} <span>{pending}</span>
            </Link>
          </li>
        </ul>
        {coaching.length > 0 && (
          <ul className="flex flex-col gap-1">
            {coaching.slice(0, 5).map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => setSelected(p)} className="w-full rounded-lg bg-white p-2 text-left text-sm ring-1 ring-red-200">
                  {formatShortDate(p.business_date)} {t(`common:shift.${p.shift}`)} {storeLabel(p.store_id)} — {p.total}/{p.max_total}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <h2 className="font-bold">{t('dashboard.thisWeek', { from: formatShortDate(thisWeek.from), to: formatShortDate(thisWeek.to) })}</h2>
      <div className="grid grid-cols-2 gap-2">
        <Stat
          label={t('dashboard.avgScore')}
          value={cur.average ?? '—'}
          sub={`${t('dashboard.target', { n: PATROL_TARGET_25 })}${delta !== null ? ` / ${t('dashboard.vsLastWeek')} ${delta >= 0 ? '▲+' : '▼'}${delta}` : ''}`}
          tone={cur.average === null ? undefined : cur.average >= PATROL_TARGET_25 ? 'good' : 'warn'}
        />
        <Stat label={t('dashboard.choreiRate')} value={weekChorei.rate === null ? '—' : `${weekChorei.rate}%`} sub={`${weekChorei.done}/${weekChorei.due}`} />
        <Stat label={t('dashboard.patrols')} value={cur.count} sub={`${t('common:judgement.good')} ${cur.good} / ${t('common:judgement.improve')} ${cur.improve} / ${t('common:judgement.coaching')} ${cur.coaching}`} />
        <Stat label={t('dashboard.mask')} value={cur.mask} />
      </div>

      {selected && <PatrolDetail patrol={selected} patrollerName={people.name(selected.patroller_id)} onClose={() => setSelected(null)} />}
    </div>
  )
}
