import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { Button, Card } from '../../components/ui'
import { formatHoursMinutes, PATROL_REVIEW_MINUTES } from '../../domain/patrol'
import { patrolHours } from '../../domain/stats'
import { formatShortDate } from '../../domain/time'
import { PATROL_TYPES } from '../../domain/types'
import { storeName } from '../../lib/format'
import { useStores } from '../../lib/queries'
import { Dot } from './common'
import { PatrolList } from './drill'
import { exportCsv, exportXlsx, jstDateTime, usePeople, type AdminPatrol } from './data'

/**
 * 巡回時間 per patroller, part of 管理 → 巡回: the same period and filters as 「巡回の一覧」.
 * `label` names the files (e.g. 2026-10 or 2026-10-05_2026-10-11).
 */
export function HoursSummary({ patrols: ps, label, onOpen }: { patrols: AdminPatrol[]; label: string; onOpen: (p: AdminPatrol) => void }) {
  const { t } = useTranslation('manager')
  const stores = useStores()
  const people = usePeople()
  // patroller whose patrols are listed (tap a row)
  const [who, setWho] = useState<string | null>(null)

  const rows = patrolHours(ps).sort((a, b) => people.name(a.patrollerId).localeCompare(people.name(b.patrollerId), 'ja'))
  const flagged = ps.filter((p) => p.status !== 'void' && (p.needs_time_review || (p.duration_min ?? 0) > PATROL_REVIEW_MINUTES))
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
    <Card className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold">⏱️ {t('hours.title')}</h3>
        <span className="flex gap-1.5">
          <Button variant="secondary" className="min-h-10 px-3 py-1 text-sm" onClick={() => void exportXlsx(`金龍_巡回時間_${label}.xlsx`, [{ name: '集計', rows: summaryRows }, { name: '明細', rows: detailRows }])}>
            Excel
          </Button>
          <Button variant="secondary" className="min-h-10 px-3 py-1 text-sm" onClick={() => exportCsv(`金龍_巡回時間_${label}.csv`, summaryRows)}>
            CSV
          </Button>
        </span>
      </div>
      {flagged.some((p) => p.needs_time_review) && (
        <p className="rounded-xl bg-amber-50 p-2 text-sm font-bold text-amber-900">
          <Dot tone="amber" /> {t('hours.reviewFirst')}
        </p>
      )}
      <div className="overflow-x-auto">
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
                <td className="py-1 text-left font-bold">
                  <button type="button" onClick={() => setWho(r.patrollerId)} className="min-h-9 text-left underline decoration-dotted underline-offset-2">
                    {people.name(r.patrollerId)} ›
                  </button>
                </td>
                <td>{r.count}</td>
                <td>{r.minutes}</td>
                <td className="font-bold">{formatHoursMinutes(r.minutes)}</td>
                <td className={r.over ? 'font-bold text-amber-700' : ''}>{r.over}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="text-sm text-slate-600">{t('stats.noData')}</p>}
      <p className="text-xs text-slate-600">
        {t('hours.note')} {t('countNote')}
      </p>
      {flagged.length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className="text-sm font-bold">{t('hours.flagged')}</h4>
          {flagged.map((p) => (
            <button key={p.id} type="button" onClick={() => onOpen(p)} className="rounded-lg bg-white p-2 text-left text-sm ring-1 ring-amber-200">
              {formatShortDate(p.business_date)} {people.name(p.patroller_id)} — {p.duration_min ?? '—'}
              {t('detail.min')} {p.needs_time_review && t('dashboard.timeReview')}
            </button>
          ))}
        </div>
      )}
      {who && (
        <PatrolList
          title={`⏱️ ${people.name(who)}`}
          how={(() => {
            const xs = ps.filter((p) => p.status === 'valid' && p.duration_min !== null && p.patroller_id === who)
            return t('drill.hours', { n: xs.length, min: xs.reduce((a, p) => a + (p.duration_min ?? 0), 0) })
          })()}
          patrols={ps.filter((p) => p.status === 'valid' && p.duration_min !== null && p.patroller_id === who)}
          onClose={() => setWho(null)}
        />
      )}
    </Card>
  )
}
