import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, ErrorBox, Segmented, TextArea, TextInput } from '../../components/ui'
import { formatMin, type Assignment } from '../../domain/schedule'
import {
  CALL_WITHIN_MIN,
  CHANGE_KINDS,
  KIND_ICON,
  LATE_OPTIONS,
  leaveOptions,
  noticeMinutes,
  REASON_ICON,
  reasonsFor,
  type ChangeKind,
  type ChangeReason,
} from '../../domain/shiftChange'
import { cx } from '../../lib/cx'
import { errorMessage } from '../../lib/format'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { fromLocalInput, toLocalInput } from '../manager/data'
import { TranslationCancelled, useTranslationGate } from '../translate/useTranslationGate'

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx('min-h-11 rounded-xl border-[1.5px] px-3 font-bold', on ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink')}
    >
      {children}
    </button>
  )
}

/**
 * 休む / 遅れる / 早退する for one shift. Staff report their own shift; a manager (`rosterName`) records a
 * phone call for someone, with the time of the call.
 */
export function ChangeForm({ a, rosterName, onDone }: { a: Assignment; rosterName?: string; onDone: () => void }) {
  const { t } = useTranslation('shift')
  const queryClient = useQueryClient()
  const gate = useTranslationGate()
  const manager = Boolean(rosterName)
  const [kind, setKind] = useState<ChangeKind>('absence')
  const [reason, setReason] = useState<ChangeReason | null>(null)
  const [lateMin, setLateMin] = useState<number | null>(null)
  const [leaveMin, setLeaveMin] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [recruit, setRecruit] = useState(true)
  const [swapOk, setSwapOk] = useState(false)
  const [reportedAt, setReportedAt] = useState(() => toLocalInput(new Date().toISOString()))
  const notice = noticeMinutes(a, manager ? new Date(fromLocalInput(reportedAt)) : new Date())
  const reasons = reasonsFor(kind, manager)
  const needNote = reason === 'other' && !note.trim()
  const ready = reason !== null && reasons.includes(reason) && !needNote && (kind !== 'late' || lateMin) && (kind !== 'early_leave' || leaveMin)

  const send = useMutation({
    mutationFn: async () => {
      const g = await gate.prepare([{ key: 'note', label: t('change.note'), text: note.trim() || null }])
      unwrap(
        await supabase.rpc('report_shift_change', {
          p_kind: kind,
          p_date: a.business_date,
          p_shift: a.shift,
          p_reason: reason!,
          p_note: g.values.note,
          p_note_original: g.originals?.note ?? null,
          p_source_lang: g.sourceLang,
          p_late_min: kind === 'late' ? lateMin : null,
          p_leave_min: kind === 'early_leave' ? leaveMin : null,
          p_recruit: kind !== 'late' && recruit,
          p_swap_ok: kind === 'absence' && recruit && swapOk,
          ...(manager ? { p_roster_name: rosterName, p_reported_at: fromLocalInput(reportedAt) } : {}),
        }),
      )
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['shift_changes'] })
      void queryClient.invalidateQueries({ queryKey: ['shift_assignments'] })
      void queryClient.invalidateQueries({ queryKey: ['attendance'] })
      onDone()
    },
  })

  return (
    <div className="flex flex-col gap-4">
      <Segmented
        label={t('change.kindLabel')}
        value={kind}
        onChange={(k) => {
          setKind(k)
          if (reason && !reasonsFor(k, manager).includes(reason)) setReason(null)
        }}
        options={CHANGE_KINDS.map((k) => ({ value: k, label: `${KIND_ICON[k]} ${t(`change.kind.${k}`)}` }))}
      />

      {kind === 'late' && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[15px] font-bold">{t('change.lateLabel')}</legend>
          <div className="flex flex-wrap gap-2">
            {LATE_OPTIONS.filter((m) => m < a.end_min - a.start_min).map((m) => (
              <Chip key={m} on={lateMin === m} onClick={() => setLateMin(m)}>
                {t('change.minutes', { n: m })}
              </Chip>
            ))}
          </div>
        </fieldset>
      )}
      {kind === 'early_leave' && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[15px] font-bold">{t('change.leaveLabel')}</legend>
          <div className="flex flex-wrap gap-2">
            {leaveOptions(a).map((m) => (
              <Chip key={m} on={leaveMin === m} onClick={() => setLeaveMin(m)}>
                {formatMin(m)}
              </Chip>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-[15px] font-bold">{t('change.reasonLabel')}</legend>
        <div className="grid grid-cols-2 gap-2">
          {reasons.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={reason === r}
              onClick={() => setReason(r)}
              className={cx(
                'flex min-h-12 items-center gap-2 rounded-xl border-[1.5px] px-3 text-left font-bold',
                reason === r ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink',
              )}
            >
              <span aria-hidden>{REASON_ICON[r]}</span>
              {t(`change.reason.${r}`)}
            </button>
          ))}
        </div>
        {reason === 'paid_leave' && <p className="text-sm text-muted">{t('change.paidHint')}</p>}
      </fieldset>

      <TextArea
        label={reason === 'other' ? `${t('change.note')} *` : t('change.note')}
        hint={t('change.noteHint')}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        error={needNote ? t('common:error.required') : null}
      />

      {kind !== 'late' && (
        <div className="rounded-xl bg-surface p-2">
          <Checkbox checked={recruit} onChange={setRecruit}>
            🙋 {t('change.recruit')}
          </Checkbox>
          {kind === 'absence' && recruit && (
            <Checkbox checked={swapOk} onChange={setSwapOk}>
              🔁 {t('change.swapOk')}
            </Checkbox>
          )}
          <p className="px-1 text-sm text-muted">{recruit ? t('change.recruitHint') : t('change.noRecruitHint')}</p>
        </div>
      )}

      {manager && <TextInput type="datetime-local" label={t('change.reportedAt')} value={reportedAt} onChange={(e) => setReportedAt(e.target.value)} />}

      {notice < CALL_WITHIN_MIN && (
        <p className="rounded-xl border-2 border-red-300 bg-red-50 p-3 font-bold text-red-900">
          📞 {notice < 0 ? t('change.afterStart') : t('change.callNow')}
        </p>
      )}
      <p className="text-sm text-muted">{t('change.scoreHint')}</p>

      {send.error && !(send.error instanceof TranslationCancelled) && <ErrorBox message={errorMessage(send.error)} />}
      <Button onClick={() => send.mutate()} disabled={!ready || send.isPending}>
        {send.isPending ? t('common:action.loading') : t('change.send')}
      </Button>
      {gate.review}
    </div>
  )
}
