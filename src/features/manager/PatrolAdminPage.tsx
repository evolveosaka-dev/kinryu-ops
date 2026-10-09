import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { Card, ErrorBox, Spinner, PageTitle } from '../../components/ui'
import { normalizedTo25 } from '../../domain/patrol'
import { formatShortDate, formatTokyoTime } from '../../domain/time'
import { PATROL_TYPES, SHIFTS } from '../../domain/types'
import { currentLocale } from '../../i18n'
import { cx } from '../../lib/cx'
import { errorMessage, storeName } from '../../lib/format'
import { useStores } from '../../lib/queries'
import { PeriodBar, Dot } from './common'
import { usePeople, useRecords, type AdminPatrol, usePeriod, JUDGE_STYLE } from './data'
import { PatrolDetail } from './details'
import { ManagerTabs } from './ManagerTabs'

const selectClass = 'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm'

export function PatrolAdminPage() {
  const { t } = useTranslation('manager')
  const [params, setParams] = useSearchParams()
  const period = usePeriod('month')
  const stores = useStores()
  const people = usePeople()
  const { patrols, isLoading, error } = useRecords(period.range)
  const [store, setStore] = useState('')
  const [shift, setShift] = useState('')
  const [type, setType] = useState('')
  const [patroller, setPatroller] = useState('')
  const [judgement, setJudgement] = useState('')
  const [selected, setSelected] = useState<AdminPatrol | null>(null)
  const filter = params.get('filter') ?? ''

  if (isLoading) return <Spinner />
  if (error) return <ErrorBox message={errorMessage(error)} />

  const all = patrols.data ?? []
  const list = all.filter(
    (p) =>
      (p.status !== 'draft' || p.needs_time_review) &&
      (!store || p.store_id === store) &&
      (!shift || p.shift === shift) &&
      (!type || p.patrol_type === type) &&
      (!patroller || p.patroller_id === patroller) &&
      (!judgement || p.judgement === judgement) &&
      (filter !== 'coaching' || (p.judgement === 'coaching' && !p.follow_up_done_at && p.status === 'valid')) &&
      (filter !== 'time' || p.needs_time_review),
  )
  const patrollers = [...new Set(all.map((p) => p.patroller_id))]
  const storeLabel = (id: string) => storeName(stores.data?.find((s) => s.id === id), currentLocale())

  return (
    <div className="flex flex-col gap-3">
      <ManagerTabs />
      <PageTitle title={t('patrolList.title')} />
      <PeriodBar period={period} />

      <Card className="grid grid-cols-2 gap-2">
        <select className={selectClass} value={store} onChange={(e) => setStore(e.target.value)} aria-label={t('filter.store')}>
          <option value="">{t('filter.allStores')}</option>
          {stores.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {storeLabel(s.id)}
            </option>
          ))}
        </select>
        <select className={selectClass} value={shift} onChange={(e) => setShift(e.target.value)} aria-label={t('filter.shift')}>
          <option value="">{t('filter.allShifts')}</option>
          {SHIFTS.map((s) => (
            <option key={s} value={s}>
              {t(`common:shift.${s}`)}
            </option>
          ))}
        </select>
        <select className={selectClass} value={type} onChange={(e) => setType(e.target.value)} aria-label={t('filter.type')}>
          <option value="">{t('filter.allTypes')}</option>
          {PATROL_TYPES.map((x) => (
            <option key={x} value={x}>
              {t(`patrol:type.${x}`)}
            </option>
          ))}
        </select>
        <select className={selectClass} value={patroller} onChange={(e) => setPatroller(e.target.value)} aria-label={t('filter.patroller')}>
          <option value="">{t('filter.allPatrollers')}</option>
          {patrollers.map((id) => (
            <option key={id} value={id}>
              {people.name(id)}
            </option>
          ))}
        </select>
        <select className={selectClass} value={judgement} onChange={(e) => setJudgement(e.target.value)} aria-label={t('filter.judgement')}>
          <option value="">{t('filter.allJudgements')}</option>
          {['good', 'improve', 'coaching'].map((j) => (
            <option key={j} value={j}>
              {t(`common:judgement.${j}`)}
            </option>
          ))}
        </select>
        <select className={selectClass} value={filter} onChange={(e) => setParams(e.target.value ? { filter: e.target.value } : {})} aria-label={t('filter.todo')}>
          <option value="">{t('filter.all')}</option>
          <option value="coaching">{t('dashboard.coaching')}</option>
          <option value="time">{t('dashboard.timeReview')}</option>
        </select>
      </Card>

      <p className="text-sm text-slate-600">{t('patrolList.count', { n: list.length })}</p>
      <ul className="flex flex-col gap-2">
        {list.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => setSelected(p)}
              className={cx('flex w-full flex-col gap-1 rounded-2xl bg-white p-3 text-left border border-line', p.status === 'void' && 'opacity-50')}
            >
              <span className="flex items-center justify-between">
                <b>
                  {formatShortDate(p.business_date)} {t(`common:shift.${p.shift}`)} {storeLabel(p.store_id)}
                </b>
                {p.judgement && (
                  <span className={`rounded-full px-2 text-sm font-bold ${JUDGE_STYLE[p.judgement] ?? ''}`}>
                    {p.total}/{p.max_total} {t(`common:judgement.${p.judgement}`)}
                  </span>
                )}
              </span>
              <span className="text-sm text-slate-600">
                {people.name(p.patroller_id)} ・ {t(`patrol:type.${p.patrol_type}`)} ・ {formatTokyoTime(new Date(p.started_at))}（{p.duration_min ?? '—'}
                {t('detail.min')}）
                {p.total !== null && p.max_total === 20 && ` ・ ${t('detail.score25', { score: Math.round(normalizedTo25(p.total, 20) * 10) / 10 })}`}
              </span>
              <span className="flex flex-wrap gap-1 text-xs font-bold">
                {p.status === 'draft' && <span className="rounded bg-slate-200 px-1">{t('common:status.draft')}</span>}
                {p.status === 'void' && <span className="rounded bg-slate-200 px-1">{t('common:status.void')}</span>}
                {p.needs_time_review && <span className="rounded bg-amber-100 px-1 text-amber-900"><Dot tone="amber" /> {t('dashboard.timeReview')}</span>}
                {p.judgement === 'coaching' && !p.follow_up_done_at && p.status === 'valid' && <span className="rounded bg-red-100 px-1 text-red-900"><Dot tone="red" /> {t('detail.followUpOpen')}</span>}
                {p.follow_up_done_at && <span className="rounded bg-green-100 px-1 text-green-900">✓ {t('detail.followUpShort')}</span>}
                {p.mask_worn && <span className="rounded bg-slate-100 px-1">😷</span>}
                {p.attachments.some((a) => a.status === 'uploaded') && <span className="rounded bg-slate-100 px-1">{p.attachments.filter((a) => a.status === 'uploaded').length}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {selected && <PatrolDetail patrol={selected} patrollerName={people.name(selected.patroller_id)} onClose={() => setSelected(null)} />}
    </div>
  )
}
