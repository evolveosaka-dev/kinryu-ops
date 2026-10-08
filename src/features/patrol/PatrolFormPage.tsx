import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useMe } from '../../app/auth'
import { useToast } from '../../components/Toast'
import { StaffPicker } from '../../components/StaffPicker'
import { Button, Card, ErrorBox, Segmented, Spinner, StickyActions, TextArea, TextInput } from '../../components/ui'
import {
  durationMinutes,
  judgePatrol,
  PATROL_ITEMS,
  PATROL_WARN_MINUTES,
  suggestPatrol,
  type PatrolScores,
} from '../../domain/patrol'
import { formatTokyoTime } from '../../domain/time'
import { SHIFTS, type PatrolType } from '../../domain/types'
import { currentLocale } from '../../i18n'
import { errorMessage, isNetworkError, storeName } from '../../lib/format'
import { useStores } from '../../lib/queries'
import type { Store } from '../../lib/types'
import { supabase } from '../../lib/supabase'
import { loadLocalDraft, saveLocalDraft, type PatrolFormState } from './draft'
import { AttachmentPicker } from '../attachments/AttachmentPicker'
import { useUploadQueue } from '../attachments/uploadQueue'
import type { PreparedMedia } from '../../lib/media'
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

function newForm(stores: Store[], homeStoreId: string | null): PatrolFormState {
  const home = homeStoreId ?? stores[0]!.id
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

  const [form, setForm] = useState<PatrolFormState>(() => loadLocalDraft(me.id) ?? newForm(stores, me.home_store_id))
  const [resumed] = useState(() => Boolean(form.startedAt))
  const [now, setNow] = useState(() => new Date())
  const [error, setError] = useState<string | null>(null)
  const [showMissing, setShowMissing] = useState(false)
  const [media, setMedia] = useState<PreparedMedia[]>([])
  const uploads = useUploadQueue()

  useEffect(() => saveLocalDraft(me.id, form.startedAt ? form : null), [form, me.id])

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000)
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

  const submit = useMutation({
    mutationFn: async (endedAt: string) => {
      const f = form
      const scores = completeScores(f.scores)
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
        staff_names: (f.staffNames ?? []).filter(Boolean),
        staff_on_shift: (f.staffNames ?? []).filter(Boolean).join('、') || '全員',
        good_points: f.goodPoints.trim(),
        improvements: f.improvements.trim(),
        remarks: f.remarks.trim() || null,
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
    onError: (err) => setError(isNetworkError(err) ? t('common:error.network') : `${t('common:error.generic')} (${errorMessage(err)})`),
  })

  const discard = async () => {
    if (form.draftId) await supabase.from('patrol_checks').delete().eq('id', form.draftId)
    saveLocalDraft(me.id, null)
    setForm(newForm(stores, me.home_store_id))
    setError(null)
  }

  const scores = completeScores(form.scores)
  const result = scores ? judgePatrol(scores) : null
  const started = form.startedAt ? new Date(form.startedAt) : null
  const minutes = started ? durationMinutes(started, form.endedAt ? new Date(form.endedAt) : now) : 0
  const ready = Boolean(started && scores && form.goodPoints.trim() && form.improvements.trim())

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">🔍 {t('title')}</h1>
      {resumed && form.startedAt && <p className="rounded-xl bg-blue-50 p-3 text-sm">{t('time.resumed')}</p>}

      <Card className="flex flex-col gap-3">
        <Segmented<PatrolType>
          label={t('type.label')}
          value={form.patrolType}
          onChange={(patrolType) => update({ patrolType })}
          options={[
            { value: 'after_shift', label: t('type.after_shift') },
            { value: 'early', label: t('type.early') },
          ]}
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

      <Card className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-slate-700">⏱️ {t('time.label')}</h2>
        <Button onClick={() => start.mutate()} disabled={Boolean(started) || start.isPending}>
          {started ? t('time.started', { time: formatTokyoTime(started) }) : `▶ ${t('time.start')}`}
        </Button>
        {started && (
          <p className={minutes > PATROL_WARN_MINUTES ? 'font-bold text-red-700' : 'text-slate-700'}>
            {t('time.elapsed', { min: minutes })}
            {minutes > PATROL_WARN_MINUTES && ` — ⚠️ ${t('time.over')}`}
          </p>
        )}
        {!started && <p className="text-sm text-slate-600">{t('time.needStart')}</p>}
        {started && <p className="text-sm text-slate-600">{t('time.endOnSubmit')}</p>}
      </Card>

      <p className="text-sm text-slate-600">💡 {t('lowerHint')}</p>
      {PATROL_ITEMS.map((item) => (
        <ScoreItem key={item} item={item} value={form.scores[item]} onChange={(v) => update({ scores: { ...form.scores, [item]: v } })} />
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

      <AttachmentPicker value={media} onChange={setMedia} />

      {form.startedAt && (
        <Button variant="danger" onClick={() => void discard()}>
          {t('time.discard')}
        </Button>
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
        {error && <ErrorBox message={error} />}
        <Button
          className="w-full"
          disabled={submit.isPending}
          onClick={() => {
            setShowMissing(true)
            if (!ready) return
            // End time = first press of 送信する; kept for retries so a lost signal does not add paid minutes.
            const endedAt = form.endedAt ?? new Date().toISOString()
            update({ endedAt })
            submit.mutate(endedAt)
          }}
        >
          {submit.isPending ? t('common:action.loading') : t('common:action.submit')}
        </Button>
        <p className="mt-1 text-center text-xs text-slate-500">{t('editable')}</p>
      </StickyActions>
    </div>
  )
}
