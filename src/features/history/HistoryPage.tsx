import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { useAuth, useMe } from '../../app/auth'
import { Card, ErrorBox, Segmented, Spinner, PageTitle } from '../../components/ui'
import { cx } from '../../lib/cx'
import { formatShortDate, formatTokyoTime } from '../../domain/time'
import { currentLocale } from '../../i18n'
import { errorMessage, storeName } from '../../lib/format'
import { unwrap, useStores } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import type { AttachmentSummary, ChoreiRecord, PatrolCheck } from '../../lib/types'

type Tab = 'chorei' | 'patrol'

function TestBadge() {
  const { t } = useTranslation()
  return <span className="ml-2 rounded bg-slate-200 px-1 text-xs font-bold text-slate-700">{t('history.test')}</span>
}

function Attachments({ list }: { list?: AttachmentSummary[] }) {
  const { t } = useTranslation()
  const { isManager } = useAuth()
  const uploaded = (list ?? []).filter((a) => a.status === 'uploaded')
  if (uploaded.length === 0) return null
  return (
    <p className="flex flex-wrap gap-2 text-sm text-slate-700">
      {t('attach.count', { n: uploaded.length })}
      {isManager &&
        uploaded.map((a, i) =>
          a.drive_url ? (
            <a key={a.id} href={a.drive_url} target="_blank" rel="noreferrer" className="text-brand underline">
              {a.kind === 'video' ? '🎥' : '📷'}
              {i + 1}
            </a>
          ) : null,
        )}
    </p>
  )
}

function ChoreiList() {
  const { t } = useTranslation('chorei')
  const me = useMe()
  const stores = useStores()
  const q = useQuery({
    queryKey: ['my_chorei', me.id],
    queryFn: async () =>
      unwrap<ChoreiRecord[]>(
        await supabase.from('chorei_records').select('*, attachments(id, kind, status, drive_url)').eq('leader_id', me.id).order('business_date', { ascending: false }).limit(50),
      ),
  })
  if (q.isLoading) return <Spinner />
  if (q.error) return <ErrorBox message={errorMessage(q.error)} />
  if (!q.data?.length) return <p className="text-slate-600">{t('historyEmpty')}</p>
  return (
    <ul className="flex flex-col gap-2">
      {q.data.map((r) => (
        <li key={r.id}>
          <Card className={cx(r.status === 'void' && 'opacity-50')}>
            <p className="font-bold">
              {formatShortDate(r.business_date)} {t(`common:shift.${r.shift}`)} ・ {storeName(stores.data?.find((s) => s.id === r.store_id), currentLocale())}
              {r.status === 'void' && ` (${t('common:status.void')})`}
              {r.is_test && <TestBadge />}
            </p>
            <p className="text-sm text-slate-600">
              {formatTokyoTime(new Date(r.submitted_at))} ・ {t('previous.target')} {r.target_bowls ?? '—'} ・ {t('participants.label')}{' '}
              {r.participants.length + r.participants_extra.length + 1}
            </p>
            <Attachments list={r.attachments} />
            {r.caution_text && (
              <p lang="ja" className="text-sm">
                {r.caution_text}
              </p>
            )}
          </Card>
        </li>
      ))}
    </ul>
  )
}

function PatrolList() {
  const { t } = useTranslation('patrol')
  const me = useMe()
  const stores = useStores()
  const q = useQuery({
    queryKey: ['my_patrols', me.id],
    queryFn: async () =>
      unwrap<PatrolCheck[]>(
        await supabase
          .from('patrol_checks')
          .select('*, attachments(id, kind, status, drive_url)')
          .eq('patroller_id', me.id)
          .neq('status', 'draft')
          .order('business_date', { ascending: false })
          .limit(50),
      ),
  })
  if (q.isLoading) return <Spinner />
  if (q.error) return <ErrorBox message={errorMessage(q.error)} />
  if (!q.data?.length) return <p className="text-slate-600">{t('historyEmpty')}</p>
  return (
    <ul className="flex flex-col gap-2">
      {q.data.map((r) => (
        <li key={r.id}>
          <Card className={cx(r.status === 'void' && 'opacity-50')}>
            <div className="flex items-baseline justify-between">
              <p className="font-bold">
                {formatShortDate(r.business_date)} {t(`common:shift.${r.shift}`)} ・ {storeName(stores.data?.find((s) => s.id === r.store_id), currentLocale())}
                {r.is_test && <TestBadge />}
              </p>
              <p className="font-bold text-brand">
                {r.total}/{r.max_total}
              </p>
            </div>
            <p className="text-sm text-slate-600">
              {r.judgement && t(`common:judgement.${r.judgement}`)} ・ {formatTokyoTime(new Date(r.started_at))}–
              {r.ended_at && formatTokyoTime(new Date(r.ended_at))}（{t('minutes', { min: r.duration_min ?? 0 })}）
              {r.needs_time_review && ` ・ ⚠️ ${t('timeReview')}`}
            </p>
            <Attachments list={r.attachments} />
          </Card>
        </li>
      ))}
    </ul>
  )
}

export function HistoryPage() {
  const { t } = useTranslation()
  const { canPatrol } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab: Tab = canPatrol && params.get('tab') === 'patrol' ? 'patrol' : 'chorei'

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title={t('history.title')} />
      {canPatrol && (
        <Segmented<Tab>
          label=""
          value={tab}
          onChange={(v) => setParams(v === 'patrol' ? { tab: 'patrol' } : {})}
          options={[
            { value: 'chorei', label: t('history.chorei') },
            { value: 'patrol', label: t('history.patrol') },
          ]}
        />
      )}
      {tab === 'chorei' ? <ChoreiList /> : <PatrolList />}
    </div>
  )
}
