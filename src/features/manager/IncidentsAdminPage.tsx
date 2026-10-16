import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { WfList } from '../incident/WfList'
import { useMe } from '../../app/auth'
import { Sheet } from '../../components/Sheet'
import { useToast } from '../../components/Toast'
import { Button, Card, ErrorBox, PageTitle, Segmented, Spinner, TextArea, TextInput } from '../../components/ui'
import {
  CONTACT_ICON,
  INCIDENT_ICON,
  INCIDENT_KINDS,
  INCIDENT_STATUSES,
  INCIDENT_STATUS_STYLE,
  URGENT_INCIDENTS,
  type ContactLog,
  type IncidentKind,
  type IncidentStatus,
} from '../../domain/incident'
import { SHIFTS, type Shift } from '../../domain/types'
import { currentLocale } from '../../i18n'
import { formatShortDate } from '../../domain/time'
import { cx } from '../../lib/cx'
import { errorMessage, storeName } from '../../lib/format'
import { unwrap, useStores } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { TranslationCancelled, useTranslationGate } from '../translate/useTranslationGate'
import { AttachmentList } from './AttachmentList'
import { fromLocalInput, jstDateTime, toLocalInput, useIncidents, type IncidentRow } from './data'
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
  const [editing, setEditing] = useState(false)
  const translation = useTranslationGate()
  const save = useMutation({
    mutationFn: async () => {
      // 対応内容・再発防止 are kept in Japanese; changed text in another language is translated after the writer confirms
      const next = { resolution: resolution.trim() || null, prevention: prevention.trim() || null }
      const changed = (['resolution', 'prevention'] as const).filter((k) => next[k] !== (r[k] ?? null))
      const tr = await translation.prepare(changed.map((k) => ({ key: k, label: t(`incidents.${k}`), text: next[k] })))
      const originals = { ...Object.fromEntries(Object.entries(r.original_texts ?? {}).filter(([k]) => !changed.includes(k as (typeof changed)[number]))), ...(tr.originals ?? {}) }
      unwrap(
        await supabase
          .from('incidents')
          .update({
            status,
            owner_name: owner.trim() || null,
            owner_id: owner.trim() ? (r.owner_id ?? me.id) : null,
            ...Object.fromEntries(changed.map((k) => [k, tr.values[k] ?? null])),
            original_texts: Object.keys(originals).length ? originals : null,
          })
          .eq('id', r.id),
      )
    },
    onSuccess: () => {
      toast(t('incidents.saved'))
      void queryClient.invalidateQueries({ queryKey: ['incidents'] })
      onClose()
    },
  })
  const needPrevention = status === 'done' && !prevention.trim()
  return (
    <Sheet title={`${INCIDENT_ICON[r.kind]} ${tc(`incident.kinds.${r.kind}`)}`} onClose={onClose}>
      {translation.review}
      <Card className="flex flex-col gap-1 text-sm">
        <p className="text-base font-bold">
          {formatShortDate(r.business_date)} {tc(`shift.${r.shift}`)} ・ {storeName(stores.data?.find((s) => s.id === r.store_id), 'ja')}
        </p>
        <p className="text-muted">
          {t('incidents.occurred')}: {jstDateTime(r.occurred_at)} ・ {t('incidents.reporter')}: {r.reporter_name}
        </p>
        <p className="mt-1 whitespace-pre-wrap">{r.description}</p>
        {r.original_texts?.description && <p className="text-xs text-muted">{t('detail.original')}: {r.original_texts.description}</p>}
        {r.injured_who && (
          <p>
            <b>{t('incidents.injured')}:</b> {r.injured_who.map((w) => (w === 'staff' && r.injured_staff ? `${tc('incident.injured.staff')}（${r.injured_staff}）` : tc(`incident.injured.${w}`))).join('・')}
          </p>
        )}
        {r.caller_type && (
          <p>
            <b>{t('incidents.caller')}:</b> {tc(`incident.caller.${r.caller_type}`)}
          </p>
        )}
        {(r.customer_name || r.customer_phone) && (
          <p>
            <b>{r.caller_type ? tc(`incident.party.${r.caller_type}.name`) : t('incidents.customer')}:</b> {r.customer_name ?? '—'}
            {r.customer_phone && (
              <>
                {' '}
                ・{' '}
                <a className="text-brand underline" href={`tel:${r.customer_phone.replace(/[^0-9+]/g, '')}`}>
                  {r.customer_phone}
                </a>
              </>
            )}
          </p>
        )}
        <ContactHistory r={r} />
        <p className="mt-1">
          <b>{t('incidents.action')}:</b> {r.action_taken ?? '—'}
          {r.action_source && <span className="ml-1 rounded-full bg-violet-100 px-2 text-xs font-bold text-violet-900">{t(`incidents.source.${r.action_source}`)}</span>}
        </p>
        {r.ai_suggestion && (
          <details className="rounded-lg bg-violet-50 p-2 text-xs">
            <summary className="cursor-pointer font-bold text-violet-900">🤖 {t('incidents.aiProposal', { n: r.ai_suggestion.basedOn.length, cases: r.ai_suggestion.cases })}</summary>
            <p className="mt-1 whitespace-pre-wrap text-sm">{r.ai_suggestion.ja}</p>
            <p className="mt-1 text-muted">
              {t('incidents.aiBasis')}:{' '}
              {r.ai_suggestion.basedOn.length
                ? r.ai_suggestion.basedOn.map((b) => `${formatShortDate(b.date)} ${tc(`incident.kinds.${b.kind}`)}`).join('、')
                : t('incidents.aiNoBasis')}
            </p>
          </details>
        )}
        {r.original_texts?.action_taken && <p className="text-xs text-muted">{t('detail.original')}: {r.original_texts.action_taken}</p>}
        <AttachmentList list={r.attachments} parentId={r.id} />
        {!editing && (
          <Button variant="secondary" className="mt-1 min-h-10 self-start py-1 text-sm" onClick={() => setEditing(true)}>
            ✏️ {t('incidents.editReport')}
          </Button>
        )}
      </Card>
      {editing && <IncidentEdit r={r} onDone={() => setEditing(false)} />}
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
        {save.error && !(save.error instanceof TranslationCancelled) && <ErrorBox message={errorMessage(save.error)} />}
        <Button onClick={() => save.mutate()} disabled={needPrevention || save.isPending}>
          {t('incidents.save')}
        </Button>
        {r.resolved_at && <p className="text-xs text-muted">{t('incidents.resolvedAt', { at: jstDateTime(r.resolved_at) })}</p>}
      </Card>
    </Sheet>
  )
}

