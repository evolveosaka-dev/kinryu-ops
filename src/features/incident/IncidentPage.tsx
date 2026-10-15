import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMe } from '../../app/auth'
import { useToast } from '../../components/Toast'
import { Button, Card, ErrorBox, PageTitle, Segmented, SectionTitle, Spinner, TextArea, TextInput } from '../../components/ui'
import {
  INCIDENT_ICON,
  INCIDENT_KINDS,
  INCIDENT_STATUS_STYLE,
  lineMessage,
  URGENT_INCIDENTS,
  type AiSuggestion,
  type ContactLog,
  type ContactMethod,
  type Incident,
  type IncidentKind,
} from '../../domain/incident'
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
import { OccurredAt } from './OccurredAt'

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
  const storeIds = (stores.data ?? []).map((s) => s.id)
  const [store, setStore] = useState<string>('')
  const [kind, setKind] = useState<IncidentKind | null>(null)
  const [at, setAt] = useState(() => new Date().toISOString())
  const [atNow, setAtNow] = useState(false)
  const [description, setDescription] = useState('')
  // the writer's own words when 「AIで翻訳」 turned the description into Japanese
  const [descOriginal, setDescOriginal] = useState<{ text: string; lang: string } | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [contact, setContact] = useState<ContactMethod | null>(null)
  const [contactLogs, setContactLogs] = useState<ContactLog[]>([])
  const [ai, setAi] = useState<AiSuggestion | null>(null)
  const [actionSource, setActionSource] = useState<'ai' | 'own' | null>(null)
  const [action, setAction] = useState('')
  const [media, setMedia] = useState<PreparedMedia[]>([])
  const storeId = store || initialStore(storeIds)
  const needAction = actionSource === 'own' && !action.trim()
  const ready = Boolean(kind && storeId && description.trim() && contact && !needAction)
  const storeLabel = storeName(stores.data?.find((s) => s.id === storeId), 'ja')

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
      const occurred = at
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
          p_customer_name: customerName.trim() || null,
          p_customer_phone: customerPhone.trim() || null,
          p_contact_method: contact,
          p_contact_logs: contactLogs.map((l) => l.id),
          p_ai_suggestion: ai,
          p_action_source: ai ? actionSource : null,
        }),
      )
      if (media.length) await uploads.enqueue('incident', id, media)
      setLastStore(storeId)
    },
    onSuccess: () => {
      toast(t('incident.sent'))
      setKind(null)
      setDescription('')
      setDescOriginal(null)
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
      <Card className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[15px] font-bold">{t('incident.kind')}</legend>
          <div className="flex flex-wrap gap-2">
            {INCIDENT_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={cx(
                  'flex min-h-12 items-center gap-1.5 whitespace-nowrap rounded-xl border-[1.5px] px-3 font-bold',
                  kind === k ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink',
                )}
              >
                <span aria-hidden>{INCIDENT_ICON[k]}</span>
                {t(`incident.kinds.${k}`)}
              </button>
            ))}
          </div>
          {kind && URGENT_INCIDENTS.includes(kind) && <p className="rounded-lg bg-red-50 p-2 text-sm font-bold text-red-900">📞 {t('incident.urgentHint')}</p>}
        </fieldset>
        <Segmented
          label={t('incident.store')}
          value={storeId}
          onChange={setStore}
          options={(stores.data ?? []).map((s) => ({ value: s.id, label: storeName(s, currentLocale()) }))}
        />
        <OccurredAt
          value={at}
          now={atNow}
          onChange={(iso, now) => {
            setAt(iso)
            setAtNow(now)
          }}
        />
        <div className="flex flex-col gap-2">
          <TextArea
            label={`${t('incident.description')} *`}
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
          <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">👤 {t('incident.customerHint')}</p>
          <div className="grid grid-cols-2 gap-2 [&>div]:justify-between">
            <TextInput label={t('incident.customerName')} value={customerName} maxLength={100} autoComplete="off" onChange={(e) => setCustomerName(e.target.value)} />
            <TextInput
              label={t('incident.customerPhone')}
              type="tel"
              inputMode="tel"
              value={customerPhone}
              maxLength={40}
              autoComplete="off"
              onChange={(e) => setCustomerPhone(e.target.value)}
            />
          </div>
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
    </div>
  )
}
