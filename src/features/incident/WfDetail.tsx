import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../app/auth'
import { Sheet } from '../../components/Sheet'
import { Button, Card, Checkbox, ErrorBox, Segmented, TextArea, TextInput } from '../../components/ui'
import { INCIDENT_ICON } from '../../domain/incident'
import {
  actionsFor,
  durations,
  FLOWS,
  NEEDS_PREVENTION,
  nextStep,
  pathOf,
  stepActions,
  fmtMinutes,
  isOverdue,
  PRIORITIES,
  PRIORITY_STYLE,
  WF_ACTIONS,
  WF_STYLE,
  type WfState,
  type Priority,
  type WfAction,
} from '../../domain/incidentWorkflow'
import { currentLocale } from '../../i18n'
import { cx } from '../../lib/cx'
import { errorMessage, storeName } from '../../lib/format'
import type { PreparedMedia } from '../../lib/media'
import { unwrap, useStores } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { AttachmentPicker } from '../attachments/AttachmentPicker'
import { useUploadQueue } from '../attachments/uploadQueue'
import { AttachmentList } from '../manager/AttachmentList'
import { fromLocalInput, toLocalInput } from '../manager/data'
import { TranslationCancelled, useTranslationGate } from '../translate/useTranslationGate'
import { formatWhen } from './data'
import { incidentAct, incidentNo, useIncidentCosts, useIncidentEvents, type WfIncident } from './wfData'

export function WfChips({ r }: { r: WfIncident }) {
  const { t } = useTranslation()
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className={cx('rounded-full px-2 py-0.5 text-xs font-bold', WF_STYLE[r.wf_state])}>{t(`wf.state.${r.wf_state}`)}</span>
      {r.priority !== 'normal' && <span className={cx('rounded-full px-2 py-0.5 text-xs font-bold', PRIORITY_STYLE[r.priority])}>{t(`wf.priority.${r.priority}`)}</span>}
      {isOverdue(r) && <span className="rounded-full bg-red-700 px-2 py-0.5 text-xs font-bold text-white">{t('wf.overdue')}</span>}
    </span>
  )
}

