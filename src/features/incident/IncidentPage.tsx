import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { useMe } from '../../app/auth'
import { useToast } from '../../components/Toast'
import { Button, Card, Checkbox, ErrorBox, PageTitle, Segmented, SectionTitle, Spinner, TextArea, TextInput } from '../../components/ui'
import {
  CALLER_TYPES,
  CUSTOMER_KINDS,
  INCIDENT_ICON,
  INCIDENT_KINDS,
  INCIDENT_STATUS_STYLE,
  lineMessage,
  URGENT_INCIDENTS,
  type AiSuggestion,
  type CallerType,
  type ContactLog,
  type ContactMethod,
  type Incident,
  type IncidentKind,
} from '../../domain/incident'
import { PRIORITIES, PRIORITY_STYLE, type Priority } from '../../domain/incidentWorkflow'
import { currentSlot, formatShortDate } from '../../domain/time'
import { currentLocale } from '../../i18n'
import { cx } from '../../lib/cx'
import { errorMessage, storeName } from '../../lib/format'
import { initialStore, setLastStore } from '../../lib/lastStore'
import { unwrap, useStores } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import type { PreparedMedia } from '../../lib/media'
import { AttachmentPicker } from '../attachments/AttachmentPicker'
import { useUploadQueue } from '../attachments/uploadQueue'
import { TranslationCancelled, useTranslationGate } from '../translate/useTranslationGate'
import { AiProposal } from './AiProposal'
import { ContactManager } from './ContactManager'
import { formatWhen } from './data'
import { InjuredStaffPicker } from './InjuredStaffPicker'
import { OccurredAt } from './OccurredAt'
import { useEquipment } from './wfData'
import { WfList } from './WfList'

