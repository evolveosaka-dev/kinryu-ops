import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Card, ErrorBox, Spinner, PageTitle } from '../../components/ui'
import { formatHoursMinutes, PATROL_WARN_MINUTES } from '../../domain/patrol'
import { patrolHours } from '../../domain/stats'
import { formatShortDate } from '../../domain/time'
import { PATROL_TYPES } from '../../domain/types'
import { errorMessage, storeName } from '../../lib/format'
import { useStores } from '../../lib/queries'
import { PeriodBar, Dot } from './common'
import { exportCsv, exportXlsx, jstDateTime, usePeople, useRecords, type AdminPatrol, usePeriod } from './data'
import { PatrolDetail } from './details'
import { ManagerTabs } from './ManagerTabs'

/** 巡回時間（給与用）: per patroller per month. */
export function HoursPage() {
  const { t } = useTranslation('manager')
  const period = usePeriod('month')
  const stores = useStores()
  const people = usePeople()
  const { patrols, isLoading, error } = useRecords(period.range)
  const [selected, setSelected] = useState<AdminPatrol | null>(null)

  if (isLoading) return <Spinner />
  if (error) return <ErrorBox message={errorMessage(error)} />

  const ps = patrols.data ?? []
  const rows = patrolHours(ps).sort((a, b) => people.name(a.patrollerId).localeCompare(people.name(b.patrollerId), 'ja'))
  const flagged = ps.filter((p) => p.status !== 'void' && (p.needs_time_review || (p.duration_min ?? 0) > PATROL_WARN_MINUTES))
  const month = period.range.from.slice(0, 7)
  const typeJa = (x: string) => t(`patrol:type.${x}`, { lng: 'ja' })
  const summaryRows = [
    ['巡回者', '回数', '合計（分）', '合計（時間）', ...PATROL_TYPES.map(typeJa), '15分超', '時間確認'],
    ...rows.map((r) => [people.name(r.patrollerId), r.count, r.minutes, formatHoursMinutes(r.minutes), ...PATROL_TYPES.map((x) => r.byType[x] ?? 0), r.over, r.review]),
  ]
  const detailRows = [
    ['巡回者', '日付', '店舗', 'シフト', '種類', '開始', '終了', '分', '時間確認'],
    ...ps
      .filter((p) => p.status === 'valid')
      .map((p) => [
        people.name(p.patroller_id),
        p.business_date,
        storeName(stores.data?.find((s) => s.id === p.store_id), 'ja'),
        t(`common:shift.${p.shift}`, { lng: 'ja' }),
        typeJa(p.patrol_type),
        jstDateTime(p.started_at),
        jstDateTime(p.ended_at),
        p.duration_min,
        p.needs_time_review ? '要確認' : '',
      ]),
  ]

  return (
    <div className="flex flex-col gap-3">
      <ManagerTabs />
      <PageTitle title={t('hours.title')} />
      <PeriodBar period={period} allowModes={false} />
      <p className="text-xs text-slate-600">{t('countNote')}</p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => void exportXlsx(`金龍_巡回時間_${month}.xlsx`, [{ name: '集計', rows: summaryRows }, { name: '明細', rows: detailRows }])}>
          Excel
        </Button>
        <Button variant="secondary" onClick={() => exportCsv(`金龍_巡回時間_${month}.csv`, summaryRows)}>
          CSV
        </Button>
      </div>
      {flagged.some((p) => p.needs_time_review) && <p className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900"><Dot tone="amber" /> {t('hours.reviewFirst')}</p>}

      <Card className="overflow-x-auto p-2">
        <table className="w-full min-w-[20rem] text-sm">
          <thead className="text-xs text-slate-600">
            <tr>
              <th className="text-left">{t('detail.patroller')}</th>
              <th>{t('stats.times')}</th>
              <th>{t('hours.minutes')}</th>
              <th>{t('hours.hours')}</th>
              <th>{t('hours.over')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.patrollerId} className="border-t border-slate-100 text-center">
                <td className="py-2 text-left font-bold">{people.name(r.patrollerId)}</td>
                <td>{r.count}</td>
                <td>{r.minutes}</td>
                <td className="font-bold">{formatHoursMinutes(r.minutes)}</td>
                <td className={r.over ? 'font-bold text-amber-700' : ''}>{r.over}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-2 text-sm text-slate-600">{t('stats.noData')}</p>}
        <p className="mt-2 text-xs text-slate-600">{t('hours.note')}</p>
      </Card>

      {flagged.length > 0 && (
        <Card className="flex flex-col gap-1">
          <h2 className="font-bold">{t('hours.flagged')}</h2>
          {flagged.map((p) => (
            <button key={p.id} type="button" onClick={() => setSelected(p)} className="rounded-lg bg-white p-2 text-left text-sm ring-1 ring-amber-200">
              {formatShortDate(p.business_date)} {people.name(p.patroller_id)} — {p.duration_min ?? '—'}
              {t('detail.min')} {p.needs_time_review && t('dashboard.timeReview')}
            </button>
          ))}
        </Card>
      )}
      {selected && <PatrolDetail patrol={selected} patrollerName={people.name(selected.patroller_id)} onClose={() => setSelected(null)} />}
    </div>
  )
}
