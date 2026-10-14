import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StaffPicker } from '../../components/StaffPicker'
import { useToast } from '../../components/Toast'
import { Button, Card, Checkbox, ErrorBox, Segmented, TextArea, TextInput } from '../../components/ui'
import { CHOREI_STEPS, SHIFTS, type Shift, type StepsDone } from '../../domain/types'
import { currentLocale } from '../../i18n'
import { errorMessage, storeName } from '../../lib/format'
import { unwrap, useStores } from '../../lib/queries'
import type { PreparedMedia } from '../../lib/media'
import { supabase } from '../../lib/supabase'
import { AttachmentPicker } from '../attachments/AttachmentPicker'
import { useUploadQueue } from '../attachments/uploadQueue'
import { choreiSchema, fieldErrors } from '../chorei/schema'
import { TranslationCancelled, useTranslationGate } from '../translate/useTranslationGate'
import { AttachmentList } from './AttachmentList'
import { PersonSelect } from './common'
import { jstDateTime, usePeople, type AdminChorei } from './data'
import { checkParticipants } from '../../domain/participants'
import { useSlotSchedule } from '../../lib/queries'
import { ScheduleCheckDialog } from '../chorei/ScheduleCheckDialog'

const TEXT_FIELDS = ['stock_text', 'caution_text', 'skip_reason'] as const

