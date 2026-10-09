import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useMe } from '../../app/auth'
import { useToast } from '../../components/Toast'
import { StaffPicker } from '../../components/StaffPicker'
import { Button, Card, Checkbox, ErrorBox, Segmented, Spinner, StickyActions, TextArea, TextInput } from '../../components/ui'
import {
  durationMinutes,
  judgePatrol,
  PATROL_ITEMS,
  PATROL_WARN_MINUTES,
  suggestPatrol,
  type PatrolScores,
} from '../../domain/patrol'
import { formatTokyoTime } from '../../domain/time'
import { PATROL_TYPES, SHIFTS, type PatrolType } from '../../domain/types'
import { currentLocale } from '../../i18n'
import { errorMessage, isNetworkError, storeName } from '../../lib/format'
import { useStores } from '../../lib/queries'
import type { Store } from '../../lib/types'
import { supabase } from '../../lib/supabase'
import { loadLocalDraft, saveLocalDraft, type PatrolFormState } from './draft'
import { AttachmentPicker } from '../attachments/AttachmentPicker'
import { useUploadQueue } from '../attachments/uploadQueue'
import type { PreparedMedia } from '../../lib/media'
import { TranslationCancelled, useTranslationGate } from '../translate/useTranslationGate'
import { initialStore } from '../../lib/lastStore'
import { ScoreItem } from './ScoreItem'

const JUDGEMENT_STYLE = {
  good: 'bg-green-100 text-green-900',
  improve: 'bg-amber-100 text-amber-900',
  coaching: 'bg-red-100 text-red-900',
} as const

function completeScores(s: PatrolFormState['scores']): PatrolScores | null {
  const { smile, voice, grooming, clean, quality } = s
  if (!smile || !voice || !grooming || !clean || quality === undefined) return null
  return { smile, voice, grooming, clean, quality }
}

function newForm(stores: Store[]): PatrolFormState {
  // "own store" = the store used last time (staff work at both stores)
  const home = initialStore(stores.map((s) => s.id))
  const other = stores.find((s) => s.id !== home)?.id ?? home
  const s = suggestPatrol(new Date(), home, other)
  return {
    draftId: null,
    patrolType: s.patrolType,
    storeId: s.storeId,
    businessDate: s.businessDate,
    shift: s.shift,
    startedAt: null,
    endedAt: null,
    scores: {},
    staffOnShift: '全員',
    staffNames: [],
    goodPoints: '',
    improvements: '',
    remarks: '',
  }
}

export function PatrolFormPage() {
  const stores = useStores()
  if (stores.isLoading) return <Spinner />
  if (!stores.data?.length) return <ErrorBox message={errorMessage(stores.error ?? 'no stores')} />
  return <PatrolForm stores={stores.data} />
}

