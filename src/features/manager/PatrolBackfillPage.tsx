import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useSentNotice } from '../../components/SentNotice'
import { StaffPicker } from '../../components/StaffPicker'
import { Button, Card, Checkbox, ErrorBox, PageTitle, Segmented, Spinner, StickyActions, TextArea, TextInput } from '../../components/ui'
import { judgePatrol, PATROL_ITEMS } from '../../domain/patrol'
import { addDays } from '../../domain/time'
import { PATROL_TYPES, SHIFTS, type PatrolType, type Shift } from '../../domain/types'
import { currentLocale } from '../../i18n'
import { cx } from '../../lib/cx'
import { errorMessage, isNetworkError, storeName } from '../../lib/format'
import type { PreparedMedia } from '../../lib/media'
import { unwrap, useStores } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { AttachmentPicker } from '../attachments/AttachmentPicker'
import { useUploadQueue } from '../attachments/uploadQueue'
import { CustomerItem } from '../patrol/CustomerItem'
import { completeScores, type PatrolFormState } from '../patrol/draft'
import { ScoreItem } from '../patrol/ScoreItem'
import { TranslationCancelled, useTranslationGate } from '../translate/useTranslationGate'
import { fromLocalInput, JUDGE_STYLE, today } from './data'

/** Patrol members who can be named as the patroller (their 巡回時間 / pay). */
function usePatrolMembers() {
  return useQuery({
    queryKey: ['admin', 'patrol-members'],
    queryFn: async () =>
      unwrap<{ id: string; display_name: string | null; full_name: string | null }[]>(
        await supabase.from('profiles').select('id, display_name, full_name').eq('can_patrol', true).eq('status', 'active').order('display_name'),
      ),
  })
}

type Form = Pick<
  PatrolFormState,
  'scores' | 'maskWorn' | 'staffNames' | 'goodPoints' | 'improvements' | 'remarks' | 'customerNone' | 'customerSatisfied' | 'customerReason'
>

/**
 * 管理 → 巡回一覧 → 「巡回を後から記録」: a manager records a past patrol for a patrol member
 * (a patrol that could not be entered at the time). Times are typed; photos are optional and may come
 * from the gallery. The record is marked 管理者が後から記録.
 */
