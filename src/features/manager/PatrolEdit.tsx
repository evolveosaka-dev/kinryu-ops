import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StaffPicker } from '../../components/StaffPicker'
import { useToast } from '../../components/Toast'
import { Button, Card, Checkbox, ErrorBox, Segmented, TextArea, TextInput } from '../../components/ui'
import { judgePatrol, PATROL_ITEMS, type PatrolItem, type Score } from '../../domain/patrol'
import { PATROL_TYPES, SHIFTS, type PatrolType, type Shift } from '../../domain/types'
import { currentLocale } from '../../i18n'
import { errorMessage, storeName } from '../../lib/format'
import type { PreparedMedia } from '../../lib/media'
import { unwrap, useStores } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { AttachmentPicker } from '../attachments/AttachmentPicker'
import { useUploadQueue } from '../attachments/uploadQueue'
import { CustomerItem } from '../patrol/CustomerItem'
import { completeScores, type PatrolFormState } from '../patrol/draft'
import { ScoreItem } from '../patrol/ScoreItem'
import { TranslationCancelled, useTranslationGate } from '../translate/useTranslationGate'
import { AttachmentList } from './AttachmentList'
import { PersonSelect } from './common'
import { JUDGE_STYLE, jstDateTime, usePeople, type AdminPatrol } from './data'

const TEXT_FIELDS = ['good_points', 'improvements', 'remarks', 'customer_reason'] as const
const SCORE_COLUMN: Record<PatrolItem, 'score_smile' | 'score_voice' | 'score_grooming' | 'score_clean' | 'score_quality'> = {
  smile: 'score_smile',
  voice: 'score_voice',
  grooming: 'score_grooming',
  clean: 'score_clean',
  quality: 'score_quality',
}

type Form = Pick<PatrolFormState, 'scores' | 'maskWorn' | 'staffNames' | 'goodPoints' | 'improvements' | 'remarks' | 'customerNone' | 'customerSatisfied' | 'customerReason'>

