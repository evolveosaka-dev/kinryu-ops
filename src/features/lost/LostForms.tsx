import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Card, Checkbox, ErrorBox, Segmented, TextArea, TextInput } from '../../components/ui'
import { LOST_OWNER_ICON, LOST_OWNERS, type LostItem, type LostOwner } from '../../domain/lostItem'
import { currentLocale } from '../../i18n'
import { cx } from '../../lib/cx'
import { errorMessage, storeName } from '../../lib/format'
import { initialStore, setLastStore } from '../../lib/lastStore'
import type { PreparedMedia } from '../../lib/media'
import { unwrap, useStores } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { AttachmentPicker } from '../attachments/AttachmentPicker'
import { useUploadQueue } from '../attachments/uploadQueue'
import { InjuredStaffPicker } from '../incident/InjuredStaffPicker'
import { OccurredAt } from '../incident/OccurredAt'
import { TranslationCancelled, useTranslationGate } from '../translate/useTranslationGate'

function Choice<T extends string>({ value, options, onChange, label }: { value: T | null; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-[15px] font-bold">{label}</legend>
      <div className="grid grid-cols-3 gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cx('min-h-12 rounded-xl border-[1.5px] px-1.5 text-sm font-bold', value === o.value ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink')}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

/** ＋ 忘れ物を記録: what, where found, where kept, whose (お客様 / スタッフ / 不明), photos. */
export function LostReportForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const stores = useStores()
  const uploads = useUploadQueue()
  const gate = useTranslationGate()
  const queryClient = useQueryClient()
  const storeIds = (stores.data ?? []).map((s) => s.id)
  const [store, setStore] = useState('')
  const [at, setAt] = useState(() => new Date().toISOString())
  const [atNow, setAtNow] = useState(false)
  const [description, setDescription] = useState('')
  const [place, setPlace] = useState('')
  const [storage, setStorage] = useState('')
  const [owner, setOwner] = useState<LostOwner | null>(null)
  const [ownerName, setOwnerName] = useState('')
  const [ownerStaff, setOwnerStaff] = useState<string | null>(null)
  const [ownerPhone, setOwnerPhone] = useState('')
  const [media, setMedia] = useState<PreparedMedia[]>([])
  const storeId = store || initialStore(storeIds)
  const send = useMutation({
    mutationFn: async () => {
      const g = await gate.prepare([
        { key: 'description', label: t('lost.description'), text: description.trim() },
        { key: 'found_place', label: t('lost.foundPlace'), text: place.trim() || null },
        { key: 'storage_place', label: t('lost.storage'), text: storage.trim() || null },
      ])
      const id = unwrap<string>(
        await supabase.rpc('report_lost_item', {
          p_store: storeId,
          p_found_at: at,
          p_description: g.values.description!,
          p_found_place: g.values.found_place,
          p_storage_place: g.values.storage_place,
          p_owner_type: owner!,
          p_owner_name: owner === 'staff' ? ownerStaff : owner === 'customer' ? ownerName.trim() || null : null,
          p_owner_phone: owner === 'customer' ? ownerPhone.trim() || null : null,
          p_original_texts: g.originals,
          p_source_lang: g.sourceLang,
        }),
      )
      if (media.length) await uploads.enqueue('lost_found', id, media)
      setLastStore(storeId)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['lost_items'] })
      onDone()
    },
  })
  const ready = Boolean(storeId && description.trim() && owner && (owner !== 'staff' || ownerStaff))
  return (
    <Card className="flex flex-col gap-4 ring-2 ring-blue-300">
      {gate.review}
      <h2 className="font-bold">👜 {t('lost.new')}</h2>
      <Segmented label={t('incident.store')} value={storeId} onChange={setStore} options={(stores.data ?? []).map((s) => ({ value: s.id, label: storeName(s, currentLocale()) }))} />
      <OccurredAt
        label={t('lost.foundAt')}
        value={at}
        now={atNow}
        onChange={(iso, now) => {
          setAt(iso)
          setAtNow(now)
        }}
      />
      <TextArea label={`${t('lost.description')} *`} hint={t('lost.descriptionHint')} rows={2} value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} />
      <div className="grid grid-cols-2 gap-2 [&>div]:justify-between">
        <TextInput label={t('lost.foundPlace')} placeholder={t('lost.foundPlaceEx')} value={place} maxLength={200} onChange={(e) => setPlace(e.target.value)} />
        <TextInput label={t('lost.storage')} placeholder={t('lost.storageEx')} value={storage} maxLength={200} onChange={(e) => setStorage(e.target.value)} />
      </div>
      <Choice label={`${t('lost.owner')} *`} value={owner} onChange={setOwner} options={LOST_OWNERS.map((o) => ({ value: o, label: `${LOST_OWNER_ICON[o]} ${t(`lost.owners.${o}`)}` }))} />
      {owner === 'customer' && (
        <div className="grid grid-cols-2 gap-2 [&>div]:justify-between">
          <TextInput label={t('incident.party.customer.name')} value={ownerName} maxLength={100} autoComplete="off" onChange={(e) => setOwnerName(e.target.value)} />
          <TextInput label={t('incident.party.customer.phone')} type="tel" inputMode="tel" value={ownerPhone} maxLength={40} autoComplete="off" onChange={(e) => setOwnerPhone(e.target.value)} />
        </div>
      )}
      {owner === 'staff' && <InjuredStaffPicker storeId={storeId} label={t('lost.ownerStaff')} value={ownerStaff} onChange={setOwnerStaff} />}
      <AttachmentPicker value={media} onChange={setMedia} camera hint={t('lost.photoHint')} />
      {send.error && !(send.error instanceof TranslationCancelled) && <ErrorBox message={errorMessage(send.error)} />}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onDone} disabled={send.isPending}>
          {t('lost.cancel')}
        </Button>
        <Button onClick={() => send.mutate()} disabled={!ready || send.isPending}>
          {send.isPending ? t('action.loading') : t('lost.save')}
        </Button>
      </div>
    </Card>
  )
}

