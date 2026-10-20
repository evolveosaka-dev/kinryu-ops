import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Card, ErrorBox, TextArea } from '../../components/ui'
import { normalizedTo25 } from '../../domain/patrol'
import { ITEM_KEYS } from '../../domain/stats'
import { CHOREI_STEPS } from '../../domain/types'
import { currentLocale } from '../../i18n'
import { errorMessage, storeName } from '../../lib/format'
import { unwrap, useStores } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { TranslationCancelled, useTranslationGate } from '../translate/useTranslationGate'
import type { AttachmentSummary } from '../../lib/types'
import { RecordComments } from '../comments/Comments'
import { issueTagsToSave, STAFF_ISSUES_ENABLED } from '../../domain/issues'
import { CustomerResult } from '../patrol/CustomerItem'
import { ViewMediaButton } from '../attachments/MediaViewer'
import { AttachmentList } from './AttachmentList'
import { ChoreiEdit, ChoreiEditHistory } from './ChoreiEdit'
import { PatrolEdit, PatrolEditHistory } from './PatrolEdit'
import { IssueTagsPicker, IssueTagsView, type IssueValue } from '../patrol/IssueTags'
import { Sheet, Dot } from './common'
import { fromLocalInput, jstDateTime, toLocalInput, type AdminChorei, type AdminPatrol, JUDGE_STYLE } from './data'

const ITEM_NAME: Record<(typeof ITEM_KEYS)[number], string> = {
  score_smile: 'smile',
  score_voice: 'voice',
  score_grooming: 'grooming',
  score_clean: 'clean',
  score_quality: 'quality',
}

function useUpdate(table: 'patrol_checks' | 'chorei_records', id: string, onDone: () => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (patch: Record<string, unknown>) => unwrap(await supabase.from(table).update(patch).eq('id', id)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin'] })
      void queryClient.invalidateQueries({ queryKey: ['staff'] })
      onDone()
    },
  })
}

/**
 * A manager's free text (補助指導のメモ, 取り消しの理由) is saved in Japanese: other-language text goes through
 * the translation check first, and the text as written goes to original_texts of the record.
 */
function useJaUpdate(update: ReturnType<typeof useUpdate>, originalTexts: Record<string, string> | null) {
  const translation = useTranslationGate()
  const [error, setError] = useState<Error | null>(null)
  const run = async (patch: Record<string, unknown>, field: string, label: string) => {
    setError(null)
    try {
      const tr = await translation.prepare([{ key: field, label, text: (patch[field] as string | null) ?? null }])
      update.mutate({ ...patch, [field]: tr.values[field], ...(tr.originals ? { original_texts: { ...(originalTexts ?? {}), ...tr.originals } } : {}) })
    } catch (e) {
      if (!(e instanceof TranslationCancelled)) setError(e instanceof Error ? e : new Error(String(e)))
    }
  }
  return { run, review: translation.review, error }
}

/** 追記 (chorei_notes) written by staff: managers correct the text (translated to Japanese like the original). */
function NoteRows({ notes }: { notes: AdminChorei['notes'] }) {
  const { t } = useTranslation('manager')
  const queryClient = useQueryClient()
  const translation = useTranslationGate()
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null)
  const save = useMutation({
    mutationFn: async (n: { id: string; body: string }) => {
      const tr = await translation.prepare([{ key: 'body', label: t('chorei:previous.notes'), text: n.body.trim() }])
      unwrap(await supabase.from('chorei_notes').update({ body: tr.values.body, ...(tr.originals ? { original_body: tr.originals.body } : {}) }).eq('id', n.id))
    },
    onSuccess: () => {
      setEditing(null)
      void queryClient.invalidateQueries({ queryKey: ['admin'] })
    },
  })
  return (
    <Row label={t('chorei:previous.notes')}>
      {translation.review}
      {notes.map((n) =>
        editing?.id === n.id ? (
          <span key={n.id} className="flex flex-col gap-1">
            <TextArea label={t('detail.noteEdit')} value={editing.body} onChange={(e) => setEditing({ id: n.id, body: e.target.value })} rows={2} />
            <span className="grid grid-cols-2 gap-2">
              <Button variant="secondary" className="min-h-10 py-1 text-sm" onClick={() => setEditing(null)} disabled={save.isPending}>
                {t('choreiEdit.cancel')}
              </Button>
              <Button className="min-h-10 py-1 text-sm" onClick={() => save.mutate(editing)} disabled={save.isPending || !editing.body.trim()}>
                {t('choreiEdit.save')}
              </Button>
            </span>
            {save.error && !(save.error instanceof TranslationCancelled) && <ErrorBox message={errorMessage(save.error)} />}
          </span>
        ) : (
          <span key={n.id} className="block">
            {n.body}
            {n.original_body && <span className="block text-xs text-slate-600">{t('detail.original')}: {n.original_body}</span>}
            <button type="button" className="ml-1 min-h-9 text-xs font-bold text-brand underline" onClick={() => setEditing({ id: n.id, body: n.body })}>
              {t('detail.edit')}
            </button>
          </span>
        ),
      )}
    </Row>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 text-sm">
      <span className="font-bold text-slate-600">{label}</span>
      <span className="whitespace-pre-wrap">{children}</span>
    </div>
  )
}

