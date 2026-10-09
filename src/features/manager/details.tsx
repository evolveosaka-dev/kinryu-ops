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
import type { AttachmentSummary } from '../../lib/types'
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
      onDone()
    },
  })
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 text-sm">
      <span className="font-bold text-slate-500">{label}</span>
      <span className="whitespace-pre-wrap">{children}</span>
    </div>
  )
}

function Original({ texts, field }: { texts: Record<string, string> | null; field: string }) {
  const { t } = useTranslation('manager')
  const original = texts?.[field]
  return original ? <p className="mt-1 text-xs text-slate-500">{t('detail.original')}: {original}</p> : null
}

function Attachments({ list }: { list: AttachmentSummary[] }) {
  const { t } = useTranslation('manager')
  const ok = list.filter((a) => a.status === 'uploaded')
  if (!ok.length) return <Row label={t('detail.attachments')}>—</Row>
  return (
    <Row label={t('detail.attachments')}>
      <span className="flex flex-wrap gap-2">
        {ok.map((a, i) => (
          <a key={a.id} href={a.drive_url ?? '#'} target="_blank" rel="noreferrer" className="font-bold text-brand underline">
            {a.kind === 'video' ? '🎥' : '📷'} {i + 1}
          </a>
        ))}
      </span>
    </Row>
  )
}

export function PatrolDetail({ patrol: p, patrollerName, onClose }: { patrol: AdminPatrol; patrollerName: string; onClose: () => void }) {
  const { t } = useTranslation('manager')
  const stores = useStores()
  const update = useUpdate('patrol_checks', p.id, onClose)
  const [note, setNote] = useState('')
  const [start, setStart] = useState(toLocalInput(p.started_at))
  const [end, setEnd] = useState(toLocalInput(p.ended_at))
  const [voidReason, setVoidReason] = useState('')
  const store = storeName(stores.data?.find((s) => s.id === p.store_id), currentLocale())
  const score = p.total !== null && p.max_total ? Math.round(normalizedTo25(p.total, p.max_total) * 10) / 10 : null

  return (
    <Sheet title={`${p.business_date} ${t(`common:shift.${p.shift}`)} ${store}`} onClose={onClose}>
      <Card className="flex flex-col gap-2">
        {p.status !== 'valid' && <p className="rounded-lg bg-slate-200 p-2 text-sm font-bold">{t(`common:status.${p.status}`)} {p.void_reason && `— ${p.void_reason}`}</p>}
        <Row label={t('detail.patroller')}>{patrollerName}</Row>
        <Row label={t('detail.type')}>{t(`patrol:type.${p.patrol_type}`)}</Row>
        <Row label={t('detail.time')}>
          {jstDateTime(p.started_at)} – {jstDateTime(p.ended_at).slice(11) || '—'}（{p.duration_min ?? '—'}{t('detail.min')}）
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
        <Row label={t('detail.staff')}>{p.staff_names.length ? p.staff_names.join('、') : p.staff_on_shift}</Row>
        <Row label={t('patrol:goodPoints.label')}>
          {p.good_points}
          <Original texts={p.original_texts} field="good_points" />
        </Row>
        <Row label={t('patrol:improvements.label')}>
          {p.improvements}
          <Original texts={p.original_texts} field="improvements" />
        </Row>
        {p.remarks && (
          <Row label={t('patrol:remarks.label')}>
            {p.remarks}
            <Original texts={p.original_texts} field="remarks" />
          </Row>
        )}
        <Attachments list={p.attachments} />
      </Card>

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
              <Button onClick={() => update.mutate({ follow_up_done_at: new Date().toISOString(), follow_up_note: note.trim() || null })} disabled={update.isPending}>
                {t('detail.markFollowUp')}
              </Button>
            </>
          )}
        </Card>
      )}

      {p.needs_time_review && p.status !== 'void' && (
        <Card className="flex flex-col gap-2 ring-2 ring-amber-300">
          <h3 className="font-bold"><Dot tone="amber" /> {t('detail.timeReview')}</h3>
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
          <Button variant="danger" onClick={() => update.mutate({ status: 'void', void_reason: voidReason.trim() })} disabled={update.isPending || !voidReason.trim()}>
            {t('detail.voidButton')}
          </Button>
        </Card>
      )}
      {update.error && <ErrorBox message={errorMessage(update.error)} />}
    </Sheet>
  )
}

export function ChoreiDetail({ record: r, leaderName, onClose }: { record: AdminChorei; leaderName: string; onClose: () => void }) {
  const { t } = useTranslation('manager')
  const stores = useStores()
  const update = useUpdate('chorei_records', r.id, onClose)
  const [voidReason, setVoidReason] = useState('')
  const store = storeName(stores.data?.find((s) => s.id === r.store_id), currentLocale())
  const skipped = CHOREI_STEPS.filter((s) => r.steps_done[s] === false)

  return (
    <Sheet title={`${r.business_date} ${t(`common:shift.${r.shift}`)} ${store}`} onClose={onClose}>
      <Card className="flex flex-col gap-2">
        {r.status === 'void' && <p className="rounded-lg bg-slate-200 p-2 text-sm font-bold">{t('common:status.void')} — {r.void_reason}</p>}
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
        {r.notes.length > 0 && <Row label={t('chorei:previous.notes')}>{r.notes.map((n) => n.body).join('\n')}</Row>}
        <Attachments list={r.attachments} />
      </Card>
      {r.status === 'valid' && (
        <Card className="flex flex-col gap-2">
          <h3 className="font-bold">{t('detail.void')}</h3>
          <TextArea label={t('detail.voidReason')} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
          <Button variant="danger" onClick={() => update.mutate({ status: 'void', void_reason: voidReason.trim() })} disabled={update.isPending || !voidReason.trim()}>
            {t('detail.voidButton')}
          </Button>
        </Card>
      )}
      {update.error && <ErrorBox message={errorMessage(update.error)} />}
    </Sheet>
  )
}