/** 管理 → 巡回 → detail: a manager corrects a patrol check (type, slot, scores, ⑥, staff, texts, memo) and adds photos/videos. */
export function PatrolEdit({ patrol: p, onDone }: { patrol: AdminPatrol; onDone: () => void }) {
  const { t } = useTranslation('manager')
  const queryClient = useQueryClient()
  const toast = useToast()
  const stores = useStores()
  const uploads = useUploadQueue()
  const translation = useTranslationGate()
  const locale = currentLocale()

  const [patrolType, setPatrolType] = useState<PatrolType>(p.patrol_type)
  const [patrollerId, setPatrollerId] = useState(p.patroller_id)
  const [storeId, setStoreId] = useState(p.store_id)
  const [shift, setShift] = useState<Shift>(p.shift)
  const [businessDate, setBusinessDate] = useState(p.business_date)
  const [form, setForm] = useState<Form>({
    scores: Object.fromEntries(PATROL_ITEMS.map((i) => [i, (p[SCORE_COLUMN[i]] ?? null) as Score | null])),
    maskWorn: p.mask_worn,
    staffNames: p.staff_names,
    goodPoints: p.good_points ?? '',
    improvements: p.improvements ?? '',
    remarks: p.remarks ?? '',
    customerNone: p.customer_none,
    customerSatisfied: p.customer_satisfied ?? undefined,
    customerReason: p.customer_reason ?? '',
  })
  const [managerNote, setManagerNote] = useState(p.manager_note ?? '')
  const [media, setMedia] = useState<PreparedMedia[]>([])
  const [showMissing, setShowMissing] = useState(false)
  const update = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }))

  const live = p.attachments.filter((a) => a.status === 'pending' || a.status === 'uploaded')
  const waiting = uploads.items.filter((i) => i.parentId === p.id && i.status !== 'error' && !live.some((a) => a.id === i.attachmentId))
  const taken = {
    images: [...live, ...waiting].filter((a) => a.kind === 'image').length,
    videos: [...live, ...waiting].filter((a) => a.kind === 'video').length,
  }

  const scores = completeScores(form.scores)
  const result = scores ? judgePatrol(scores) : null
  const customerNo = !form.customerNone && form.customerSatisfied === false
  const customerOk = Boolean(form.customerNone || form.customerSatisfied === true || (customerNo && form.customerReason?.trim()))
  // records sent before ⑥ existed have no answer; they may stay that way
  const customerAnswered = p.customer_none || p.customer_satisfied !== null || form.customerNone || form.customerSatisfied !== undefined
  const ready = Boolean(scores && (!customerAnswered || customerOk) && form.goodPoints.trim() && form.improvements.trim() && businessDate)

  const save = useMutation({
    mutationFn: async () => {
      if (!ready) {
        setShowMissing(true)
        throw new Error('validation')
      }
      const staff = (form.staffNames ?? []).filter(Boolean)
      const next: Record<(typeof TEXT_FIELDS)[number], string | null> = {
        good_points: form.goodPoints.trim(),
        improvements: form.improvements.trim(),
        remarks: form.remarks.trim() || null,
        customer_reason: customerNo ? (form.customerReason ?? '').trim() : null,
      }
      // only changed text goes through translation; an unchanged field keeps its 原文
      const changed = TEXT_FIELDS.filter((k) => next[k] !== (p[k] ?? null))
      // the manager's own note is translated to Japanese too (owner, 2026-10-16)
      const note = managerNote.trim() || null
      const noteChanged = note !== (p.manager_note ?? null)
      const tr = await translation.prepare([
        ...changed.map((k) => ({ key: k, label: t(`patrolEdit.field.${k}`), text: next[k] })),
        ...(noteChanged ? [{ key: 'manager_note', label: t('chorei:backfill.note'), text: note }] : []),
      ])
      const retranslated = [...changed, ...(noteChanged ? ['manager_note'] : [])] as string[]
      const originals = Object.fromEntries(Object.entries(p.original_texts ?? {}).filter(([k]) => !retranslated.includes(k)))
      Object.assign(originals, tr.originals ?? {})
      const patch = {
        patrol_type: patrolType,
        patroller_id: patrollerId,
        store_id: storeId,
        shift,
        business_date: businessDate,
        score_smile: scores!.smile,
        score_voice: scores!.voice,
        score_grooming: scores!.grooming,
        score_clean: scores!.clean,
        score_quality: scores!.quality,
        mask_worn: Boolean(form.maskWorn),
        staff_names: staff,
        staff_on_shift: staff.join('、') || '全員',
        customer_none: Boolean(form.customerNone),
        customer_satisfied: form.customerNone ? null : (form.customerSatisfied ?? null),
        ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, changed.includes(k) ? (tr.values[k] ?? null) : next[k]])),
        manager_note: noteChanged ? (tr.values.manager_note ?? null) : (p.manager_note ?? null),
        original_texts: Object.keys(originals).length ? originals : null,
        ...(tr.sourceLang ? { source_lang: tr.sourceLang } : {}),
      }
      unwrap(await supabase.from('patrol_checks').update(patch).eq('id', p.id))
      if (media.length) await uploads.enqueue('patrol', p.id, media)
    },
    onSuccess: () => {
      toast(t('choreiEdit.saved'))
      void queryClient.invalidateQueries({ queryKey: ['admin'] })
      void queryClient.invalidateQueries({ queryKey: ['staff'] })
      onDone()
    },
  })
  const failed = save.error && save.error.message !== 'validation' && !(save.error instanceof TranslationCancelled)

  return (
    <Card className="flex flex-col gap-3 ring-2 ring-blue-300">
      {translation.review}
      <h3 className="font-bold">{t('patrolEdit.title')}</h3>
      <PersonSelect label={t('detail.patroller')} value={patrollerId} onChange={setPatrollerId} />
      <Segmented<PatrolType> label={t('patrol:type.label')} value={patrolType} onChange={setPatrolType} columns={2} options={PATROL_TYPES.map((value) => ({ value, label: t(`patrol:type.${value}`) }))} />
      <Segmented label={t('patrol:target')} value={storeId} onChange={setStoreId} options={(stores.data ?? []).map((s) => ({ value: s.id, label: storeName(s, locale) }))} />
      <Segmented label={t('common:field.shift')} value={shift} onChange={setShift} options={SHIFTS.map((s) => ({ value: s, label: t(`common:shift.${s}`) }))} />
      <TextInput label={t('common:field.date')} type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
      <p className="text-xs text-slate-600">{t('patrolEdit.timesHint')}</p>

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
      <CustomerItem value={form} onChange={update} missing={showMissing && customerAnswered} />

      <StaffPicker label={t('patrol:staffOnShift')} hint={t('patrol:staffOnShiftHint')} value={form.staffNames ?? []} onChange={(staffNames) => update({ staffNames })} storeId={storeId} />
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
      <TextArea label={t('chorei:backfill.note')} value={managerNote} onChange={(e) => setManagerNote(e.target.value)} />

      <div className="flex flex-col gap-1 rounded-xl bg-slate-50 p-2 text-sm">
        <span className="font-bold text-slate-700">{t('files.now')}</span>
        <AttachmentList list={p.attachments} parentId={p.id} />
      </div>
      <AttachmentPicker value={media} onChange={setMedia} taken={taken} hint={t('choreiEdit.filesHint')} />

      {result && (
        <div className={`flex items-center justify-between rounded-xl px-3 py-2 font-bold ${JUDGE_STYLE[result.judgement] ?? ''}`}>
          <span>{t('patrol:total', { total: result.total, max: result.max })}</span>
          <span>{t(`common:judgement.${result.judgement}`)}</span>
        </div>
      )}
      {showMissing && !ready && <ErrorBox message={t('common:error.required')} />}
      {failed && <ErrorBox message={errorMessage(save.error)} />}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onDone} disabled={save.isPending}>
          {t('choreiEdit.cancel')}
        </Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? t('common:action.loading') : t('choreiEdit.save')}
        </Button>
      </div>
    </Card>
  )
}