function Original({ texts, field }: { texts: Record<string, string> | null; field: string }) {
  const { t } = useTranslation('manager')
  const original = texts?.[field]
  return original ? <p className="mt-1 text-xs text-slate-600">{t('detail.original')}: {original}</p> : null
}

function Attachments({ list, parentId, skipped }: { list: AttachmentSummary[]; parentId: string; skipped?: boolean }) {
  const { t } = useTranslation('manager')
  return (
    <Row label={t('detail.attachments')}>
      {skipped && <span className="mb-1 block font-bold text-amber-800">📵 {t('common:attach.skipped')}</span>}
      <AttachmentList list={list} parentId={parentId} />
      <span className="mt-1 block">
        <ViewMediaButton list={list} title={t('common:attach.title')} />
      </span>
    </Row>
  )
}

/** 改善点の対象, correctable by managers (the counts per person follow at once). */
function IssueRow({ patrol: p }: { patrol: AdminPatrol }) {
  const { t } = useTranslation('manager')
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<IssueValue | null>(null)
  const staff = p.staff_names
  const save = useMutation({
    mutationFn: async (v: IssueValue) =>
      unwrap(await supabase.from('patrol_checks').update({ issue_tags: issueTagsToSave(v.issueNone, v.issueTags, staff) }).eq('id', p.id)),
    onSuccess: () => {
      setEditing(null)
      void queryClient.invalidateQueries({ queryKey: ['admin'] })
      void queryClient.invalidateQueries({ queryKey: ['staff'] })
    },
  })
  if (p.status === 'draft') return null
  return (
    <Row label={t('patrol:issues.short')}>
      {editing ? (
        <span className="flex flex-col gap-2">
          <IssueTagsPicker staff={staff} text={p.improvements ?? ''} value={editing} onChange={setEditing} missing={false} auto={false} />
          <span className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={save.isPending}>
              {t('detail.issueCancel')}
            </Button>
            <Button onClick={() => save.mutate(editing)} disabled={save.isPending || issueTagsToSave(editing.issueNone, editing.issueTags, staff) === null}>
              {t('detail.issueSave')}
            </Button>
          </span>
          {save.error && <ErrorBox message={errorMessage(save.error)} />}
        </span>
      ) : (
        <span className="flex flex-col items-start gap-1">
          {p.issue_tags ? <IssueTagsView tags={p.issue_tags} /> : <span className="text-slate-500">{t('staff.notTagged')}</span>}
          {p.status === 'valid' && (
            <button
              type="button"
              className="min-h-9 text-sm font-bold text-brand underline"
              onClick={() => setEditing({ issueTags: p.issue_tags ?? [], issueNone: p.issue_tags?.length === 0 })}
            >
              {t('detail.issueEdit')}
            </button>
          )}
        </span>
      )}
    </Row>
  )
}

