import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Card, ErrorBox, Spinner } from '../../components/ui'
import { PATROL_TARGET_25 } from '../../domain/patrol'
import {
  byStoreShift,
  choreiPeople,
  choreiSlots,
  completion,
  dateRange,
  itemAverages,
  patrolSummary,
  score25,
  skippedSteps,
  staffRanking,
  weeklyTrend,
} from '../../domain/stats'
import { countFrom } from '../../domain/operation'
import { formatShortDate } from '../../domain/time'
import { cx } from '../../lib/cx'
import { errorMessage, storeName } from '../../lib/format'
import { useStores } from '../../lib/queries'
import { Bar, PeriodBar, Stat } from './common'
import { exportXlsx, jstDateTime, usePeople, useRecords, usePeriod } from './data'
import { ManagerTabs } from './ManagerTabs'

const ITEM_NAME = { score_smile: 'smile', score_voice: 'voice', score_grooming: 'grooming', score_clean: 'clean', score_quality: 'quality' } as const

export function StatsPage() {
  const { t } = useTranslation('manager')
  const period = usePeriod('month')
  const stores = useStores()
  const people = usePeople()
  const { chorei, patrols, isLoading, error } = useRecords(period.range)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  if (isLoading || stores.isLoading) return <Spinner />
  if (error) return <ErrorBox message={errorMessage(error)} />

  const now = new Date()
  // statistics start on the operation day (10/12); earlier days are the test period
  const from = countFrom(period.range.from)
  const { to } = period.range
  const storeIds = (stores.data ?? []).map((s) => s.id)
  const ps = patrols.data ?? []
  const rs = chorei.data ?? []
  const summary = patrolSummary(ps)
  const slots = choreiSlots(rs, dateRange(from, to), storeIds, now)
  const choreiRate = completion(slots)
  const table = byStoreShift(ps, storeIds)
  const items = itemAverages(ps)
  const trend = weeklyTrend(ps, rs, from, to, storeIds, now)
  const ranking = staffRanking(ps)
  const crowd = choreiPeople(rs, people.name)
  const skipped = skippedSteps(rs).filter((s) => s.count > 0)
  const storeJa = (id: string) => storeName(stores.data?.find((s) => s.id === id), 'ja')
  const shiftJa = (s: string) => t(`common:shift.${s}`, { lng: 'ja' })

  const doExport = async () => {
    setExporting(true)
    setExportError(null)
    try {
      await exportXlsx(`金龍_集計_${from}_${to}.xlsx`, [
        {
          name: '概要',
          rows: [
            ['項目', '値'],
            ['期間', `${from} 〜 ${to}`],
            ['巡回 平均（25点換算）', summary.average],
            ['目標', PATROL_TARGET_25],
            ['巡回 回数', summary.count],
            ['良好', summary.good],
            ['要改善', summary.improve],
            ['即日指導', summary.coaching],
            ['マスク', summary.mask],
            ['朝礼 実施率(%)', choreiRate.rate],
            ['朝礼 実施/対象', `${choreiRate.done}/${choreiRate.due}`],
          ],
        },
        { name: '店舗×シフト', rows: [['店舗', 'シフト', '巡回回数', '平均（25点換算）'], ...table.map((r) => [storeJa(r.storeId), shiftJa(r.shift), r.count, r.average])] },
        { name: '項目別', rows: [['項目', '平均（5点）', '件数'], ...items.map((i) => [t(`patrol:items.${ITEM_NAME[i.key]}.name`, { lng: 'ja' }), i.average, i.count])] },
        { name: '週別', rows: [['週（月曜）', '巡回回数', '平均', '即日指導', '朝礼 実施率(%)'], ...trend.map((w) => [w.week, w.count, w.average, w.coaching, w.chorei.rate])] },
        { name: '個人ランキング', rows: [['順位', '名前', '平均（25点換算）', '巡回回数', '最高', '最低'], ...ranking.map((r) => [r.rank, r.name, r.average, r.count, r.best, r.worst])] },
        { name: '朝礼 誘導者', rows: [['名前', '回数'], ...crowd.leaders.map((x) => [x.name, x.count])] },
        { name: '朝礼 参加者', rows: [['名前', '回数'], ...crowd.participants.map((x) => [x.name, x.count])] },
        { name: '朝礼 未実施の手順', rows: [['手順', '回数', '理由'], ...skippedSteps(rs).map((s) => [t(`chorei:steps.${s.step}`, { lng: 'ja' }), s.count, s.reasons.join(' / ')])] },
        {
          name: '巡回一覧',
          rows: [
            ['日付', '店舗', 'シフト', '種類', '巡回者', '開始', '終了', '分', '笑顔', 'マスク', '声出し', '身だしなみ', '清潔', '提供品質', '合計', '満点', '25点換算', '判定', '対象スタッフ', '状態'],
            ...ps
              .filter((p) => p.status !== 'draft')
              .map((p) => [
                p.business_date,
                storeJa(p.store_id),
                shiftJa(p.shift),
                t(`patrol:type.${p.patrol_type}`, { lng: 'ja' }),
                people.name(p.patroller_id),
                jstDateTime(p.started_at),
                jstDateTime(p.ended_at),
                p.duration_min,
                p.score_smile,
                p.mask_worn ? 'あり' : '',
                p.score_voice,
                p.score_grooming,
                p.score_clean,
                p.score_quality ?? '－',
                p.total,
                p.max_total,
                p.total !== null && p.max_total ? Math.round(score25(p) * 10) / 10 : null,
                p.judgement ? t(`common:judgement.${p.judgement}`, { lng: 'ja' }) : '',
                p.staff_names.join('、') || p.staff_on_shift,
                t(`common:status.${p.status}`, { lng: 'ja' }),
              ]),
          ],
        },
        {
          name: '朝礼一覧',
          rows: [
            ['日付', '店舗', 'シフト', '誘導者', '参加者', '目標杯数', '注意点', '状態'],
            ...rs.map((r) => [r.business_date, storeJa(r.store_id), shiftJa(r.shift), people.name(r.leader_id), r.participants_extra.join('、'), r.target_bowls, r.caution_text, t(`common:status.${r.status}`, { lng: 'ja' })]),
          ],
        },
      ])
    } catch (err) {
      setExportError(errorMessage(err))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ManagerTabs />
      <h1 className="text-xl font-bold">📈 {t('stats.title')}</h1>
      <PeriodBar period={period} />
      <p className="text-xs text-slate-500">{t('countNote')}</p>
      <Button variant="secondary" onClick={() => void doExport()} disabled={exporting}>
        ⬇️ {exporting ? t('common:action.loading') : t('stats.export')}
      </Button>
      {exportError && <ErrorBox message={exportError} />}

      <div className="grid grid-cols-2 gap-2">
        <Stat
          label={t('dashboard.avgScore')}
          value={summary.average ?? '—'}
          sub={t('dashboard.target', { n: PATROL_TARGET_25 })}
          tone={summary.average === null ? undefined : summary.average >= PATROL_TARGET_25 ? 'good' : 'warn'}
        />
        <Stat label={t('dashboard.choreiRate')} value={choreiRate.rate === null ? '—' : `${choreiRate.rate}%`} sub={`${choreiRate.done}/${choreiRate.due}`} />
        <Stat label={t('dashboard.patrols')} value={summary.count} sub={`${t('common:judgement.coaching')} ${summary.coaching}`} tone={summary.coaching ? 'bad' : undefined} />
        <Stat label={t('dashboard.mask')} value={summary.mask} />
      </div>

      <Card className="flex flex-col gap-2">
        <h2 className="font-bold">{t('stats.byStoreShift')}</h2>
        {table.map((r) => (
          <div key={`${r.storeId}-${r.shift}`} className="grid grid-cols-[7rem_1fr_3.5rem] items-center gap-2 text-sm">
            <span>
              {storeJa(r.storeId).replace('店', '')} {t(`common:shift.${r.shift}`)}
            </span>
            <Bar value={r.average} max={25} target={PATROL_TARGET_25} />
            <span className="text-right font-bold">
              {r.average ?? '—'}
              <span className="text-xs font-normal text-slate-500">（{r.count}）</span>
            </span>
          </div>
        ))}
        <p className="text-xs text-slate-500">{t('stats.scaleNote')}</p>
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="font-bold">{t('stats.byItem')}</h2>
        {items.map((i) => (
          <div key={i.key} className="grid grid-cols-[7rem_1fr_3rem] items-center gap-2 text-sm">
            <span>{t(`patrol:items.${ITEM_NAME[i.key]}.name`)}</span>
            <Bar value={i.average} max={5} target={4} />
            <span className="text-right font-bold">{i.average ?? '—'}</span>
          </div>
        ))}
        {(() => {
          const weakest = items.filter((i) => i.average !== null).sort((a, b) => a.average! - b.average!)[0]
          return weakest ? <p className="text-sm">⚠️ {t('stats.weakest', { item: t(`patrol:items.${ITEM_NAME[weakest.key]}.name`) })}</p> : null
        })()}
      </Card>

      {trend.length > 1 && (
        <Card className="flex flex-col gap-1">
          <h2 className="font-bold">{t('stats.trend')}</h2>
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="text-left">{t('stats.week')}</th>
                <th>{t('dashboard.patrols')}</th>
                <th>{t('dashboard.avgScore')}</th>
                <th>{t('dashboard.choreiRate')}</th>
              </tr>
            </thead>
            <tbody>
              {trend.map((w) => (
                <tr key={w.week} className="border-t border-slate-100 text-center">
                  <td className="py-1 text-left">{formatShortDate(w.week)}〜</td>
                  <td>{w.count}</td>
                  <td className={cx('font-bold', w.average !== null && (w.average >= PATROL_TARGET_25 ? 'text-green-700' : 'text-amber-700'))}>{w.average ?? '—'}</td>
                  <td>{w.chorei.rate === null ? '—' : `${w.chorei.rate}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="flex flex-col gap-2">
        <h2 className="font-bold">🏅 {t('stats.ranking')}</h2>
        <p className="text-xs text-slate-500">{t('stats.rankingNote')}</p>
        {ranking.length === 0 ? (
          <p className="text-sm text-slate-500">{t('stats.noData')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="text-left">#</th>
                <th className="text-left">{t('stats.name')}</th>
                <th>{t('dashboard.avgScore')}</th>
                <th>{t('stats.times')}</th>
                <th>{t('stats.range')}</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((r) => (
                <tr key={r.name} className="border-t border-slate-100 text-center">
                  <td className="py-1 text-left font-bold">{r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</td>
                  <td className="text-left">{r.name}</td>
                  <td className={cx('font-bold', r.average >= PATROL_TARGET_25 ? 'text-green-700' : 'text-amber-700')}>{r.average}</td>
                  <td>{r.count}</td>
                  <td className="text-xs">
                    {r.worst}–{r.best}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="font-bold">📣 {t('stats.leaders')}</h2>
        <ul className="flex flex-wrap gap-2 text-sm">
          {crowd.leaders.map((x) => (
            <li key={x.name} className="rounded-full bg-slate-100 px-3 py-1">
              {x.name} <b>{x.count}</b>
            </li>
          ))}
        </ul>
        <h3 className="text-sm font-bold">{t('stats.participants')}</h3>
        <ul className="flex flex-wrap gap-2 text-sm">
          {crowd.participants.map((x) => (
            <li key={x.name} className="rounded-full bg-slate-50 px-3 py-1">
              {x.name} <b>{x.count}</b>
            </li>
          ))}
        </ul>
        {skipped.length > 0 && (
          <>
            <h3 className="text-sm font-bold">{t('stats.skipped')}</h3>
            <ul className="text-sm">
              {skipped.map((s) => (
                <li key={s.step}>
                  {t(`chorei:steps.${s.step}`)}: <b>{s.count}</b> {s.reasons.length > 0 && `（${s.reasons.join(' / ')}）`}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  )
}