/**
 * 返した / 警察に届けた. Returning to a customer needs a handover photo; the face only with the customer's
 * consent, and the photo is used for promotion only with a second consent.
 */
export function LostOutcomeForm({ item, outcome, onDone }: { item: LostItem; outcome: 'returned' | 'police'; onDone: () => void }) {
  const { t } = useTranslation()
  const uploads = useUploadQueue()
  const gate = useTranslationGate()
  const queryClient = useQueryClient()
  const [at, setAt] = useState(() => new Date().toISOString())
  const [atNow, setAtNow] = useState(true)
  const [toName, setToName] = useState(item.owner_type === 'unknown' ? '' : (item.owner_name ?? ''))
  const [toPhone, setToPhone] = useState(item.owner_phone ?? '')
  const [note, setNote] = useState('')
  const [face, setFace] = useState(false)
  const [marketing, setMarketing] = useState(false)
  const [station, setStation] = useState('')
  const [number, setNumber] = useState('')
  const [media, setMedia] = useState<PreparedMedia[]>([])
  const [tried, setTried] = useState(false)
  const customer = outcome === 'returned' && item.owner_type === 'customer'
  const needPhoto = customer && !media.some((m) => m.kind === 'image')
  const send = useMutation({
    mutationFn: async () => {
      const g = await gate.prepare([{ key: 'outcome_note', label: t('lost.note'), text: note.trim() || null }])
      unwrap(
        await supabase.rpc('record_lost_item_outcome', {
          p_id: item.id,
          p_outcome: outcome,
          p_at: at,
          p_to_name: outcome === 'returned' ? toName.trim() || null : null,
          p_to_phone: outcome === 'returned' ? toPhone.trim() || null : null,
          p_note: g.values.outcome_note,
          p_consent_face: customer && face,
          p_consent_marketing: customer && marketing,
          p_police_station: outcome === 'police' ? station.trim() || null : null,
          p_police_number: outcome === 'police' ? number.trim() || null : null,
          p_original_texts: g.originals,
        }),
      )
      if (media.length) await uploads.enqueue('lost_return', item.id, media)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['lost_items'] })
      onDone()
    },
  })
  return (
    <Card className="flex flex-col gap-3 ring-2 ring-blue-300">
      {gate.review}
      <h3 className="font-bold">{outcome === 'returned' ? `🤝 ${t('lost.doReturn')}` : `🚓 ${t('lost.doPolice')}`}</h3>
      <OccurredAt
        label={outcome === 'returned' ? t('lost.returnedAt') : t('lost.policeAt')}
        value={at}
        now={atNow}
        onChange={(iso, now) => {
          setAt(iso)
          setAtNow(now)
        }}
      />
      {outcome === 'returned' ? (
        <div className="grid grid-cols-2 gap-2 [&>div]:justify-between">
          <TextInput label={t('lost.toName')} value={toName} maxLength={100} autoComplete="off" onChange={(e) => setToName(e.target.value)} />
          <TextInput label={t('lost.toPhone')} type="tel" inputMode="tel" value={toPhone} maxLength={40} autoComplete="off" onChange={(e) => setToPhone(e.target.value)} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 [&>div]:justify-between">
          <TextInput label={t('lost.station')} placeholder={t('lost.stationEx')} value={station} maxLength={100} onChange={(e) => setStation(e.target.value)} />
          <TextInput label={t('lost.number')} value={number} maxLength={50} onChange={(e) => setNumber(e.target.value)} />
        </div>
      )}
      {customer && (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-bold text-amber-900">📸 {t('lost.returnPhotoRule')}</p>
          <p className="rounded-lg bg-white p-2 text-sm">
            <span className="block text-xs font-bold text-muted">{t('lost.askCustomer')}</span>「{t('lost.askCustomerJa', { lng: 'ja' })}」
          </p>
          <Checkbox checked={face} onChange={setFace}>
            🙂 {t('lost.consentFace')}
          </Checkbox>
          <Checkbox checked={marketing} onChange={setMarketing}>
            📣 {t('lost.consentMarketing')}
          </Checkbox>
          <p className="text-xs text-amber-900">{face ? t('lost.faceOk') : t('lost.faceNo')}</p>
        </div>
      )}
      <AttachmentPicker value={media} onChange={setMedia} camera requirePhoto={customer} missing={tried && needPhoto} rule={customer && face ? t('lost.faceRuleOk') : undefined} hint={customer ? t('lost.returnPhotoHint') : t('lost.photoHint')} />
      <TextArea label={t('lost.note')} rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
      <p className="text-xs text-muted">{t('lost.approvalHint')}</p>
      {send.error && !(send.error instanceof TranslationCancelled) && <ErrorBox message={errorMessage(send.error)} />}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onDone} disabled={send.isPending}>
          {t('lost.cancel')}
        </Button>
        <Button onClick={() => (needPhoto ? setTried(true) : send.mutate())} disabled={send.isPending}>
          {send.isPending ? t('action.loading') : t('lost.save')}
        </Button>
      </div>
    </Card>
  )
}