/** 管理/朝礼: a manager corrects a 朝礼 record and adds photos/videos (staff cannot edit in 履歴). */
export function ChoreiEdit({ record: r, onDone }: { record: AdminChorei; onDone: () => void }) {
  const { t } = useTranslation('manager')
  const queryClient = useQueryClient()
  const toast = useToast()
  const uploads = useUploadQueue()
  const translation = useTranslationGate()
  const stores = useStores()
  // who and which slot: managers correct everything the leader sent
  const [leaderId, setLeaderId] = useState(r.leader_id)
  const [storeId, setStoreId] = useState(r.store_id)
  const [shift, setShift] = useState<Shift>(r.shift)
  const [businessDate, setBusinessDate] = useState(r.business_date)
  const [participants, setParticipants] = useState<string[]>(r.participants_extra)
  const [stockNone, setStockNone] = useState(r.stock_none)
  const [stockText, setStockText] = useState(r.stock_text ?? '')
  const [target, setTarget] = useState(r.target_bowls === null ? '' : String(r.target_bowls))
  const [caution, setCaution] = useState(r.caution_text ?? '')
  const [steps, setSteps] = useState<StepsDone>(r.steps_done)
  const [skipReason, setSkipReason] = useState(r.skip_reason ?? '')
  const [managerNote, setManagerNote] = useState(r.manager_note ?? '')
  const [media, setMedia] = useState<PreparedMedia[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const live = r.attachments.filter((a) => a.status === 'pending' || a.status === 'uploaded')
  const waiting = uploads.items.filter((i) => i.parentId === r.id && i.status !== 'error' && !live.some((a) => a.id === i.attachmentId))
  const taken = {
    images: [...live, ...waiting].filter((a) => a.kind === 'image').length,
    videos: [...live, ...waiting].filter((a) => a.kind === 'video').length,
  }
  const allDone = Object.values(steps).every(Boolean)
  // 参加者 vs the shift table: the manager confirms too when they differ
  const people = usePeople()
  const leader = people.data?.find((p) => p.id === leaderId)
  const schedule = useSlotSchedule(storeId, businessDate, shift)
  const scheduleCheck = checkParticipants(r.shift, participants, [leader?.roster_name, leader?.display_name], schedule.data ?? [])
  const [checking, setChecking] = useState(false)

  const save = useMutation({
    mutationFn: async () => {
      const parsed = choreiSchema.safeParse({
        store_id: storeId,
        business_date: businessDate,
        shift,
        participants: r.participants,
        participants_extra: participants.filter(Boolean),
        stock_none: stockNone,
        stock_text: stockNone ? null : stockText.trim() || null,
        target_bowls: target === '' ? null : Number(target),
        caution_text: caution.trim() || null,
        steps_done: steps,
        skip_reason: allDone ? null : skipReason.trim() || null,
      })
      if (!parsed.success) {
        setErrors(fieldErrors(parsed.error))
        throw new Error('validation')
      }
      setErrors({})
      // only changed text goes through translation; an unchanged field keeps its 原文
      const changed = TEXT_FIELDS.filter((k) => (parsed.data[k] ?? null) !== (r[k] ?? null))
      // the manager's own note is translated to Japanese too (owner, 2026-10-16)
      const note = managerNote.trim() || null
      const noteChanged = note !== (r.manager_note ?? null)
      const tr = await translation.prepare([
        ...changed.map((k) => ({ key: k, label: t(`choreiEdit.field.${k}`), text: parsed.data[k] })),
        ...(noteChanged ? [{ key: 'manager_note', label: t('chorei:backfill.note'), text: note }] : []),
      ])
      const retranslated = [...changed, ...(noteChanged ? ['manager_note'] : [])] as string[]
      const originals = Object.fromEntries(Object.entries(r.original_texts ?? {}).filter(([k]) => !retranslated.includes(k)))
      Object.assign(originals, tr.originals ?? {})
      const patch = {
        leader_id: leaderId,
        store_id: storeId,
        business_date: businessDate,
        shift,
        participants_extra: parsed.data.participants_extra,
        stock_none: parsed.data.stock_none,
        target_bowls: parsed.data.target_bowls,
        steps_done: parsed.data.steps_done,
        manager_note: noteChanged ? (tr.values.manager_note ?? null) : (r.manager_note ?? null),
        ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, changed.includes(k) ? (tr.values[k] ?? null) : (r[k] ?? null)])),
        original_texts: Object.keys(originals).length ? originals : null,
        ...(tr.sourceLang ? { source_lang: tr.sourceLang } : {}),
      }
      const res = await supabase.from('chorei_records').update(patch).eq('id', r.id)
      if (res.error) throw new Error(res.error.message)
      // photos/videos go to Google Drive in the background (queued, retried)
      if (media.length) await uploads.enqueue('chorei', r.id, media)
    },
    onSuccess: () => {
      toast(t('choreiEdit.saved'))
      void queryClient.invalidateQueries({ queryKey: ['admin'] })
      onDone()
    },
  })
  const failed = save.error && save.error.message !== 'validation' && !(save.error instanceof TranslationCancelled)

  return (
    <Card className="flex flex-col gap-3 ring-2 ring-blue-300">
      {translation.review}
      {checking && scheduleCheck && (
        <ScheduleCheckDialog
          check={scheduleCheck}
          busy={save.isPending}
          onCancel={() => setChecking(false)}
          onConfirm={() => {
            setChecking(false)
            save.mutate()
          }}
        />
      )}
      <h3 className="font-bold">{t('choreiEdit.title')}</h3>
      <PersonSelect label={t('detail.leader')} value={leaderId} onChange={setLeaderId} />
      <Segmented label={t('common:field.store')} value={storeId} onChange={setStoreId} options={(stores.data ?? []).map((s) => ({ value: s.id, label: storeName(s, currentLocale()) }))} />
      <Segmented label={t('common:field.shift')} value={shift} onChange={setShift} options={SHIFTS.map((s) => ({ value: s, label: t(`common:shift.${s}`) }))} />
      <TextInput label={t('common:field.date')} type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
      <StaffPicker label={t('chorei:participants.label')} value={participants} onChange={setParticipants} storeId={storeId} slot={{ date: businessDate, shift }} />
      <Checkbox checked={stockNone} onChange={setStockNone}>
        {t('chorei:stock.label')}：<b>{t('chorei:stock.none')}</b>
      </Checkbox>
      {!stockNone && (
        <TextArea
          label={t('chorei:stock.label')}
          value={stockText}
          onChange={(e) => setStockText(e.target.value)}
          error={errors.stock_text ? t(`chorei:${errors.stock_text}`) : null}
        />
      )}
      <TextInput
        label={`${t('chorei:target.label')}（${t('chorei:target.unit')}）`}
        type="number"
        inputMode="numeric"
        min={0}
        value={target}
        onChange={(e) => setTarget(e.target.value)}
      />
      <TextArea label={t('chorei:caution.label')} value={caution} onChange={(e) => setCaution(e.target.value)} />
      <div className="flex flex-col gap-1">
        <h4 className="text-sm font-bold text-slate-700">{t('chorei:steps.label')}</h4>
        {CHOREI_STEPS.map((s) => (
          <Checkbox key={s} checked={steps[s]} onChange={(v) => setSteps((prev) => ({ ...prev, [s]: v }))}>
            {t(`chorei:steps.${s}`)}
          </Checkbox>
        ))}
        {!allDone && (
          <TextInput
            label={t('chorei:steps.skipReason')}
            value={skipReason}
            onChange={(e) => setSkipReason(e.target.value)}
            error={errors.skip_reason ? t(`chorei:${errors.skip_reason}`) : null}
          />
        )}
      </div>
      <TextArea label={t('chorei:backfill.note')} value={managerNote} onChange={(e) => setManagerNote(e.target.value)} />
      <div className="flex flex-col gap-1 rounded-xl bg-slate-50 p-2 text-sm">
        <span className="font-bold text-slate-700">{t('files.now')}</span>
        <AttachmentList list={r.attachments} parentId={r.id} />
      </div>
      <AttachmentPicker value={media} onChange={setMedia} taken={taken} hint={t('choreiEdit.filesHint')} />
      {failed && <ErrorBox message={errorMessage(save.error)} />}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onDone} disabled={save.isPending}>
          {t('choreiEdit.cancel')}
        </Button>
        <Button onClick={() => (scheduleCheck ? setChecking(true) : save.mutate())} disabled={save.isPending}>
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
  leader_id: 'detail.leader',
  store_id: 'common:field.store',
  shift: 'common:field.shift',
  business_date: 'common:field.date',
  participants_extra: 'chorei:participants.label',
  stock_none: 'chorei:stock.label',
  stock_text: 'chorei:stock.label',
  target_bowls: 'chorei:target.label',
  caution_text: 'chorei:caution.label',
  steps_done: 'chorei:steps.label',
  skip_reason: 'chorei:steps.skipReason',
  manager_note: 'chorei:backfill.note',
  void_reason: 'detail.voidReason',
}