/** 管理者への連絡: the reporter's taps on 電話する / LINEで送る and their answers. */
function ContactHistory({ r }: { r: IncidentRow }) {
  const { t } = useTranslation('manager')
  const { t: tc } = useTranslation()
  const log = useQuery({
    queryKey: ['emergency_contact_log', r.id],
    enabled: r.contact_method === 'phone' || r.contact_method === 'line',
    queryFn: async () => unwrap<ContactLog[]>(await supabase.from('emergency_contact_log').select('*').eq('incident_id', r.id).order('at')),
  })
  if (!r.contact_method) return null
  return (
    <div>
      <b>{t('incidents.contact')}:</b> {CONTACT_ICON[r.contact_method]} {tc(`incident.contact.method.${r.contact_method}`)}
      {(log.data ?? []).map((l) => (
        <p key={l.id} className="text-xs">
          {CONTACT_ICON[l.method]} {jstDateTime(l.at)} → {l.contact_name}: {l.result ? tc(`incident.contact.result.${l.result}`) : t('emergency.noAnswer')}
        </p>
      ))}
      {log.isSuccess && log.data.length === 0 && <p className="text-xs text-amber-800">{t('incidents.contactNoTap')}</p>}
    </div>
  )
}

/** 管理者が修正: what the staff member reported (kind, slot, time, what happened, what was done). */
function IncidentEdit({ r, onDone }: { r: IncidentRow; onDone: () => void }) {
  const { t } = useTranslation('manager')
  const { t: tc } = useTranslation()
  const toast = useToast()
  const stores = useStores()
  const queryClient = useQueryClient()
  const translation = useTranslationGate()
  const [kind, setKind] = useState<IncidentKind>(r.kind)
  const [storeId, setStoreId] = useState(r.store_id)
  const [shift, setShift] = useState<Shift>(r.shift)
  const [date, setDate] = useState(r.business_date)
  const [occurred, setOccurred] = useState(toLocalInput(r.occurred_at))
  const [description, setDescription] = useState(r.description)
  const [action, setAction] = useState(r.action_taken ?? '')
  const save = useMutation({
    mutationFn: async () => {
      const next = { description: description.trim(), action_taken: action.trim() || null }
      const changed = (['description', 'action_taken'] as const).filter((k) => next[k] !== (r[k] ?? null))
      const tr = await translation.prepare(changed.map((k) => ({ key: k, label: tc(`incident.${k === 'description' ? 'description' : 'action'}`), text: next[k] })))
      const originals = { ...Object.fromEntries(Object.entries(r.original_texts ?? {}).filter(([k]) => !changed.includes(k as (typeof changed)[number]))), ...(tr.originals ?? {}) }
      unwrap(
        await supabase
          .from('incidents')
          .update({
            kind,
            store_id: storeId,
            shift,
            business_date: date,
            occurred_at: fromLocalInput(occurred),
            ...Object.fromEntries(changed.map((k) => [k, tr.values[k] ?? null])),
            original_texts: Object.keys(originals).length ? originals : null,
          })
          .eq('id', r.id),
      )
    },
    onSuccess: () => {
      toast(t('incidents.saved'))
      void queryClient.invalidateQueries({ queryKey: ['incidents'] })
      onDone()
    },
  })
  return (
    <Card className="flex flex-col gap-3 ring-2 ring-blue-300">
      {translation.review}
      <h3 className="font-bold">✏️ {t('incidents.editReport')}</h3>
      <Segmented label={tc('incident.kind')} value={kind} onChange={setKind} columns={2} options={INCIDENT_KINDS.map((k) => ({ value: k, label: `${INCIDENT_ICON[k]} ${tc(`incident.kinds.${k}`)}` }))} />
      <Segmented label={tc('field.store')} value={storeId} onChange={setStoreId} options={(stores.data ?? []).map((s) => ({ value: s.id, label: storeName(s, currentLocale()) }))} />
      <Segmented label={tc('field.shift')} value={shift} onChange={setShift} options={SHIFTS.map((s) => ({ value: s, label: tc(`shift.${s}`) }))} />
      <TextInput label={tc('field.date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <label className="text-sm font-bold">
        {t('incidents.occurred')}
        <input type="datetime-local" className="min-h-11 w-full rounded-lg border border-slate-300 px-2" value={occurred} onChange={(e) => setOccurred(e.target.value)} />
      </label>
      <TextArea label={tc('incident.description')} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
      <TextArea label={tc('incident.action')} rows={2} value={action} onChange={(e) => setAction(e.target.value)} maxLength={2000} />
      {save.error && !(save.error instanceof TranslationCancelled) && <ErrorBox message={errorMessage(save.error)} />}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onDone} disabled={save.isPending}>
          {t('choreiEdit.cancel')}
        </Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending || !description.trim() || !date || !occurred}>
          {save.isPending ? tc('action.loading') : t('choreiEdit.save')}
        </Button>
      </div>
    </Card>
  )
}

