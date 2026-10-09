import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { useMe } from '../../app/auth'
import { useToast } from '../../components/Toast'
import { StaffPicker } from '../../components/StaffPicker'
import { Button, Card, Checkbox, ErrorBox, Segmented, Spinner, StickyActions, TextArea, TextInput } from '../../components/ui'
import { CAUTION_PICKS } from '../../domain/phrases'
import { currentSlot, dayType, formatTokyoTime, MEETING_TIME, monthOf } from '../../domain/time'
import { ALL_STEPS_DONE, CHOREI_STEPS, SHIFTS, type Shift, type StepsDone } from '../../domain/types'
import { currentLocale } from '../../i18n'
import { errorMessage, isNetworkError, storeName } from '../../lib/format'
import { unwrap, useHolidays, useStores, useTargets } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import type { ChoreiSlot } from '../../lib/types'
import { AttachmentPicker } from '../attachments/AttachmentPicker'
import { useUploadQueue } from '../attachments/uploadQueue'
import type { PreparedMedia } from '../../lib/media'
import { TranslationCancelled, useTranslationGate } from '../translate/useTranslationGate'
import { HandoverCard } from './HandoverCard'
import { choreiSchema, fieldErrors } from './schema'

export function ChoreiFormPage() {
  const { t } = useTranslation('chorei')
  const me = useMe()
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const locale = currentLocale()

  const stores = useStores()
  const holidays = useHolidays()
  const targets = useTargets()

  const initial = useMemo(() => currentSlot(new Date()), [])
  const [storeId, setStoreId] = useState(me.home_store_id ?? '')
  const [businessDate, setBusinessDate] = useState(initial.businessDate)
  const [shift, setShift] = useState<Shift>(initial.shift)
  const [participantNames, setParticipantNames] = useState<string[]>([])
  const [stockNone, setStockNone] = useState(false)
  const [stockText, setStockText] = useState('')
  const [targetOverride, setTargetOverride] = useState<string | null>(null)
  const [caution, setCaution] = useState('')
  const [steps, setSteps] = useState<StepsDone>(ALL_STEPS_DONE)
  const [skipReason, setSkipReason] = useState('')
  const [note, setNote] = useState('')
  const [media, setMedia] = useState<PreparedMedia[]>([])
  const uploads = useUploadQueue()
  const translation = useTranslationGate()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)

  const effectiveStore = storeId || stores.data?.[0]?.id || ''

  const slot = useQuery({
    queryKey: ['chorei_slot', effectiveStore, businessDate, shift],
    enabled: Boolean(effectiveStore && businessDate),
    queryFn: async () =>
      unwrap<ChoreiSlot>(await supabase.rpc('chorei_slot', { p_store: effectiveStore, p_date: businessDate, p_shift: shift })),
  })

  const dt = holidays.data ? dayType(businessDate, holidays.data) : 'weekday'
  const suggestedTarget = targets.data?.find(
    (x) => x.store_id === effectiveStore && x.month === monthOf(businessDate) && x.shift === shift && x.day_type === dt,
  )?.bowls
  const targetValue = targetOverride ?? (suggestedTarget !== undefined ? String(suggestedTarget) : '')


  const submit = useMutation({
    mutationFn: async () => {
      const parsed = choreiSchema.safeParse({
        store_id: effectiveStore,
        business_date: businessDate,
        shift,
        participants: [],
        participants_extra: participantNames.filter(Boolean),
        stock_none: stockNone,
        stock_text: stockNone ? null : stockText.trim() || null,
        target_bowls: targetValue === '' ? null : Number(targetValue),
        caution_text: caution.trim() || null,
        steps_done: steps,
        skip_reason: Object.values(steps).every(Boolean) ? null : skipReason.trim() || null,
      })
      if (!parsed.success) {
        setErrors(fieldErrors(parsed.error))
        throw new Error('validation')
      }
      setErrors({})
      // other languages → Japanese, confirmed by the writer before saving
      const tr = await translation.prepare([
        { key: 'stock_text', label: t('stock.label'), text: parsed.data.stock_text },
        { key: 'caution_text', label: t('caution.label'), text: parsed.data.caution_text },
        { key: 'skip_reason', label: t('steps.skipReason'), text: parsed.data.skip_reason },
      ])
      const record = {
        ...parsed.data,
        stock_text: tr.values.stock_text ?? null,
        caution_text: tr.values.caution_text ?? null,
        skip_reason: tr.values.skip_reason ?? null,
        original_texts: tr.originals,
        source_lang: tr.sourceLang,
        leader_id: me.id,
      }
      const res = await supabase.from('chorei_records').insert(record).select('id').single()
      if (res.error) throw Object.assign(new Error(res.error.message), { code: res.error.code })
      // photos/videos go to Google Drive in the background (queued, retried)
      await uploads.enqueue('chorei', (res.data as { id: string }).id, media)
    },
    onSuccess: () => {
      toast(t('common:toast.sent'))
      void queryClient.invalidateQueries({ queryKey: ['my_chorei'] })
      void navigate('/history')
    },
    onError: (err: Error & { code?: string }) => {
      if (err.message === 'validation' || err instanceof TranslationCancelled) return setSubmitError(null)
      if (err.code === '23505') {
        void slot.refetch()
        return setSubmitError(t('duplicate'))
      }
      setSubmitError(isNetworkError(err) ? t('common:error.network') : `${t('common:error.generic')} (${errorMessage(err)})`)
    },
  })

  const addNote = useMutation({
    mutationFn: async (choreiId: string) => {
      const tr = await translation.prepare([{ key: 'body', label: t('existing.addNote'), text: note.trim() }])
      return unwrap(
        await supabase.rpc('add_chorei_note', { p_chorei: choreiId, p_body: tr.values.body, p_original: tr.originals?.body ?? null }),
      )
    },
    onSuccess: () => {
      setNote('')
      toast(t('existing.noteAdded'))
    },
    onError: (err) => !(err instanceof TranslationCancelled) && setSubmitError(errorMessage(err)),
  })

  if (stores.isLoading) return <Spinner />
  const existing = slot.data?.existing ?? null
  const errorText = (k: string) => (errors[k] ? t(`common:${errors[k]}`) : null)

  return (
    <div className="flex flex-col gap-4">
      {translation.review}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">📣 {t('title')}</h1>
        <Link to="/genko" className="flex min-h-11 items-center rounded-xl px-3 text-sm font-bold text-brand ring-1 ring-brand">
          📜 {t('genko:title')}
        </Link>
      </div>

      <Card className="flex flex-col gap-3">
        <Segmented
          label={t('common:field.store')}
          value={effectiveStore}
          onChange={setStoreId}
          options={(stores.data ?? []).map((s) => ({ value: s.id, label: storeName(s, locale) }))}
        />
        <Segmented
          label={t('common:field.shift')}
          value={shift}
          onChange={(v) => {
            setShift(v)
            setTargetOverride(null)
          }}
          options={SHIFTS.map((s) => ({
            value: s,
            label: (
              <span className="flex flex-col">
                {t(`common:shift.${s}`)}
                <span className="text-xs font-normal">{MEETING_TIME[s]}</span>
              </span>
            ),
          }))}
        />
        <TextInput
          label={t('common:field.date')}
          type="date"
          value={businessDate}
          onChange={(e) => {
            setBusinessDate(e.target.value)
            setTargetOverride(null)
          }}
        />
        <p className="text-sm text-slate-600">
          {t('leader')}：<b>{me.display_name}</b>
        </p>
      </Card>

      {slot.isLoading ? <Spinner /> : <HandoverCard handover={slot.data?.previous ?? null} />}

      {existing ? (
        <Card className="flex flex-col gap-3 ring-2 ring-green-500">
          <h2 className="font-bold text-green-800">✓ {t('existing.title')}</h2>
          <p className="text-sm">{t('existing.by', { name: existing.leader, time: formatTokyoTime(new Date(existing.submitted_at)) })}</p>
          <TextArea label={t('existing.addNote')} placeholder={t('existing.notePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} />
          {submitError && <ErrorBox message={submitError} />}
          <Button onClick={() => addNote.mutate(existing.id)} disabled={!note.trim() || addNote.isPending}>
            {t('existing.addNote')}
          </Button>
        </Card>
      ) : (
        <>
          <Card className="flex flex-col gap-2">
            <StaffPicker
              label={t('participants.label')}
              hint={t('participants.hint')}
              value={participantNames}
              onChange={setParticipantNames}
              storeId={effectiveStore}
              exclude={[me.display_name]}
            />
          </Card>

          <Card className="flex flex-col gap-3">
            <Checkbox checked={stockNone} onChange={setStockNone}>
              {t('stock.label')}：<b>{t('stock.none')}</b>
            </Checkbox>
            {!stockNone && (
              <TextArea
                label={t('stock.label')}
                placeholder={t('stock.placeholder')}
                value={stockText}
                onChange={(e) => setStockText(e.target.value)}
                error={errorText('stock_text')}
              />
            )}
            <TextInput
              label={`${t('target.label')}（${t('target.unit')}）`}
              type="number"
              inputMode="numeric"
              min={0}
              value={targetValue}
              onChange={(e) => setTargetOverride(e.target.value)}
              hint={suggestedTarget !== undefined ? t('target.hint', { dayType: t(`target.${dt}`), bowls: suggestedTarget }) : undefined}
            />
            <TextArea label={t('caution.label')} placeholder={t('caution.placeholder')} value={caution} onChange={(e) => setCaution(e.target.value)} />
            <details>
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold text-brand">{t('caution.picks')}</summary>
              <ul className="flex flex-col gap-2">
                {CAUTION_PICKS.map((p) => (
                  <li key={p.key}>
                    <button
                      type="button"
                      onClick={() => setCaution(p.ja)}
                      className="w-full rounded-xl border border-slate-300 bg-white p-2 text-left text-sm"
                    >
                      <span lang="ja" className="block font-bold">
                        {p.ja}
                      </span>
                      {locale !== 'ja' && <span className="block text-xs text-slate-600">{t(p.key)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          </Card>

          <AttachmentPicker value={media} onChange={setMedia} />

          <Card className="flex flex-col gap-1">
            <h2 className="text-sm font-bold text-slate-700">{t('steps.label')}</h2>
            {CHOREI_STEPS.map((s) => (
              <Checkbox key={s} checked={steps[s]} onChange={(v) => setSteps((prev) => ({ ...prev, [s]: v }))}>
                {t(`steps.${s}`)}
              </Checkbox>
            ))}
            {!Object.values(steps).every(Boolean) && (
              <TextInput
                label={t('steps.skipReason')}
                placeholder={t('steps.skipReasonPlaceholder')}
                value={skipReason}
                onChange={(e) => setSkipReason(e.target.value)}
                error={errorText('skip_reason')}
              />
            )}
          </Card>

          <StickyActions>
            {submitError && <ErrorBox message={submitError} />}
            {Object.keys(errors).length > 0 && <ErrorBox message={t('common:error.required')} />}
            <Button className="mt-2 w-full" onClick={() => submit.mutate()} disabled={submit.isPending || !effectiveStore}>
              {submit.isPending ? t('common:action.loading') : t('common:action.submit')}
            </Button>
          </StickyActions>
        </>
      )}
    </div>
  )
}