export function PatrolDetail({ patrol: p, patrollerName, onClose }: { patrol: AdminPatrol; patrollerName: string; onClose: () => void }) {
  const { t } = useTranslation('manager')
  const stores = useStores()
  const update = useUpdate('patrol_checks', p.id, onClose)
  const ja = useJaUpdate(update, p.original_texts)
  const [note, setNote] = useState('')
  const [start, setStart] = useState(toLocalInput(p.started_at))
  const [end, setEnd] = useState(toLocalInput(p.ended_at))
  const [voidReason, setVoidReason] = useState('')
  // managers may correct the times at any time, not only when 時間の確認 is flagged
  const [timeEdit, setTimeEdit] = useState(false)
  const [editing, setEditing] = useState(false)
  const store = storeName(stores.data?.find((s) => s.id === p.store_id), currentLocale())
  const score = p.total !== null && p.max_total ? Math.round(normalizedTo25(p.total, p.max_total) * 10) / 10 : null

  return (
    <Sheet title={`${p.business_date} ${t(`common:shift.${p.shift}`)} ${store}`} onClose={onClose}>
      {ja.review}
      <Card className="flex flex-col gap-2">
        {p.status !== 'valid' && <p className="rounded-lg bg-slate-200 p-2 text-sm font-bold">{t(`common:status.${p.status}`)} {p.void_reason && `— ${p.void_reason}`}</p>}
        <Row label={t('detail.patroller')}>{patrollerName}</Row>
        <Row label={t('detail.type')}>{t(`patrol:type.${p.patrol_type}`)}</Row>
        {p.entered_by_manager && <p className="rounded-lg bg-teal-50 p-2 text-sm font-bold text-teal-900">✓ {t('patrolBackfill.entered')}</p>}
        <Row label={t('detail.time')}>
          {jstDateTime(p.started_at)} – {jstDateTime(p.ended_at).slice(11) || '—'}（{p.duration_min ?? '—'}{t('detail.min')}）
          {p.status !== 'void' && !p.needs_time_review && !timeEdit && (
            <button type="button" className="ml-2 min-h-9 text-sm font-bold text-brand underline" onClick={() => setTimeEdit(true)}>
              {t('detail.timeEdit')}
            </button>
          )}
        </Row>
        {p.judgement && (
          <div className={`flex items-center justify-between rounded-xl px-3 py-2 font-bold ${JUDGE_STYLE[p.judgement] ?? ''}`}>
            <span>
              {p.total} / {p.max_total}（{t('detail.score25', { score })}）
            </span>
            <span>{t(`common:judgement.${p.judgement}`)}</span>
          </div>
        )}
        <ul className="grid grid-cols-5 gap-1 text-center text-xs">
          {ITEM_KEYS.map((k) => (
            <li key={k} className="rounded-lg bg-slate-100 p-1">
              <span className="block truncate">{t(`patrol:items.${ITEM_NAME[k]}.name`)}</span>
              <b className="text-lg">{p[k] ?? '－'}</b>
              {k === 'score_smile' && p.mask_worn && <span className="block">😷</span>}
            </li>
          ))}
        </ul>
        {(p.customer_none || p.customer_satisfied != null) && (
          <Row label={t('patrol:customer.short')}>
            <CustomerResult r={p} />
            <Original texts={p.original_texts} field="customer_reason" />
          </Row>
        )}
        <Row label={t('detail.staff')}>{p.staff_names.length ? p.staff_names.join('、') : p.staff_on_shift}</Row>
        <Row label={t('patrol:goodPoints.label')}>
          {p.good_points}
          <Original texts={p.original_texts} field="good_points" />
        </Row>
        <Row label={t('patrol:improvements.label')}>
          {p.improvements}
          <Original texts={p.original_texts} field="improvements" />
        </Row>
        {STAFF_ISSUES_ENABLED && <IssueRow patrol={p} />}
        {p.manager_note && <Row label={t('chorei:backfill.note')}>{p.manager_note}</Row>}
        {p.remarks && (
          <Row label={t('patrol:remarks.label')}>
            {p.remarks}
            <Original texts={p.original_texts} field="remarks" />
          </Row>
        )}
        <Attachments list={p.attachments} parentId={p.id} skipped={p.media_skipped} />
        <RecordComments kind="patrol" recordId={p.id} comments={p.comments ?? []} canWrite={p.status === 'valid'} />
      </Card>
      <PatrolEditHistory patrol={p} />
      {p.status === 'valid' &&
        (editing ? (
          <PatrolEdit patrol={p} onDone={() => setEditing(false)} />
        ) : (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            ✏️ {t('choreiEdit.open')}
          </Button>
        ))}

      {p.judgement === 'coaching' && p.status === 'valid' && (
        <Card className="flex flex-col gap-2 ring-2 ring-red-300">
          <h3 className="font-bold"><Dot tone="red" /> {t('detail.followUp')}</h3>
          {p.follow_up_done_at ? (
            <p className="text-sm">
              ✓ {t('detail.followUpDone', { at: jstDateTime(p.follow_up_done_at) })} {p.follow_up_note && `— ${p.follow_up_note}`}
            </p>
          ) : (
            <>
              <TextArea label={t('detail.followUpNote')} value={note} onChange={(e) => setNote(e.target.value)} />
              <Button onClick={() => void ja.run({ follow_up_done_at: new Date().toISOString(), follow_up_note: note.trim() || null }, 'follow_up_note', t('detail.followUpNote'))} disabled={update.isPending}>
                {t('detail.markFollowUp')}
              </Button>
            </>
          )}
        </Card>
      )}

      {(p.needs_time_review || timeEdit) && p.status !== 'void' && (
        <Card className="flex flex-col gap-2 ring-2 ring-amber-300">
          <h3 className="font-bold"><Dot tone="amber" /> {p.needs_time_review ? t('detail.timeReview') : t('detail.timeEdit')}</h3>
          <label className="text-sm font-bold">
            {t('detail.start')}
            <input type="datetime-local" className="min-h-11 w-full rounded-lg border border-slate-300 px-2" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="text-sm font-bold">
            {t('detail.end')}
            <input type="datetime-local" className="min-h-11 w-full rounded-lg border border-slate-300 px-2" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
          <Button
            onClick={() => update.mutate({ started_at: fromLocalInput(start), ended_at: end ? fromLocalInput(end) : null, needs_time_review: false })}
            disabled={update.isPending || !start || (Boolean(end) && end <= start)}
          >
            {t('detail.confirmTime')}
          </Button>
        </Card>
      )}

      {p.status !== 'void' && (
        <Card className="flex flex-col gap-2">
          <h3 className="font-bold">{t('detail.void')}</h3>
          <TextArea label={t('detail.voidReason')} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
          <Button variant="danger" onClick={() => void ja.run({ status: 'void', void_reason: voidReason.trim() }, 'void_reason', t('detail.voidReason'))} disabled={update.isPending || !voidReason.trim()}>
            {t('detail.voidButton')}
          </Button>
        </Card>
      )}
      {(update.error || ja.error) && <ErrorBox message={errorMessage(update.error ?? ja.error)} />}
    </Sheet>
  )
}