/** 管理 → クレーム・事故. */
export function IncidentsAdminPage() {
  const { t } = useTranslation('manager')
  const { t: tc } = useTranslation()
  const stores = useStores()
  const q = useIncidents()
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'other' ? 'other' : 'wf'
  const [filter, setFilter] = useState<'open' | 'all'>('open')
  const [openId, setOpenId] = useState<string | null>(null)
  if (q.isLoading) return <Spinner />
  if (q.error) return <ErrorBox message={errorMessage(q.error)} />
  // 設備の故障 runs on the workflow (V2); the other kinds keep this list until stage 3
  const all = (q.data ?? []).filter((r) => !(r as { wf_state?: string | null }).wf_state)
  const list = filter === 'open' ? all.filter((r) => r.status !== 'done') : all
  const selected = all.find((r) => r.id === openId) ?? null
  const counts = Object.fromEntries(INCIDENT_STATUSES.map((s) => [s, all.filter((r) => r.status === s).length])) as Record<IncidentStatus, number>
  return (
    <div className="flex flex-col gap-3">
      <ManagerTabs />
      <PageTitle title={t('incidents.title')} subtitle={t('incidents.subtitle')} />
      <Segmented
        label=""
        value={view}
        onChange={(v) => setParams(v === 'other' ? { view: 'other' } : {})}
        options={[
          { value: 'wf', label: `📋 ${t('wf.allKinds')}` },
          { value: 'other', label: t('wf.otherKinds') },
        ]}
      />
      {view === 'wf' ? (
        <WfList key={params.get('open') ?? 'list'} dashboard initialOpen={params.get('open')} />
      ) : (
      <>
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
      </>
      )}
    </div>
  )
}