/** the steps of the kind (設備: 報告済み → 確認中 → 対応中 → 修理完了・確認待ち → 完了; 保留・再対応・取消 shown as a note) */
function Progress({ r }: { r: WfIncident }) {
  const { t } = useTranslation()
  const path = pathOf(r.kind)
  const at = r.wf_state === 'on_hold' || r.wf_state === 'reopened' ? 2 : r.wf_state === 'cancelled' ? -1 : path.indexOf(r.wf_state)
  const cols = { gridTemplateColumns: `repeat(${path.length}, minmax(0, 1fr))` }
  return (
    <div className="flex flex-col gap-1">
      <ol className="grid gap-1" style={cols}>
        {path.map((s, i) => (
          <li key={s} className={cx('h-1.5 rounded-full', i <= at ? 'bg-brand' : 'bg-slate-200')} />
        ))}
      </ol>
      <ol className="grid gap-1 text-center text-[10px] leading-tight text-muted" style={cols}>
        {path.map((s) => (
          <li key={s}>{t(`wf.state.${s}`)}</li>
        ))}
      </ol>
      {(r.wf_state === 'on_hold' || r.wf_state === 'reopened' || r.wf_state === 'cancelled') && (
        <p className={cx('rounded-lg px-2 py-1 text-sm font-bold', WF_STYLE[r.wf_state])}>{t(`wf.state.${r.wf_state}`)}</p>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5em_1fr] gap-2">
      <span className="text-muted">{label}</span>
      <span className="min-w-0">{children}</span>
    </div>
  )
}

/** The details sheet of one workflow incident: staff and managers, the buttons follow the role. */
export function WfDetail({ r, onClose }: { r: WfIncident; onClose: () => void }) {
  const { t } = useTranslation()
  const tm = useTranslation('manager').t
  const { isManager } = useAuth()
  const stores = useStores()
  const queryClient = useQueryClient()
  const events = useIncidentEvents(r.id)
  const costs = useIncidentCosts(r.id, isManager)
  const gate = useTranslationGate()
  const uploads = useUploadQueue()
  const [comment, setComment] = useState('')
  const [media, setMedia] = useState<PreparedMedia[]>([])
  const [pending, setPending] = useState<WfAction | null>(null)
  const [reason, setReason] = useState('')
  const [works, setWorks] = useState(false)
  const [cause, setCause] = useState('')
  const [resolution, setResolution] = useState('')
  const [cost, setCost] = useState('')
  const [vendor, setVendor] = useState('')
  const [conflict, setConflict] = useState(false)
  const [step, setStep] = useState<'advance' | 'back' | 'cancel' | null>(null)
  const [backTo, setBackTo] = useState<WfState | ''>('')
  const [answer, setAnswer] = useState(r.resolution ?? '')
  const [prevention, setPrevention] = useState(r.prevention ?? '')
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['incidents'] })
    void queryClient.invalidateQueries({ queryKey: ['incident_events', r.id] })
    void queryClient.invalidateQueries({ queryKey: ['incident_costs', r.id] })
  }
  const onError = (e: Error) => {
    if (/conflict/.test(errorMessage(e))) {
      setConflict(true)
      refresh()
    }
  }
  const sendComment = useMutation({
    mutationFn: async () => {
      if (comment.trim()) {
        const g = await gate.prepare([{ key: 'body', label: t('wf.comment'), text: comment.trim() }])
        await incidentAct(r.id, 'comment', null, g.values.body ?? null, { original: g.originals?.body ?? null, sourceLang: g.sourceLang })
      }
      if (media.length) await uploads.enqueue('incident', r.id, media)
    },
    onSuccess: () => {
      setComment('')
      setMedia([])
      refresh()
    },
  })
  const doAction = useMutation({
    mutationFn: async (a: WfAction) => {
      const needs = WF_ACTIONS[a].reason || a === 'repaired'
      const g = needs && reason.trim() ? await gate.prepare([{ key: 'body', label: t(`wf.action.${a}`), text: reason.trim() }]) : null
      const data: Record<string, unknown> = {}
      if (a === 'confirm_ok') {
        const gc = await gate.prepare([
          { key: 'cause', label: tm('wf.cause'), text: cause.trim() },
          { key: 'resolution', label: tm('wf.resolution'), text: resolution.trim() || null },
        ])
        Object.assign(data, { works, cause: gc.values.cause, resolution: gc.values.resolution })
      }
      await incidentAct(r.id, a, r.version, g ? (g.values.body ?? null) : reason.trim() || null, { original: g?.originals?.body ?? null, sourceLang: g?.sourceLang ?? null, data })
      if (a === 'confirm_ok' && Number(cost) > 0) {
        unwrap(await supabase.from('incident_costs').insert({ incident_id: r.id, amount_yen: Number(cost), vendor: vendor.trim() || null }))
      }
    },
    onSuccess: () => {
      setPending(null)
      setReason('')
      setConflict(false)
      refresh()
    },
    onError,
  })
  const doStep = useMutation({
    mutationFn: async (a: 'advance' | 'back' | 'cancel') => {
      const next = nextStep(r.kind, r.wf_state)
      const g = await gate.prepare([
        { key: 'body', label: t('wf.note'), text: reason.trim() || null },
        { key: 'resolution', label: t('wf.f.answer'), text: a === 'advance' && next === 'answered' ? answer.trim() || null : null },
        { key: 'prevention', label: t('wf.f.prevention'), text: a === 'advance' && next === 'done' && NEEDS_PREVENTION.includes(r.kind) ? prevention.trim() || null : null },
        { key: 'cause', label: t('wf.f.cause'), text: a === 'advance' && next === 'done' ? cause.trim() || null : null },
      ])
      const data: Record<string, unknown> = {}
      if (g.values.resolution) data.resolution = g.values.resolution
      if (g.values.prevention) data.prevention = g.values.prevention
      if (g.values.cause) data.cause = g.values.cause
      if (a === 'back') data.to = backTo
      await incidentAct(r.id, a, r.version, g.values.body ?? null, { original: g.originals?.body ?? null, sourceLang: g.sourceLang, data })
    },
    onSuccess: () => {
      setStep(null)
      setReason('')
      setConflict(false)
      refresh()
    },
    onError,
  })
  const d = durations(r, events.data ?? [])
  const isEq = r.kind === 'equipment'
  const next = nextStep(r.kind, r.wf_state)
  const steps = isEq ? [] : stepActions(r.kind, r.wf_state, isManager)
  const earlier = (FLOWS[r.kind] ?? []).slice(0, Math.max(0, (FLOWS[r.kind] ?? []).indexOf(r.wf_state)))
  const store = storeName(stores.data?.find((s) => s.id === r.store_id), currentLocale())
  const actions = isEq ? actionsFor(r.wf_state, isManager) : []
  const files = r.attachments.filter((a) => a.status !== 'failed')
  return (
    <Sheet title={`${incidentNo(r.incident_no, r.kind)} ${isEq ? (r.equipment_name ?? t('incident.kinds.equipment')) : t(`incident.kinds.${r.kind}`)}`} onClose={onClose}>
      {gate.review}
      <Card className="flex flex-col gap-2 text-sm">
        <div className="flex items-start justify-between gap-2">
          <span className="text-base font-bold">
            {INCIDENT_ICON[r.kind]} {store}
          </span>
          <WfChips r={r} />
        </div>
        <Progress r={r} />
        <p className="whitespace-pre-wrap text-base">{r.description}</p>
        {r.original_texts?.description && <p className="text-xs text-muted">{t('comment.original')}: {r.original_texts.description}</p>}
        <Row label={t('wf.f.assignee')}>{r.assignee_name ?? <span className="text-amber-800">{t('wf.unassigned')}</span>}</Row>
        <Row label={t('wf.f.due')}>
          <span className={cx(isOverdue(r) && 'font-bold text-red-700')}>{r.due_at ? formatWhen(r.due_at) : '—'}</span>
        </Row>
        <Row label={isEq ? t('wf.f.occurred') : t('incident.when')}>
          {formatWhen(r.occurred_at)}
          {!r.occurred_known && <span className="ml-1 text-xs text-amber-800">（{t('wf.estimated')}）</span>}
        </Row>
        {isEq && <Row label={t('wf.f.discovered')}>{r.discovered_at ? formatWhen(r.discovered_at) : '—'}</Row>}
        <Row label={t('wf.f.reported')}>
          {formatWhen(r.created_at)} ・ {r.reporter_name}
        </Row>
        {r.repaired_at && <Row label={t('wf.f.repaired')}>{formatWhen(r.repaired_at)}</Row>}
        {r.closed_at && (
          <Row label={t('wf.f.closed')}>
            {formatWhen(r.closed_at)} ・ {r.closed_by_name}
          </Row>
        )}
        {(r.customer_name || r.customer_phone) && (
          <Row label={t('wf.f.party')}>{[r.customer_name, r.customer_phone].filter(Boolean).join(' ')}</Row>
        )}
        {r.injured_who && (
          <Row label={t('incident.injured.title')}>
            {r.injured_who.map((w) => (w === 'staff' && r.injured_staff ? `${t('incident.injured.staff')}（${r.injured_staff}）` : t(`incident.injured.${w}`))).join('・')}
          </Row>
        )}
        {r.action_taken && <Row label={t('incident.action')}>{r.action_taken}</Row>}
        {r.prevention && <Row label={t('wf.f.prevention')}>{r.prevention}</Row>}
        {r.cause && <Row label={t('wf.f.cause')}>{r.cause}</Row>}
        {r.resolution && <Row label={t('wf.f.resolution')}>{r.resolution}</Row>}
        {r.cancel_reason && <Row label={t('wf.f.cancel')}>{r.cancel_reason}</Row>}
        {isManager ? <AttachmentList list={files} parentId={r.id} /> : files.length > 0 && <p>📷 {t('lost.photos', { n: files.length })}</p>}
      </Card>

      <Card className="flex flex-col gap-1 text-sm">
        <h3 className="font-bold">⏱ {t('wf.times')}</h3>
        {(
          [
            ['report', d.report],
            ['firstResponse', d.firstResponse],
            ['repair', d.repair],
            ['complete', d.complete],
            ['hold', d.hold],
            ['downtime', d.downtime],
          ] as const
        )
          .filter(([k]) => isEq || k === 'firstResponse' || k === 'complete')
          .map(([k, v]) => (
          <details key={k}>
            <summary className="flex cursor-pointer justify-between gap-2">
              <span>{t(`wf.d.${k}`)}</span>
              <b className="tabular-nums">{fmtMinutes(v)}</b>
            </summary>
            <p className="text-xs text-muted">{t(`wf.dHow.${k}`)}</p>
            {k === 'hold' && d.holdSpans.map((s, i) => <p key={i} className="text-xs">・{formatWhen(s.from)} → {s.to ? formatWhen(s.to) : t('wf.now')}</p>)}
            {k === 'downtime' && d.downSpans.map((s, i) => <p key={i} className="text-xs">・{formatWhen(s.from)} → {s.to ? formatWhen(s.to) : t('wf.now')}</p>)}
          </details>
        ))}
        {d.estimated && <p className="text-xs text-amber-800">{t('wf.estimatedNote')}</p>}
      </Card>

      {conflict && <ErrorBox message={t('wf.conflict')} />}

      {steps.length > 0 && (
        <Card className="flex flex-col gap-2">
          <h3 className="font-bold">{isManager ? tm('wf.actionsTitle') : t('wf.staffActions')}</h3>
          <div className="grid grid-cols-1 gap-2">
            {steps.map((a) => (
              <Button key={a} variant={a === 'advance' ? 'primary' : 'secondary'} onClick={() => setStep(step === a ? null : a)}>
                {a === 'advance' && next ? t('wf.nextStep', { step: t(`wf.state.${next}`) }) : t(`wf.stepAction.${a}`)}
              </Button>
            ))}
          </div>
          {step && (
            <div className="flex flex-col gap-2 rounded-xl border border-brand p-3">
              {step === 'advance' && next === 'answered' && (
                <TextArea label={`${t('wf.f.answer')} *`} rows={3} value={answer} maxLength={2000} onChange={(e) => setAnswer(e.target.value)} />
              )}
              {step === 'advance' && next === 'done' && NEEDS_PREVENTION.includes(r.kind) && (
                <TextArea label={`${t('wf.f.prevention')} *`} rows={2} value={prevention} maxLength={2000} onChange={(e) => setPrevention(e.target.value)} />
              )}
              {step === 'advance' && next === 'done' && <TextArea label={t('wf.f.cause')} rows={2} value={cause} maxLength={2000} onChange={(e) => setCause(e.target.value)} />}
              {step === 'back' && (
                <label className="flex flex-col gap-1 text-[15px] font-bold">
                  {t('wf.backTo')}
                  <select className="min-h-12 rounded-xl border border-slate-400 bg-white px-2 font-normal" value={backTo} onChange={(e) => setBackTo(e.target.value as WfState)}>
                    <option value="">—</option>
                    {(r.wf_state === 'cancelled' ? (FLOWS[r.kind] ?? []).filter((s) => s !== 'done') : earlier).map((s) => (
                      <option key={s} value={s}>
                        {t(`wf.state.${s}`)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <TextArea
                label={step === 'advance' ? t('wf.note') : `${t('wf.reason')} *`}
                hint={step === 'advance' && next ? t(`wf.stepHint.${next}`, { defaultValue: '' }) || undefined : undefined}
                rows={2}
                value={reason}
                maxLength={2000}
                onChange={(e) => setReason(e.target.value)}
              />
              {doStep.error && !(doStep.error instanceof TranslationCancelled) && !conflict && <ErrorBox message={errorMessage(doStep.error)} />}
              <Button
                onClick={() => doStep.mutate(step)}
                disabled={
                  doStep.isPending ||
                  (step !== 'advance' && !reason.trim()) ||
                  (step === 'back' && !backTo) ||
                  (step === 'advance' && next === 'answered' && !answer.trim()) ||
                  (step === 'advance' && next === 'done' && NEEDS_PREVENTION.includes(r.kind) && !prevention.trim())
                }
              >
                {doStep.isPending ? t('action.loading') : t('wf.do')}
              </Button>
            </div>
          )}
        </Card>
      )}

      {actions.length > 0 && (
        <Card className="flex flex-col gap-2">
          <h3 className="font-bold">{isManager ? tm('wf.actionsTitle') : t('wf.staffActions')}</h3>
          <div className="grid grid-cols-2 gap-2">
            {actions.map((a) => (
              <Button key={a} variant={a === 'confirm_ok' || a === 'repaired' || a === 'acknowledge' ? 'primary' : 'secondary'} onClick={() => setPending(pending === a ? null : a)}>
                {t(`wf.action.${a}`)}
              </Button>
            ))}
          </div>
          {pending && (
            <div className="flex flex-col gap-2 rounded-xl border border-brand p-3">
              <p className="font-bold">
                {t(`wf.action.${pending}`)}: {t(`wf.state.${r.wf_state}`)} → {t(`wf.state.${WF_ACTIONS[pending].to}`)}
              </p>
              {pending === 'confirm_ok' ? (
                <>
                  <Checkbox checked={works} onChange={setWorks}>
                    ✅ {tm('wf.works')}
                  </Checkbox>
                  <TextArea label={`${tm('wf.cause')} *`} rows={2} value={cause} maxLength={2000} onChange={(e) => setCause(e.target.value)} />
                  <TextArea label={tm('wf.resolution')} rows={2} value={resolution} maxLength={2000} onChange={(e) => setResolution(e.target.value)} />
                  <div className="grid grid-cols-2 gap-2 [&>div]:justify-between">
                    <TextInput label={tm('wf.cost')} inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value.replace(/\D/g, ''))} />
                    <TextInput label={tm('wf.vendor')} value={vendor} maxLength={100} onChange={(e) => setVendor(e.target.value)} />
                  </div>
                </>
              ) : (
                <TextArea
                  label={WF_ACTIONS[pending].reason ? `${t('wf.reason')} *` : t('wf.note')}
                  hint={pending === 'hold' ? t('wf.holdHint') : pending === 'repaired' ? t('wf.repairedHint') : undefined}
                  rows={2}
                  value={reason}
                  maxLength={2000}
                  onChange={(e) => setReason(e.target.value)}
                />
              )}
              {doAction.error && !(doAction.error instanceof TranslationCancelled) && !conflict && <ErrorBox message={errorMessage(doAction.error)} />}
              <Button
                onClick={() => doAction.mutate(pending)}
                disabled={doAction.isPending || (WF_ACTIONS[pending].reason && !reason.trim()) || (pending === 'confirm_ok' && (!works || !cause.trim()))}
              >
                {doAction.isPending ? t('action.loading') : t('wf.do')}
              </Button>
            </div>
          )}
        </Card>
      )}

      {isManager && r.wf_state !== 'done' && r.wf_state !== 'cancelled' && <AssignPanel r={r} onDone={refresh} onConflict={onError} />}
      {isManager && (costs.data ?? []).length > 0 && (
        <Card className="text-sm">
          <h3 className="font-bold">💴 {tm('wf.cost')}</h3>
          {costs.data!.map((c) => (
            <p key={c.id}>
              ¥{c.amount_yen.toLocaleString()} {c.vendor && `・${c.vendor}`}
            </p>
          ))}
        </Card>
      )}

      <Card className="flex flex-col gap-2">
        <h3 className="font-bold">💬 {t('wf.addTitle')}</h3>
        <TextArea label={t('wf.comment')} hint={t('wf.commentHint')} rows={2} value={comment} maxLength={2000} onChange={(e) => setComment(e.target.value)} />
        <AttachmentPicker value={media} onChange={setMedia} camera taken={{ images: files.filter((f) => f.kind === 'image').length, videos: files.filter((f) => f.kind === 'video').length }} />
        {sendComment.error && !(sendComment.error instanceof TranslationCancelled) && <ErrorBox message={errorMessage(sendComment.error)} />}
        <Button variant="secondary" onClick={() => sendComment.mutate()} disabled={sendComment.isPending || (!comment.trim() && !media.length)}>
          {sendComment.isPending ? t('action.loading') : t('wf.send')}
        </Button>
      </Card>

      <Card className="flex flex-col gap-2 text-sm">
        <h3 className="font-bold">🕘 {t('wf.timeline')}</h3>
        <ol className="flex flex-col gap-2 border-l-2 border-line pl-3">
          {[...(events.data ?? [])].reverse().map((e) => (
            <li key={e.id} className="flex flex-col">
              <span className="text-xs text-muted">
                {formatWhen(e.at)} ・ {e.actor_name}
              </span>
              <span className="font-bold">
                {e.kind === 'state' || e.kind === 'created'
                  ? `${e.action === 'advance' || e.action === 'back' ? t(`wf.stepAction.${e.action}`) : t(`wf.event.${e.action ?? 'report'}`)}${e.to_state ? ` → ${t(`wf.state.${e.to_state}`)}` : ''}`
                  : e.kind === 'assign'
                    ? t('wf.event.assign', { name: (e.data.assignee_name as string) ?? '—', priority: t(`wf.priority.${(e.data.priority as Priority) ?? 'normal'}`) })
                    : t(`wf.event.${e.kind}`)}
              </span>
              {e.body && <span className="whitespace-pre-wrap">{e.body}</span>}
              {e.original_body && isManager && <span className="text-xs text-muted">{t('comment.original')}: {e.original_body}</span>}
            </li>
          ))}
        </ol>
      </Card>
    </Sheet>
  )
}

/** 管理者: 担当者・優先度・対応期限 (the first assignment also takes the report). */
function AssignPanel({ r, onDone, onConflict }: { r: WfIncident; onDone: () => void; onConflict: (e: Error) => void }) {
  const { t } = useTranslation()
  const tm = useTranslation('manager').t
  const people = useQuery({
    queryKey: ['admin', 'active-people'],
    staleTime: 5 * 60_000,
    queryFn: async () =>
      unwrap<{ id: string; full_name: string | null; display_name: string | null; role: string }[]>(
        await supabase.from('profiles').select('id, full_name, display_name, role').eq('status', 'active').order('role', { ascending: false }),
      ),
  })
  const [assignee, setAssignee] = useState(r.assignee_id ?? '')
  const [priority, setPriority] = useState<Priority>(r.priority)
  const [due, setDue] = useState(r.due_at ? toLocalInput(r.due_at) : '')
  const save = useMutation({
    mutationFn: () =>
      incidentAct(r.id, 'assign', r.version, null, {
        data: { ...(assignee ? { assignee_id: assignee } : {}), priority, ...(due ? { due_at: fromLocalInput(due) } : {}) },
      }),
    onSuccess: onDone,
    onError: onConflict,
  })
  return (
    <Card className="flex flex-col gap-2">
      <h3 className="font-bold">👤 {tm('wf.assignTitle')}</h3>
      <label className="flex flex-col gap-1 text-[15px] font-bold">
        {t('wf.f.assignee')}
        <select className="min-h-12 rounded-xl border border-slate-400 bg-white px-2 font-normal" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">—</option>
          {(people.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name || p.display_name}
              {p.role !== 'staff' ? '（管理者）' : ''}
            </option>
          ))}
        </select>
      </label>
      <Segmented label={t('wf.f.priority')} value={priority} onChange={setPriority} options={PRIORITIES.map((p) => ({ value: p, label: t(`wf.priority.${p}`) }))} />
      <TextInput label={t('wf.f.due')} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
      <p className="text-xs text-muted">{tm('wf.assignHint')}</p>
      {save.error && !/conflict/.test(errorMessage(save.error)) && <ErrorBox message={errorMessage(save.error)} />}
      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? t('action.loading') : tm('wf.assignSave')}
      </Button>
    </Card>
  )
}
