import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMe } from '../../app/auth'
import { Sheet } from '../../components/Sheet'
import { useToast } from '../../components/Toast'
import { Button, Card, ErrorBox, PageTitle, Segmented, Spinner, TextArea, TextInput } from '../../components/ui'
import { INCIDENT_ICON, INCIDENT_STATUSES, INCIDENT_STATUS_STYLE, URGENT_INCIDENTS, type IncidentStatus } from '../../domain/incident'
import { formatShortDate } from '../../domain/time'
import { cx } from '../../lib/cx'
import { errorMessage, storeName } from '../../lib/format'
import { unwrap, useStores } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { AttachmentList } from './AttachmentList'
import { jstDateTime, useIncidents, type IncidentRow } from './data'
import { ManagerTabs } from './ManagerTabs'

function IncidentSheet({ r, onClose }: { r: IncidentRow; onClose: () => void }) {
  const { t } = useTranslation('manager')
  const { t: tc } = useTranslation()
  const me = useMe()
  const toast = useToast()
  const stores = useStores()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<IncidentStatus>(r.status)
  const [owner, setOwner] = useState(r.owner_name ?? me.full_name ?? me.display_name ?? '')
  const [resolution, setResolution] = useState(r.resolution ?? '')
  const [prevention, setPrevention] = useState(r.prevention ?? '')
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await supabase
          .from('incidents')
          .update({ status, owner_name: owner.trim() || null, owner_id: owner.trim() ? (r.owner_id ?? me.id) : null, resolution: resolution.trim() || null, prevention: prevention.trim() || null })
          .eq('id', r.id),
      ),
    onSuccess: () => {
      toast(t('incidents.saved'))
      void queryClient.invalidateQueries({ queryKey: ['incidents'] })
      onClose()
    },
  })
  const needPrevention = status === 'done' && !prevention.trim()
  return (
    <Sheet title={`${INCIDENT_ICON[r.kind]} ${tc(`incident.kinds.${r.kind}`)}`} onClose={onClose}>
      <Card className="flex flex-col gap-1 text-sm">
        <p className="text-base font-bold">
          {formatShortDate(r.business_date)} {tc(`shift.${r.shift}`)} ・ {storeName(stores.data?.find((s) => s.id === r.store_id), 'ja')}
        </p>
        <p className="text-muted">
          {t('incidents.occurred')}: {jstDateTime(r.occurred_at)} ・ {t('incidents.reporter')}: {r.reporter_name}
        </p>
        <p className="mt-1 whitespace-pre-wrap">{r.description}</p>
        {r.original_texts?.description && <p className="text-xs text-muted">{t('detail.original')}: {r.original_texts.description}</p>}
        <p className="mt-1">
          <b>{t('incidents.action')}:</b> {r.action_taken ?? '—'}
        </p>
        {r.original_texts?.action_taken && <p className="text-xs text-muted">{t('detail.original')}: {r.original_texts.action_taken}</p>}
        <AttachmentList list={r.attachments} parentId={r.id} />
      </Card>
      <Card className="flex flex-col gap-3">
        <Segmented label={t('incidents.statusLabel')} value={status} onChange={setStatus} options={INCIDENT_STATUSES.map((s) => ({ value: s, label: tc(`incident.status.${s}`) }))} />
        <TextInput label={t('incidents.owner')} value={owner} onChange={(e) => setOwner(e.target.value)} />
        <TextArea label={t('incidents.resolution')} rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} />
        <TextArea
          label={`${t('incidents.prevention')}${status === 'done' ? ' *' : ''}`}
          hint={t('incidents.preventionHint')}
          rows={2}
          value={prevention}
          onChange={(e) => setPrevention(e.target.value)}
          error={needPrevention ? t('incidents.preventionNeeded') : null}
        />
        {save.error && <ErrorBox message={errorMessage(save.error)} />}
        <Button onClick={() => save.mutate()} disabled={needPrevention || save.isPending}>
          {t('incidents.save')}
        </Button>
        {r.resolved_at && <p className="text-xs text-muted">{t('incidents.resolvedAt', { at: jstDateTime(r.resolved_at) })}</p>}
      </Card>
    </Sheet>
  )
}

/** 管理 → クレーム・事故. */
export function IncidentsAdminPage() {
  const { t } = useTranslation('manager')
  const { t: tc } = useTranslation()
  const stores = useStores()
  const q = useIncidents()
  const [filter, setFilter] = useState<'open' | 'all'>('open')
  const [openId, setOpenId] = useState<string | null>(null)
  if (q.isLoading) return <Spinner />
  if (q.error) return <ErrorBox message={errorMessage(q.error)} />
  const all = q.data ?? []
  const list = filter === 'open' ? all.filter((r) => r.status !== 'done') : all
  const selected = all.find((r) => r.id === openId) ?? null
  const counts = Object.fromEntries(INCIDENT_STATUSES.map((s) => [s, all.filter((r) => r.status === s).length])) as Record<IncidentStatus, number>
  return (
    <div className="flex flex-col gap-3">
      <ManagerTabs />
      <PageTitle title={t('incidents.title')} subtitle={t('incidents.subtitle')} />
      <div className="grid grid-cols-3 gap-2 text-center">
        {INCIDENT_STATUSES.map((s) => (
          <div key={s} className={cx('rounded-xl p-2', INCIDENT_STATUS_STYLE[s])}>
            <span className="block text-xs font-bold">{tc(`incident.status.${s}`)}</span>
            <b className="text-xl">{counts[s]}</b>
          </div>
        ))}
      </div>
      <Segmented
        label=""
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'open', label: t('incidents.filterOpen') },
          { value: 'all', label: t('incidents.filterAll') },
        ]}
      />
      {list.length === 0 ? (
        <p className="rounded-xl bg-surface p-4 text-center text-muted">{t('incidents.none')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setOpenId(r.id)}
                className={cx(
                  'flex w-full flex-col gap-1 rounded-xl border bg-white p-3 text-left active:bg-surface',
                  URGENT_INCIDENTS.includes(r.kind) && r.status !== 'done' ? 'border-red-300' : 'border-line',
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <b>
                    {INCIDENT_ICON[r.kind]} {tc(`incident.kinds.${r.kind}`)}
                  </b>
                  <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-xs font-bold', INCIDENT_STATUS_STYLE[r.status])}>{tc(`incident.status.${r.status}`)}</span>
                </span>
                <span className="text-sm text-muted">
                  {formatShortDate(r.business_date)} {tc(`shift.${r.shift}`)} ・ {storeName(stores.data?.find((s) => s.id === r.store_id), 'ja')} ・ {r.reporter_name}
                </span>
                <span className="line-clamp-2 text-sm">{r.description}</span>
                {r.owner_name && <span className="text-xs text-muted">{t('incidents.owner')}: {r.owner_name}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && <IncidentSheet key={selected.id} r={selected} onClose={() => setOpenId(null)} />}
    </div>
  )
}