/** Name + phone of the customer / the caller of a 電話の伝言 (optional). */
function PartyFields({
  party,
  name,
  phone,
  onName,
  onPhone,
}: {
  party: 'customer' | CallerType
  name: string
  phone: string
  onName: (v: string) => void
  onPhone: (v: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-2">
      {party === 'customer' && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">👤 {t('incident.customerHint')}</p>}
      <div className="grid grid-cols-2 gap-2 [&>div]:justify-between">
        <TextInput label={t(`incident.party.${party}.name`)} value={name} maxLength={100} autoComplete="off" onChange={(e) => onName(e.target.value)} />
        <TextInput
          label={t(`incident.party.${party}.phone`)}
          type="tel"
          inputMode="tel"
          value={phone}
          maxLength={40}
          autoComplete="off"
          onChange={(e) => onPhone(e.target.value)}
        />
      </div>
    </div>
  )
}

/** My own records (RLS: the reporter sees their own). */
function useMyIncidents(userId: string) {
  return useQuery({
    queryKey: ['incidents', 'mine', userId],
    queryFn: async () =>
      unwrap<Incident[]>(await supabase.from('incidents').select('*').eq('reporter_id', userId).order('occurred_at', { ascending: false }).limit(20)),
  })
}

/** メニュー → クレーム・事故の記録: any staff member, at once, with photos. */
export function IncidentPage() {
  const { t } = useTranslation()
  const me = useMe()
  const toast = useToast()
  const queryClient = useQueryClient()
  const stores = useStores()
  const uploads = useUploadQueue()
  const gate = useTranslationGate()
  const mine = useMyIncidents(me.id)
  const equipment = useEquipment()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'wf' ? 'wf' : 'new'
  const storeIds = (stores.data ?? []).map((s) => s.id)
  const [store, setStore] = useState<string>('')
  const [kind, setKind] = useState<IncidentKind | null>(null)
  const [at, setAt] = useState(() => new Date().toISOString())
  const [atNow, setAtNow] = useState(false)
  const [description, setDescription] = useState('')
  // the writer's own words when 「AIで翻訳」 turned the description into Japanese
  const [descOriginal, setDescOriginal] = useState<{ text: string; lang: string } | null>(null)
  const [injured, setInjured] = useState<{ staff: boolean; customer: boolean }>({ staff: false, customer: false })
  const [injuredStaff, setInjuredStaff] = useState<string | null>(null)
  const [caller, setCaller] = useState<CallerType | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [contact, setContact] = useState<ContactMethod | null>(null)
  const [contactLogs, setContactLogs] = useState<ContactLog[]>([])
  const [ai, setAi] = useState<AiSuggestion | null>(null)
  const [actionSource, setActionSource] = useState<'ai' | 'own' | null>(null)
  const [action, setAction] = useState('')
  const [media, setMedia] = useState<PreparedMedia[]>([])
  // 設備の故障 (Workflow V2): equipment, priority, 発生 (unknown → 発見 is the start)
  const [eqId, setEqId] = useState('')
  const [eqOther, setEqOther] = useState('')
  const [priority, setPriority] = useState<Priority>('normal')
  const [occurredKnown, setOccurredKnown] = useState(false)
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString())
  const storeId = store || initialStore(storeIds)
  const needAction = actionSource === 'own' && !action.trim()
  const isEq = kind === 'equipment'
  const eqList = (equipment.data ?? []).filter((e) => e.store_id === storeId)
  const ready = Boolean(kind && kind !== 'lost_item' && storeId && description.trim() && contact && !needAction && (!isEq || eqId || eqOther.trim()))
  const storeLabel = storeName(stores.data?.find((s) => s.id === storeId), 'ja')
  // name + phone of the other side: customers for most kinds, the caller for 電話の伝言
  const party: 'customer' | CallerType | null =
    kind === 'phone_message' ? caller : kind === 'injury' ? (injured.customer ? 'customer' : null) : kind && CUSTOMER_KINDS.includes(kind) ? 'customer' : null
  const injuredWho = kind === 'injury' ? (['staff', 'customer'] as const).filter((w) => injured[w]) : []

  const translate = useMutation({
    mutationFn: async () => {
      const g = await gate.prepare([{ key: 'description', label: t('incident.description'), text: description.trim() }], {
        confirmLabel: t('incident.translateUse'),
      })
      if (!g.originals) throw new Error(t('incident.alreadyJapanese'))
      setDescription(g.values.description ?? '')
      setDescOriginal({ text: g.originals.description!, lang: g.sourceLang ?? '' })
    },
  })

  const send = useMutation({
    mutationFn: async () => {
      const g = await gate.prepare([
        { key: 'description', label: t('incident.description'), text: description.trim() },
        { key: 'action_taken', label: t('incident.action'), text: action.trim() || null },
      ])
      // a description translated with 「AIで翻訳」 keeps the words written first
      const originals = { ...(descOriginal && !g.originals?.description ? { description: descOriginal.text } : {}), ...(g.originals ?? {}) }
      // 設備の故障: `at` is 発見日時; 発生日時 only when known
      const occurred = isEq && occurredKnown ? occurredAt : at
      const slot = currentSlot(new Date(occurred))
      const id = unwrap<string>(
        await supabase.rpc('report_incident', {
          p_store: storeId,
          p_date: slot.businessDate,
          p_shift: slot.shift,
          p_occurred_at: occurred,
          p_kind: kind!,
          p_description: g.values.description!,
          p_action: g.values.action_taken,
          p_original_texts: Object.keys(originals).length ? originals : null,
          p_source_lang: g.sourceLang ?? descOriginal?.lang ?? null,
          p_customer_name: party ? customerName.trim() || null : null,
          p_customer_phone: party ? customerPhone.trim() || null : null,
          p_contact_method: contact,
          p_contact_logs: contactLogs.map((l) => l.id),
          p_ai_suggestion: ai,
          p_action_source: ai ? actionSource : null,
          p_injured_who: injuredWho.length ? injuredWho : null,
          p_injured_staff: injured.staff ? injuredStaff : null,
          p_caller_type: kind === 'phone_message' ? caller : null,
          p_equipment_id: isEq && eqId ? eqId : null,
          p_equipment_name: isEq && !eqId ? eqOther.trim() : null,
          p_priority: isEq ? priority : 'normal',
          p_discovered_at: isEq ? at : null,
          p_occurred_known: isEq ? occurredKnown : true,
        }),
      )
      if (media.length) await uploads.enqueue('incident', id, media)
      setLastStore(storeId)
      return { id, equipment: isEq }
    },
    onSuccess: (res) => {
      toast(t('incident.sent'))
      // a 設備の故障 opens in the list, to follow it
      if (res.equipment) setParams({ tab: 'wf', open: res.id })
      setEqId('')
      setEqOther('')
      setPriority('normal')
      setOccurredKnown(false)
      setKind(null)
      setDescription('')
      setDescOriginal(null)
      setInjured({ staff: false, customer: false })
      setInjuredStaff(null)
      setCaller(null)
      setCustomerName('')
      setCustomerPhone('')
      setContact(null)
      setContactLogs([])
      setAi(null)
      setActionSource(null)
      setAction('')
      setMedia([])
      setAt(new Date().toISOString())
      setAtNow(false)
      void queryClient.invalidateQueries({ queryKey: ['incidents'] })
    },
  })

  if (stores.isLoading) return <Spinner />
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title={t('incident.title')} subtitle={t('incident.subtitle')} />
      <div className="grid grid-cols-2 gap-2">
        {(['new', 'wf'] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={tab === k}
            onClick={() => setParams(k === 'wf' ? { tab: 'wf' } : {})}
            className={cx('min-h-12 rounded-xl border-[1.5px] font-bold', tab === k ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink')}
          >
            {k === 'new' ? `📝 ${t('wf.tabNew')}` : `🔧 ${t('wf.tabList')}`}
          </button>
        ))}
      </div>
      {tab === 'wf' ? (
        <WfList key={params.get('open') ?? 'list'} initialOpen={params.get('open')} />
      ) : (
      <>
      <Card className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[15px] font-bold">{t('incident.kind')}</legend>
          <div className="grid grid-cols-2 gap-2">
            {INCIDENT_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={cx(
                  'flex min-h-12 items-center gap-1.5 rounded-xl border-[1.5px] px-2.5 text-left font-bold',
                  currentLocale() === 'ja' && 'whitespace-nowrap text-[15px] tracking-tight',
                  kind === k ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink',
                )}
              >
                <span aria-hidden>{INCIDENT_ICON[k]}</span>
                {t(`incident.kinds.${k}`)}
              </button>
            ))}
          </div>
          {kind && URGENT_INCIDENTS.includes(kind) && <p className="rounded-lg bg-red-50 p-2 text-sm font-bold text-red-900">📞 {t('incident.urgentHint')}</p>}
          {kind === 'lost_item' && (
            <Link to="/lost-items" className="flex min-h-12 items-center justify-center rounded-xl border-[1.5px] border-brand bg-brand-soft px-3 font-bold text-brand">
              👜 {t('incident.lostMoved')}
            </Link>
          )}
        </fieldset>
        <Segmented
          label={t('incident.store')}
          value={storeId}
          onChange={setStore}
          options={(stores.data ?? []).map((s) => ({ value: s.id, label: storeName(s, currentLocale()) }))}
        />
        <OccurredAt
          label={isEq ? t('wf.f.discovered') : undefined}
          value={at}
          now={atNow}
          onChange={(iso, now) => {
            setAt(iso)
            setAtNow(now)
          }}
        />
        {isEq && (
          <div className="flex flex-col gap-3 rounded-xl border border-slate-300 bg-slate-50 p-3">
            <label className="flex flex-col gap-1.5 text-[15px] font-bold">
              {t('wf.f.equipment')} *
              <select className="min-h-12 rounded-xl border border-slate-400 bg-white px-2 font-normal" value={eqId} onChange={(e) => setEqId(e.target.value)}>
                <option value="">{t('wf.eqOther')}</option>
                {eqList.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.code ? `（${e.code}）` : ''}
                  </option>
                ))}
              </select>
            </label>
            {!eqId && <TextInput label={t('wf.eqName')} value={eqOther} maxLength={60} onChange={(e) => setEqOther(e.target.value)} />}
            <Checkbox checked={occurredKnown} onChange={setOccurredKnown}>
              {t('wf.occurredKnown')}
            </Checkbox>
            {occurredKnown ? (
              <OccurredAt label={t('wf.f.occurred')} value={occurredAt} now={false} onChange={(iso) => setOccurredAt(iso)} />
            ) : (
              <p className="text-xs text-muted">{t('wf.occurredUnknown')}</p>
            )}
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-[15px] font-bold">{t('wf.f.priority')}</legend>
              <div className="grid grid-cols-3 gap-2">
                {PRIORITIES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={priority === p}
                    onClick={() => setPriority(p)}
                    className={cx('min-h-12 rounded-xl border-[1.5px] font-bold', priority === p ? `border-transparent ${PRIORITY_STYLE[p]} ring-2 ring-brand` : 'border-line bg-white text-ink')}
                  >
                    {t(`wf.priority.${p}`)}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted">{t('wf.priorityHint')}</p>
            </fieldset>
            {priority === 'urgent' && <p className="rounded-lg bg-red-50 p-2 text-sm font-bold whitespace-pre-line text-red-900">⚠️ {t('wf.safety')}</p>}
          </div>
        )}
        {kind === 'injury' && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[15px] font-bold">{t('incident.injured.title')}</span>
            <div className="grid grid-cols-2 gap-2">
              {(['staff', 'customer'] as const).map((w) => (
                <Checkbox key={w} checked={injured[w]} onChange={(v) => setInjured((x) => ({ ...x, [w]: v }))}>
                  {w === 'staff' ? '🧑‍🍳' : '👤'} {t(`incident.injured.${w}`)}
                </Checkbox>
              ))}
            </div>
            {injured.staff && <InjuredStaffPicker storeId={storeId} value={injuredStaff} onChange={setInjuredStaff} />}
          </div>
        )}
        {kind === 'phone_message' && (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-[15px] font-bold">{t('incident.caller.title')}</legend>
            <div className="grid grid-cols-3 gap-2">
              {CALLER_TYPES.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={caller === c}
                  onClick={() => setCaller(caller === c ? null : c)}
                  className={cx('min-h-12 rounded-xl border-[1.5px] px-2 font-bold', caller === c ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink')}
                >
                  {t(`incident.caller.${c}`)}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {party && kind === 'phone_message' && (
          <PartyFields party={party} name={customerName} phone={customerPhone} onName={setCustomerName} onPhone={setCustomerPhone} />
        )}
        <div className="flex flex-col gap-2">
          <TextArea
            label={`${kind === 'phone_message' ? t('incident.content') : t('incident.description')} *`}
            hint={t('incident.descriptionHint')}
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Button variant="secondary" onClick={() => translate.mutate()} disabled={!description.trim() || translate.isPending}>
            {translate.isPending ? t('action.loading') : `🌐 ${t('incident.translate')}`}
          </Button>
          {descOriginal && (
            <p className="text-xs text-muted">
              ✓ {t('incident.translated')} — {t('comment.original')}: {descOriginal.text}
            </p>
          )}
          {translate.error && !(translate.error instanceof TranslationCancelled) && <ErrorBox message={errorMessage(translate.error)} />}
          {party && kind !== 'phone_message' && (
            <PartyFields party={party} name={customerName} phone={customerPhone} onName={setCustomerName} onPhone={setCustomerPhone} />
          )}
        </div>
        <ContactManager
          method={contact}
          onMethod={setContact}
          logs={contactLogs}
          onLogs={setContactLogs}
          lineText={lineMessage({
            kind: kind ? t(`incident.kinds.${kind}`, { lng: 'ja' }) : '',
            store: storeLabel,
            when: formatWhen(at, 'ja'),
            description,
            customer: [customerName.trim(), customerPhone.trim()].filter(Boolean).join(' '),
          })}
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-[15px] font-bold">
            {t('incident.action')}
            {actionSource === 'own' ? ' *' : ''}
          </legend>
          {!isEq && (
          <AiProposal
            kind={kind}
            description={description}
            value={ai}
            source={actionSource}
            onValue={(sug) => {
              setAi(sug)
              setActionSource(null)
            }}
            onChoose={(src) => {
              setActionSource(src)
              setAction(src === 'ai' ? (ai?.ja ?? '') : '')
            }}
          />
          )}
          <TextArea
            label={actionSource === 'ai' ? t('incident.actionFromAi') : t('incident.actionOwn')}
            hint={t('incident.actionHint')}
            rows={actionSource === 'ai' ? 5 : 3}
            value={action}
            onChange={(e) => setAction(e.target.value)}
            error={needAction ? t('error.required') : null}
          />
        </fieldset>
        <AttachmentPicker value={media} onChange={setMedia} camera hint={t('incident.photoHint')} />
        {send.error && !(send.error instanceof TranslationCancelled) && <ErrorBox message={errorMessage(send.error)} />}
        <Button onClick={() => send.mutate()} disabled={!ready || send.isPending}>
          {send.isPending ? t('action.loading') : t('incident.send')}
        </Button>
      </Card>
      {gate.review}

      {(mine.data ?? []).length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionTitle>{t('incident.mine')}</SectionTitle>
          <ul className="flex flex-col gap-2">
            {mine.data!.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 rounded-xl border border-line bg-white p-3">
                <span className="flex items-center justify-between gap-2">
                  <b>
                    {INCIDENT_ICON[r.kind]} {t(`incident.kinds.${r.kind}`)}
                  </b>
                  <span className={cx('rounded-full px-2 py-0.5 text-sm font-bold', INCIDENT_STATUS_STYLE[r.status])}>{t(`incident.status.${r.status}`)}</span>
                </span>
                <span className="text-sm text-muted">
                  {formatShortDate(r.business_date)} {t(`shift.${r.shift}`)} ・ {storeName(stores.data?.find((s) => s.id === r.store_id), currentLocale())}
                </span>
                <span className="text-sm">{r.original_texts?.description ?? r.description}</span>
                {r.status === 'done' && r.prevention && <span className="rounded-lg bg-green-50 px-2 py-1 text-sm">✅ {t('incident.prevention')}: {r.prevention}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      </>
      )}
    </div>
  )
}