export function ChoreiDetail({ record: r, leaderName, onClose }: { record: AdminChorei; leaderName: string; onClose: () => void }) {
  const { t } = useTranslation('manager')
  const stores = useStores()
  const update = useUpdate('chorei_records', r.id, onClose)
  const ja = useJaUpdate(update, r.original_texts)
  const [voidReason, setVoidReason] = useState('')
  const [editing, setEditing] = useState(false)
  const store = storeName(stores.data?.find((s) => s.id === r.store_id), currentLocale())
  const skipped = CHOREI_STEPS.filter((s) => r.steps_done[s] === false)

  return (
    <Sheet title={`${r.business_date} ${t(`common:shift.${r.shift}`)} ${store}`} onClose={onClose}>
      {ja.review}
      <Card className="flex flex-col gap-2">
        {r.status === 'void' && <p className="rounded-lg bg-slate-200 p-2 text-sm font-bold">{t('common:status.void')} — {r.void_reason}</p>}
        {r.entered_by_manager && <p className="rounded-lg bg-teal-50 p-2 text-sm font-bold text-teal-900">✓ {t('misses.enteredByManager')}</p>}
        <Row label={t('detail.leader')}>{leaderName}</Row>
        <Row label={t('detail.submitted')}>{jstDateTime(r.submitted_at)}</Row>
        <Row label={t('chorei:participants.label')}>{r.participants_extra.join('、') || '—'}</Row>
        <Row label={t('chorei:previous.stock')}>
          {r.stock_none ? t('chorei:stock.none') : r.stock_text}
          <Original texts={r.original_texts} field="stock_text" />
        </Row>
        <Row label={t('chorei:previous.target')}>{r.target_bowls ?? '—'}</Row>
        <Row label={t('chorei:previous.caution')}>
          {r.caution_text || '—'}
          <Original texts={r.original_texts} field="caution_text" />
        </Row>
        <Row label={t('detail.skipped')}>{skipped.length ? `${skipped.map((s) => t(`chorei:steps.${s}`)).join('、')}（${r.skip_reason ?? ''}）` : '—'}</Row>
        {r.manager_note && <Row label={t('chorei:backfill.note')}>{r.manager_note}</Row>}
        {r.notes.length > 0 && <NoteRows notes={r.notes} />}
        <Attachments list={r.attachments} parentId={r.id} skipped={r.media_skipped} />
        <RecordComments kind="chorei" recordId={r.id} comments={r.comments ?? []} canWrite={r.status === 'valid'} />
      </Card>
      <ChoreiEditHistory record={r} />
      {r.status === 'valid' &&
        (editing ? (
          <ChoreiEdit record={r} onDone={() => setEditing(false)} />
        ) : (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            ✏️ {t('choreiEdit.open')}
          </Button>
        ))}
      {r.status === 'valid' && (
        <Card className="flex flex-col gap-2">
          <h3 className="font-bold">{t('detail.void')}</h3>
          <TextArea label={t('detail.voidReason')} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
          <Button variant="danger" onClick={() => void ja.run({ status: 'void', void_reason: voidReason.trim() }, 'void_reason', t('detail.voidReason'))} disabled={update.isPending || !voidReason.trim()}>
            {t('detail.voidButton')}
          </Button>
        </Card>
      )}
      {(update.error || ja.error) && <ErrorBox message={errorMessage(update.error ?? ja.error)} />}
    </Sheet>
  )
}