function PatrolForm({ stores }: { stores: Store[] }) {
  const { t } = useTranslation('patrol')
  const me = useMe()
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const locale = currentLocale()

  const [form, setForm] = useState<PatrolFormState>(() => loadLocalDraft(me.id) ?? newForm(stores))
  const [resumed] = useState(() => Boolean(form.startedAt))
  const [now, setNow] = useState(() => new Date())
  const [error, setError] = useState<string | null>(null)
  const [showMissing, setShowMissing] = useState(false)
  const [media, setMedia] = useState<PreparedMedia[]>([])
  const [endMissing, setEndMissing] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const timeCard = useRef<HTMLDivElement>(null)
  const vibrated = useRef(false)
  const uploads = useUploadQueue()
  const translation = useTranslationGate()

  useEffect(() => saveLocalDraft(me.id, form.startedAt ? form : null), [form, me.id])

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 5_000)
    return () => window.clearInterval(id)
  }, [])

  const update = (patch: Partial<PatrolFormState>) => setForm((f) => ({ ...f, ...patch }))

  const start = useMutation({
    mutationFn: async () => {
      const startedAt = new Date().toISOString()
      update({ startedAt })
      // Server-side draft so a patrol without "end" is flagged for review (needs_time_review).
      const res = await supabase
        .from('patrol_checks')
        .insert({
          patroller_id: me.id,
          store_id: form.storeId,
          business_date: form.businessDate,
          shift: form.shift,
          patrol_type: form.patrolType,
          started_at: startedAt,
          status: 'draft',
        })
        .select('id')
        .single()
      if (res.error) throw new Error(res.error.message)
      update({ draftId: (res.data as { id: string }).id })
    },
    // Offline: keep the local start time; the record is inserted on submit.
    onError: (err) => !isNetworkError(err) && setError(errorMessage(err)),
  })

  // 終了: recorded once, also on the server draft so the cron job does not flag it
  const finish = async () => {
    const endedAt = new Date().toISOString()
    update({ endedAt })
    setEndMissing(false)
    if (form.draftId) await supabase.from('patrol_checks').update({ ended_at: endedAt }).eq('id', form.draftId)
  }

  const submit = useMutation({
    mutationFn: async (endedAt: string) => {
      const f = form
      const scores = completeScores(f.scores)
      // other languages → Japanese, confirmed (and editable) before saving
      const tr = await translation.prepare([
        { key: 'good_points', label: t('goodPoints.label'), text: f.goodPoints.trim() },
        { key: 'improvements', label: t('improvements.label'), text: f.improvements.trim() },
        { key: 'remarks', label: t('remarks.label'), text: f.remarks.trim() || null },
      ])
      const payload = {
        store_id: f.storeId,
        business_date: f.businessDate,
        shift: f.shift,
        patrol_type: f.patrolType,
        started_at: f.startedAt,
        ended_at: endedAt,
        score_smile: scores!.smile,
        score_voice: scores!.voice,
        score_grooming: scores!.grooming,
        score_clean: scores!.clean,
        score_quality: scores!.quality,
        mask_worn: Boolean(f.maskWorn),
        staff_names: (f.staffNames ?? []).filter(Boolean),
        staff_on_shift: (f.staffNames ?? []).filter(Boolean).join('、') || '全員',
        good_points: tr.values.good_points,
        improvements: tr.values.improvements,
        remarks: tr.values.remarks || null,
        original_texts: tr.originals,
        source_lang: tr.sourceLang,
        status: 'valid',
      }
      const res = f.draftId
        ? await supabase.from('patrol_checks').update(payload).eq('id', f.draftId).select('id').single()
        : await supabase.from('patrol_checks').insert({ ...payload, patroller_id: me.id }).select('id').single()
      if (res.error) throw new Error(res.error.message)
      await uploads.enqueue('patrol', (res.data as { id: string }).id, media)
    },
    onSuccess: () => {
      saveLocalDraft(me.id, null)
      toast(t('common:toast.sent'))
      void queryClient.invalidateQueries({ queryKey: ['my_patrols'] })
      void navigate('/history?tab=patrol')
    },
    onError: (err) => {
      if (err instanceof TranslationCancelled) return setError(null)
      setError(isNetworkError(err) ? t('common:error.network') : `${t('common:error.generic')} (${errorMessage(err)})`)
    },
  })

  // キャンセル: drop the server draft, the saved form and the photos, then go home
  const cancel = async () => {
    if (form.draftId) await supabase.from('patrol_checks').delete().eq('id', form.draftId)
    saveLocalDraft(me.id, null)
    setMedia([])
    setConfirmCancel(false)
    void navigate('/')
  }
  const hasInput = Boolean(
    form.startedAt || media.length || form.goodPoints.trim() || form.improvements.trim() || form.remarks.trim() || Object.keys(form.scores).length,
  )

  const scores = completeScores(form.scores)
  const result = scores ? judgePatrol(scores) : null
  const started = form.startedAt ? new Date(form.startedAt) : null
  const ended = form.endedAt ? new Date(form.endedAt) : null
  const minutes = started ? durationMinutes(started, ended ?? now) : 0
  const overLimit = Boolean(started && !ended && minutes >= PATROL_WARN_MINUTES)
  const photos = media.filter((m) => m.kind === 'image').length
  const ready = Boolean(started && ended && photos > 0 && scores && form.goodPoints.trim() && form.improvements.trim())

  // vibrate once when 15 minutes pass without 終了
  useEffect(() => {
    if (overLimit && !vibrated.current) {
      vibrated.current = true
      navigator.vibrate?.([300, 150, 300])
    }
  }, [overLimit])

  return (
    <div className="flex flex-col gap-4">
      {translation.review}
      {overLimit && (
        <button
          type="button"
          onClick={() => timeCard.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          className="sticky top-14 z-30 animate-pulse rounded-xl bg-red-700 p-3 text-left font-bold text-white shadow-lg"
        >
          ⚠️ {t('time.overBanner', { min: minutes })}
        </button>
      )}
      <h1 className="text-xl font-bold">🔍 {t('title')}</h1>
      {resumed && form.startedAt && <p className="rounded-xl bg-blue-50 p-3 text-sm">{t('time.resumed')}</p>}

      <Card className="flex flex-col gap-3">
        <Segmented<PatrolType>
          label={t('type.label')}
          value={form.patrolType}
          onChange={(patrolType) => update({ patrolType })}
          columns={2}
          options={PATROL_TYPES.map((value) => ({ value, label: t(`type.${value}`) }))}
        />
        <Segmented
          label={t('target')}
          value={form.storeId}
          onChange={(storeId) => update({ storeId })}
          options={stores.map((s) => ({ value: s.id, label: storeName(s, locale) }))}
        />
        <Segmented
          label={t('common:field.shift')}
          value={form.shift}
          onChange={(shift) => update({ shift })}
          options={SHIFTS.map((s) => ({ value: s, label: t(`common:shift.${s}`) }))}
        />
        <TextInput label={t('common:field.date')} type="date" value={form.businessDate} onChange={(e) => update({ businessDate: e.target.value })} />
      </Card>

      <div ref={timeCard}>
        <Card className={`flex flex-col gap-3 ${overLimit || (endMissing && !ended) ? 'ring-2 ring-red-600' : ''}`}>
          <h2 className="text-sm font-bold text-slate-700">⏱️ {t('time.label')}</h2>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => start.mutate()} disabled={Boolean(started) || start.isPending}>
              {started ? t('time.started', { time: formatTokyoTime(started) }) : `▶ ${t('time.start')}`}
            </Button>
            <Button onClick={() => void finish()} disabled={!started || Boolean(ended)} variant={overLimit ? 'danger' : 'primary'}>
              {ended ? t('time.ended', { time: formatTokyoTime(ended) }) : `■ ${t('time.end')}`}
            </Button>
          </div>
          {started && (
            <p className={minutes > PATROL_WARN_MINUTES ? 'font-bold text-red-700' : 'text-slate-700'}>
              {t('time.elapsed', { min: minutes })} / {t('time.limit')}
              {ended && minutes > PATROL_WARN_MINUTES && ` — ${t('time.overReview')}`}
            </p>
          )}
          {!started && <p className="text-sm text-slate-600">{t('time.needStart')}</p>}
          {started && !ended && <p className="text-sm text-slate-600">{t('time.needEnd')}</p>}
          {endMissing && !ended && <ErrorBox message={t('time.endFirst')} />}
        </Card>
      </div>

      <p className="text-sm text-slate-600">💡 {t('lowerHint')}</p>
      {PATROL_ITEMS.map((item) => (
        <ScoreItem
          key={item}
          item={item}
          value={form.scores[item]}
          onChange={(v) => update({ scores: { ...form.scores, [item]: v } })}
          locked={item === 'smile' && Boolean(form.maskWorn)}
          extra={
            item === 'smile' && (
              <div className="rounded-xl bg-amber-50 px-2">
                <Checkbox
                  checked={Boolean(form.maskWorn)}
                  onChange={(maskWorn) => update({ maskWorn, scores: { ...form.scores, smile: maskWorn ? 1 : undefined } })}
                >
                  😷 <b>{t('items.smile.mask')}</b>
                </Checkbox>
                {form.maskWorn && <p className="pb-2 text-xs text-amber-900">{t('items.smile.maskNote')}</p>}
              </div>
            )
          }
        />
      ))}

      <Card className="flex flex-col gap-3">
        <StaffPicker
          label={t('staffOnShift')}
          hint={t('staffOnShiftHint')}
          value={form.staffNames ?? []}
          onChange={(staffNames) => update({ staffNames })}
          storeId={form.storeId}
        />
        <TextArea
          label={`${t('goodPoints.label')} *`}
          placeholder={t('goodPoints.placeholder')}
          value={form.goodPoints}
          onChange={(e) => update({ goodPoints: e.target.value })}
          error={showMissing && !form.goodPoints.trim() ? t('common:error.required') : null}
        />
        <TextArea
          label={`${t('improvements.label')} *`}
          placeholder={t('improvements.placeholder')}
          value={form.improvements}
          onChange={(e) => update({ improvements: e.target.value })}
          error={showMissing && !form.improvements.trim() ? t('common:error.required') : null}
        />
        <TextArea label={t('remarks.label')} placeholder={t('remarks.placeholder')} value={form.remarks} onChange={(e) => update({ remarks: e.target.value })} />
      </Card>

      <AttachmentPicker
        value={media}
        onChange={setMedia}
        requirePhoto
        camera
        hint={t('photoHint')}
        lockedNote={started ? null : t('photoAfterStart')}
        missing={showMissing}
      />

      {confirmCancel && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="cancel-title" className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="flex w-full max-w-sm flex-col gap-3 rounded-2xl bg-white p-4">
            <h2 id="cancel-title" className="font-bold">
              {t('cancel.title')}
            </h2>
            <p className="text-sm text-slate-700">{t('cancel.body')}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setConfirmCancel(false)}>
                {t('cancel.no')}
              </Button>
              <Button variant="danger" onClick={() => void cancel()}>
                {t('cancel.yes')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <StickyActions>
        {result ? (
          <div className={`mb-2 flex items-center justify-between rounded-xl px-3 py-2 font-bold ${JUDGEMENT_STYLE[result.judgement]}`}>
            <span>{t('total', { total: result.total, max: result.max })}</span>
            <span>{t(`common:judgement.${result.judgement}`)}</span>
          </div>
        ) : (
          showMissing && <ErrorBox message={t('needScores')} />
        )}
        {result?.max === 20 && <p className="mb-1 text-xs text-slate-600">{t('fourItems')}</p>}
        {showMissing && !started && <ErrorBox message={t('time.needStart')} />}
        {endMissing && !ended && <ErrorBox message={t('time.endFirst')} />}
        {showMissing && started && photos === 0 && <ErrorBox message={t('common:attach.photoRequired')} />}
        {error && <ErrorBox message={error} />}
        <div className="grid grid-cols-[1fr_2fr] gap-2">
          <Button variant="secondary" disabled={submit.isPending} onClick={() => (hasInput ? setConfirmCancel(true) : void navigate('/'))}>
            {t('cancel.button')}
          </Button>
          <Button
            className="w-full"
            disabled={submit.isPending}
            onClick={() => {
              setShowMissing(true)
              if (started && !form.endedAt) {
                // 送信 without 終了 → guide the patroller to 終了 first
                setEndMissing(true)
                timeCard.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                return
              }
              if (!ready || !form.endedAt) return
              submit.mutate(form.endedAt)
            }}
          >
            {submit.isPending ? t('common:action.loading') : t('common:action.submit')}
          </Button>
        </div>
        <p className="mt-1 text-center text-xs text-slate-500">{t('editable')}</p>
      </StickyActions>
    </div>
  )
}