interface AuditRow {
  id: string
  at: string
  actor_id: string | null
  action: string
  diff: Record<string, { old: unknown; new: unknown }>
}

/** Fields shown in the edit history, in form order (translations, flags and timestamps are left out). */
const HISTORY_FIELDS: Record<string, string> = {
  patroller_id: 'detail.patroller',
  patrol_type: 'patrol:type.label',
  store_id: 'patrol:target',
  shift: 'common:field.shift',
  business_date: 'common:field.date',
  started_at: 'detail.start',
  ended_at: 'detail.end',
  score_smile: 'patrol:items.smile.name',
  score_voice: 'patrol:items.voice.name',
  score_grooming: 'patrol:items.grooming.name',
  score_clean: 'patrol:items.clean.name',
  score_quality: 'patrol:items.quality.name',
  mask_worn: 'patrol:items.smile.mask',
  customer_none: 'patrol:customer.short',
  customer_satisfied: 'patrol:customer.short',
  customer_reason: 'patrol:customer.reason',
  staff_names: 'detail.staff',
  good_points: 'patrol:goodPoints.label',
  improvements: 'patrol:improvements.label',
  remarks: 'patrol:remarks.label',
  manager_note: 'chorei:backfill.note',
  void_reason: 'detail.voidReason',
}

/** 修正の履歴 of a patrol check: changes from audit_log and files added by someone else. Only on 管理 screens. */
export function PatrolEditHistory({ patrol: p }: { patrol: AdminPatrol }) {
  const { t } = useTranslation('manager')
  const people = usePeople()
  const stores = useStores()
  const audit = useQuery({
    queryKey: ['admin', 'audit', 'patrol_checks', p.id],
    queryFn: async () =>
      unwrap<AuditRow[]>(await supabase.from('audit_log').select('id, at, actor_id, action, diff').eq('table_name', 'patrol_checks').eq('row_id', p.id).order('at')),
  })
  const show = (k: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—'
    if (k === 'patrol_type') return t(`patrol:type.${String(v)}`)
    if (k === 'shift') return t(`common:shift.${String(v)}`)
    if (k === 'store_id') return storeName(stores.data?.find((s) => s.id === v), 'ja')
    if (k === 'patroller_id') return people.name(String(v))
    if (k === 'started_at' || k === 'ended_at') return jstDateTime(String(v))
    if (typeof v === 'boolean') return v ? '✓' : '—'
    if (Array.isArray(v)) return v.length ? v.join('、') : '—'
    return String(v)
  }
  // the patroller's draft saves and the 送信 itself are not edits
  const rows = (audit.data ?? []).filter((row) => p.submitted_at && row.at > p.submitted_at && !(row.diff.status && (row.diff.status.old as string) === 'draft'))
  const edits = rows
    .map((row) => ({
      at: row.at,
      who: row.actor_id ? people.name(row.actor_id) : '—',
      lines: [
        ...(row.action === 'void' ? [t('choreiEdit.voided')] : []),
        ...Object.keys(HISTORY_FIELDS)
          .filter((k) => row.diff[k])
          .map((k) => `${t(HISTORY_FIELDS[k]!)}：${show(k, row.diff[k]!.old)} → ${show(k, row.diff[k]!.new)}`),
      ],
    }))
    .filter((e) => e.lines.length)
  const added = p.attachments.filter((a) => a.owner_id && a.owner_id !== p.patroller_id && a.status !== 'deleted' && a.created_at)
  const byOwner = new Map<string, typeof added>()
  for (const a of added) byOwner.set(`${a.owner_id}|${a.created_at!.slice(0, 16)}`, [...(byOwner.get(`${a.owner_id}|${a.created_at!.slice(0, 16)}`) ?? []), a])
  const entries = [
    ...edits,
    ...[...byOwner.values()].map((list) => ({ at: list[0]!.created_at!, who: people.name(list[0]!.owner_id!), lines: [t('choreiEdit.addedFiles', { n: list.length })] })),
  ].sort((a, b) => a.at.localeCompare(b.at))
  if (!entries.length) return null

  return (
    <Card className="flex flex-col gap-2">
      <h3 className="font-bold">📝 {t('choreiEdit.history')}</h3>
      <p className="text-xs text-slate-600">{t('patrolEdit.historyNote')}</p>
      <ul className="flex flex-col gap-2 text-sm">
        {entries.map((e, i) => (
          <li key={i} className="border-t border-slate-100 pt-2">
            <p className="font-bold">
              {jstDateTime(e.at)} ・ {e.who}
            </p>
            {e.lines.map((l, j) => (
              <p key={j} className="whitespace-pre-wrap">
                {l}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </Card>
  )
}