export function PatrolBackfillPage() {
  const { t } = useTranslation('manager')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const sent = useSentNotice()
  const locale = currentLocale()
  const stores = useStores()
  const members = usePatrolMembers()
  const uploads = useUploadQueue()
  const translation = useTranslationGate()

  const [patrollerId, setPatrollerId] = useState('')
  const [patrolType, setPatrolType] = useState<PatrolType>('after_shift')
  const [storeId, setStoreId] = useState('')
  const [businessDate, setBusinessDate] = useState(addDays(today(), -1))
  const [shift, setShift] = useState<Shift>('late')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [form, setForm] = useState<Form>({ scores: {}, goodPoints: '', improvements: '', remarks: '' })
  const [managerNote, setManagerNote] = useState('')
  const [media, setMedia] = useState<PreparedMedia[]>([])
  const [showMissing, setShowMissing] = useState(false)
  const update = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }))

  const effectiveStore = storeId || stores.data?.[0]?.id || ''
  const scores = completeScores(form.scores)
  const result = scores ? judgePatrol(scores) : null
  const timesOk = Boolean(start && end && end > start)
  const minutes = timesOk ? Math.floor((Date.parse(fromLocalInput(end)) - Date.parse(fromLocalInput(start))) / 60_000) : null
  const customerOk = Boolean(form.customerNone || form.customerSatisfied === true || (form.customerSatisfied === false && form.customerReason?.trim()))
  const ready = Boolean(patrollerId && effectiveStore && timesOk && scores && customerOk && form.goodPoints.trim() && form.improvements.trim())

  const submit = useMutation({
    mutationFn: async () => {
      if (!ready) {
        setShowMissing(true)
        throw new Error('validation')
      }
      const customerNo = !form.customerNone && form.customerSatisfied === false
      const staff = (form.staffNames ?? []).filter(Boolean)
      const tr = await translation.prepare([
        { key: 'good_points', label: t('patrol:goodPoints.label'), text: form.goodPoints.trim() },
        { key: 'improvements', label: t('patrol:improvements.label'), text: form.improvements.trim() },
        { key: 'remarks', label: t('patrol:remarks.label'), text: form.remarks.trim() || null },
        { key: 'customer_reason', label: t('patrol:customer.reason'), text: customerNo ? (form.customerReason ?? '').trim() : null },
        { key: 'manager_note', label: t('chorei:backfill.note'), text: managerNote.trim() || null },
      ])
      const res = await supabase
        .from('patrol_checks')
        .insert({
          patroller_id: patrollerId,
          store_id: effectiveStore,
          business_date: businessDate,
          shift,
          patrol_type: patrolType,
          started_at: fromLocalInput(start),
          ended_at: fromLocalInput(end),
          score_smile: scores!.smile,
          score_voice: scores!.voice,
          score_grooming: scores!.grooming,
          score_clean: scores!.clean,
          score_quality: scores!.quality,
          mask_worn: Boolean(form.maskWorn),
          staff_names: staff,
          staff_on_shift: staff.join('、') || '全員',
          good_points: tr.values.good_points,
          improvements: tr.values.improvements,
          remarks: tr.values.remarks || null,
          customer_none: Boolean(form.customerNone),
          customer_satisfied: form.customerNone ? null : (form.customerSatisfied ?? null),
          customer_reason: customerNo ? tr.values.customer_reason : null,
          original_texts: tr.originals,
          source_lang: tr.sourceLang,
          status: 'valid',
          entered_by_manager: true,
          manager_note: tr.values.manager_note ?? null,
        })
        .select('id')
        .single()
      const { id } = unwrap<{ id: string }>(res)
      if (media.length) await uploads.enqueue('patrol', id, media)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin'] })
      sent({
        kind: t('common:sent.patrol'),
        detail: `${businessDate.slice(5).replace('-', '/')} ${t(`common:shift.${shift}`)}・${storeName(stores.data?.find((s) => s.id === effectiveStore), locale)}`,
        photos: media.length,
      })
      void navigate('/manager/patrol')
    },
  })
  const err = submit.error
  const errorText =
    !err || err.message === 'validation' || err instanceof TranslationCancelled
      ? null
      : isNetworkError(err)
        ? t('common:error.network')
        : `${t('common:error.generic')} (${errorMessage(err)})`

  if (stores.isLoading || members.isLoading) return <Spinner />

  return (
    <div className="flex flex-col gap-4">
      {translation.review}
      <PageTitle title={t('patrolBackfill.title')} />
      <p className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900 ring-1 ring-amber-300">{t('patrolBackfill.banner')}</p>

      <Card className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[15px] font-bold">
          {t('patrolBackfill.patroller')} *
          <select
            className={cx('min-h-12 rounded-xl border border-line bg-white px-3 font-normal', showMissing && !patrollerId && 'ring-2 ring-red-600')}
            value={patrollerId}
            onChange={(e) => setPatrollerId(e.target.value)}
          >
            <option value="">{t('patrolBackfill.pick')}</option>
            {(members.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name || m.display_name}
              </option>
            ))}
          </select>
        </label>
        <Segmented<PatrolType>
          label={t('patrol:type.label')}
          value={patrolType}
          onChange={setPatrolType}
          columns={2}
          options={PATROL_TYPES.map((value) => ({ value, label: t(`patrol:type.${value}`) }))}
        />
        <Segmented
          label={t('patrol:target')}
          value={effectiveStore}
          onChange={setStoreId}
          options={(stores.data ?? []).map((s) => ({ value: s.id, label: storeName(s, locale) }))}
        />
        <Segmented label={t('common:field.shift')} value={shift} onChange={setShift} options={SHIFTS.map((s) => ({ value: s, label: t(`common:shift.${s}`) }))} />
        <TextInput label={t('common:field.date')} type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
      </Card>

      <Card className={cx('flex flex-col gap-3', showMissing && !timesOk && 'ring-2 ring-red-600')}>
        <h2 className="text-sm font-bold text-slate-700">{t('patrolBackfill.times')} *</h2>
        <label className="text-sm font-bold">
          {t('detail.start')}
          <input type="datetime-local" className="min-h-11 w-full rounded-lg border border-slate-300 px-2" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="text-sm font-bold">
          {t('detail.end')}
          <input type="datetime-local" className="min-h-11 w-full rounded-lg border border-slate-300 px-2" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        {minutes !== null && <p className="text-sm">{t('patrolBackfill.minutes', { n: minutes })}</p>}
        {start && end && !timesOk && <ErrorBox message={t('patrolBackfill.endAfterStart')} />}
        <p className="text-xs text-slate-600">{t('patrolBackfill.timesHint')}</p>
      </Card>

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
                <Checkbox checked={Boolean(form.maskWorn)} onChange={(maskWorn) => update({ maskWorn, scores: { ...form.scores, smile: maskWorn ? 1 : undefined } })}>
                  😷 <b>{t('patrol:items.smile.mask')}</b>
                </Checkbox>
              </div>
            )
          }
        />
      ))}
      <CustomerItem value={form} onChange={update} missing={showMissing} />

      <Card className="flex flex-col gap-3">
        <StaffPicker label={t('patrol:staffOnShift')} hint={t('patrol:staffOnShiftHint')} value={form.staffNames ?? []} onChange={(staffNames) => update({ staffNames })} storeId={effectiveStore} />
        <TextArea
          label={`${t('patrol:goodPoints.label')} *`}
          value={form.goodPoints}
          onChange={(e) => update({ goodPoints: e.target.value })}
          error={showMissing && !form.goodPoints.trim() ? t('common:error.required') : null}
        />
        <TextArea
          label={`${t('patrol:improvements.label')} *`}
          value={form.improvements}
          onChange={(e) => update({ improvements: e.target.value })}
          error={showMissing && !form.improvements.trim() ? t('common:error.required') : null}
        />
        <TextArea label={t('patrol:remarks.label')} value={form.remarks} onChange={(e) => update({ remarks: e.target.value })} />
      </Card>

      <AttachmentPicker value={media} onChange={setMedia} hint={t('patrolBackfill.photosHint')} />

      <Card className="flex flex-col gap-2 ring-2 ring-blue-300">
        <TextArea
          label={t('chorei:backfill.note')}
          placeholder={t('patrolBackfill.notePlaceholder')}
          value={managerNote}
          onChange={(e) => setManagerNote(e.target.value)}
        />
      </Card>

      <StickyActions>
        {result && (
          <div className={`mb-2 flex items-center justify-between rounded-xl px-3 py-2 font-bold ${JUDGE_STYLE[result.judgement] ?? ''}`}>
            <span>{t('patrol:total', { total: result.total, max: result.max })}</span>
            <span>{t(`common:judgement.${result.judgement}`)}</span>
          </div>
        )}
        {showMissing && !ready && <ErrorBox message={t('common:error.required')} />}
        {errorText && <ErrorBox message={errorText} />}
        <div className="grid grid-cols-[1fr_2fr] gap-2">
          <Button variant="secondary" onClick={() => void navigate('/manager/patrol')} disabled={submit.isPending}>
            {t('choreiEdit.cancel')}
          </Button>
          <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
            {submit.isPending ? t('common:action.loading') : t('common:action.submit')}
          </Button>
        </div>
      </StickyActions>
    </div>
  )
}