/** 修正の履歴 of a 朝礼 record: manager edits from audit_log and files added after sending. Only on 管理 screens. */
export function ChoreiEditHistory({ record: r }: { record: AdminChorei }) {
  const { t } = useTranslation('manager')
  const people = usePeople()
  const stores = useStores()
  const audit = useQuery({
    queryKey: ['admin', 'audit', 'chorei_records', r.id],
    queryFn: async () =>
      unwrap<AuditRow[]>(
        await supabase.from('audit_log').select('id, at, actor_id, action, diff').eq('table_name', 'chorei_records').eq('row_id', r.id).order('at'),
      ),
  })
  const show = (k: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—'
    if (k === 'stock_none') return v ? t('chorei:stock.none') : t('choreiEdit.stockSome')
    if (k === 'leader_id') return people.name(String(v))
    if (k === 'store_id') return storeName(stores.data?.find((s) => s.id === v), 'ja')
    if (k === 'shift') return t(`common:shift.${String(v)}`)
    if (Array.isArray(v)) return v.length ? v.join('、') : '—'
    return String(v)
  }
  const lines = (row: AuditRow): string[] => {
    const out: string[] = []
    if (row.action === 'void') out.push(t('choreiEdit.voided'))
    for (const k of Object.keys(HISTORY_FIELDS)) {
      const d = row.diff[k]
      if (!d) continue
      if (k === 'steps_done') {
        const o = (d.old ?? {}) as Record<string, boolean>
        const n = (d.new ?? {}) as Record<string, boolean>
        const changed = CHOREI_STEPS.filter((s) => o[s] !== n[s]).map((s) => `${t(`chorei:steps.${s}`)} ${o[s] ? '✓' : '✗'}→${n[s] ? '✓' : '✗'}`)
        if (changed.length) out.push(`${t(HISTORY_FIELDS[k]!)}：${changed.join('、')}`)
        continue
      }
      out.push(`${t(HISTORY_FIELDS[k]!)}：${show(k, d.old)} → ${show(k, d.new)}`)
    }
    return out
  }
  // fill_chorei_targets marks its rows
  const autoTarget = (row: AuditRow) => row.action === 'auto_target'
  const edits = (audit.data ?? [])
    .map((row) => ({ at: row.at, who: autoTarget(row) ? t('choreiEdit.autoTarget') : row.actor_id ? people.name(row.actor_id) : '—', lines: lines(row) }))
    .filter((e) => e.lines.length)
  // files the leader did not send themselves = added later by a manager
  const added = r.attachments.filter((a) => a.owner_id && a.owner_id !== r.leader_id && a.status !== 'deleted' && a.created_at)
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
      <p className="text-xs text-slate-600">{t('choreiEdit.historyNote', { at: jstDateTime(r.submitted_at) })}</p>
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
