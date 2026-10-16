import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../app/auth'
import { Sheet } from '../../components/Sheet'
import { Button, Card, ErrorBox, Spinner, TextArea } from '../../components/ui'
import { keptDays, LOST_OWNER_ICON, pastKeep, LOST_STATUS_ICON, lostStage, matchesLostFilter, type LostFilter } from '../../domain/lostItem'
import { currentLocale } from '../../i18n'
import { cx } from '../../lib/cx'
import { errorMessage, storeName } from '../../lib/format'
import { unwrap, useStores } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { formatWhen } from '../incident/data'
import { AttachmentList } from '../manager/AttachmentList'
import { TranslationCancelled, useTranslationGate } from '../translate/useTranslationGate'
import { useLostItems, type LostRow } from './data'
import { LostAwaitForm, LostOutcomeForm, LostReportForm } from './LostForms'

const STAGE_STYLE = {
  stored: 'bg-sky-100 text-sky-900',
  pending: 'bg-amber-100 text-amber-900',
  rejected: 'bg-red-100 text-red-900',
  done: 'bg-green-100 text-green-900',
} as const

function StageChip({ r }: { r: LostRow }) {
  const { t } = useTranslation()
  const stage = lostStage(r)
  const label = stage === 'done' || r.status === 'awaiting' ? t(`lost.status.${r.status}`) : t(`lost.stage.${stage}`)
  return <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-xs font-bold', STAGE_STYLE[stage])}>{label}</span>
}

/** 管理者: comment, approve / send back the recorded outcome, dispose a stored item. Text is saved in Japanese. */
function ManagerActions({ r }: { r: LostRow }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const gate = useTranslationGate()
  const [body, setBody] = useState('')
  const act = useMutation({
    mutationFn: async (action: 'approve' | 'reject' | 'dispose' | 'comment') => {
      const g = await gate.prepare([{ key: 'body', label: t('lost.comment'), text: body.trim() || null }])
      unwrap(
        await supabase.rpc('manage_lost_item', {
          p_id: r.id,
          p_action: action,
          p_body: g.values.body,
          p_original: g.originals?.body ?? null,
          p_source_lang: g.sourceLang,
        }),
      )
    },
    onSuccess: () => {
      setBody('')
      void queryClient.invalidateQueries({ queryKey: ['lost_items'] })
    },
  })
  const stage = lostStage(r)
  return (
    <Card className="flex flex-col gap-2">
      {gate.review}
      <h3 className="font-bold">🧑‍💼 {t('lost.managerTitle')}</h3>
      <TextArea label={t('lost.comment')} hint={t('lost.commentHint')} rows={2} value={body} maxLength={1000} onChange={(e) => setBody(e.target.value)} />
      {act.error && !(act.error instanceof TranslationCancelled) && <ErrorBox message={errorMessage(act.error)} />}
      <div className="grid grid-cols-2 gap-2">
        {stage === 'pending' && (
          <>
            <Button onClick={() => act.mutate('approve')} disabled={act.isPending}>
              ✅ {t('lost.approve')}
            </Button>
            <Button variant="secondary" onClick={() => act.mutate('reject')} disabled={act.isPending || !body.trim()}>
              ↩️ {t('lost.reject')}
            </Button>
          </>
        )}
        <Button variant="secondary" onClick={() => act.mutate('comment')} disabled={act.isPending || !body.trim()}>
          💬 {t('lost.sendComment')}
        </Button>
        {(stage === 'stored' || stage === 'rejected') && (r.status === 'stored' || r.status === 'awaiting') && (
          <Button variant="secondary" onClick={() => window.confirm(t('lost.disposeConfirm')) && act.mutate('dispose')} disabled={act.isPending}>
            🗑️ {t('lost.dispose')}
          </Button>
        )}
      </div>
      {stage === 'pending' && <p className="text-xs text-muted">{t('lost.rejectHint')}</p>}
    </Card>
  )
}

function LostSheet({ r, onClose }: { r: LostRow; onClose: () => void }) {
  const { t } = useTranslation()
  const { isManager } = useAuth()
  const stores = useStores()
  const [outcome, setOutcome] = useState<'returned' | 'police' | 'await' | null>(null)
  const queryClient = useQueryClient()
  const backToStored = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('lost_item_await', { p_id: r.id, p_note: null, p_pickup_at: null, p_back: true })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['lost_items'] }),
  })
  const stage = lostStage(r)
  const found = r.attachments.filter((a) => a.phase !== 'return' && a.status !== 'failed')
  const returned = r.attachments.filter((a) => a.phase === 'return' && a.status !== 'failed')
  const comments = [...r.lost_item_comments].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const days = keptDays(r.found_at)
  return (
    <Sheet title={`👜 ${r.description}`} onClose={onClose}>
      <Card className="flex flex-col gap-1 text-sm">
        <p className="flex items-center justify-between gap-2 text-base font-bold">
          <span>
            {LOST_STATUS_ICON[r.status]} {storeName(stores.data?.find((s) => s.id === r.store_id), currentLocale())}
          </span>
          <StageChip r={r} />
        </p>
        <p>
          <b>{t('lost.foundAt')}:</b> {formatWhen(r.found_at)}
          {r.found_place && `・${r.found_place}`}
        </p>
        <p>
          <b>{t('lost.storage')}:</b> {r.storage_place ?? '—'}
        </p>
        <p>
          <b>{t('lost.owner')}:</b> {LOST_OWNER_ICON[r.owner_type]} {t(`lost.owners.${r.owner_type}`)}
          {r.owner_name && `（${r.owner_name}${r.owner_phone ? ` ${r.owner_phone}` : ''}）`}
        </p>
        <p className="text-muted">
          {t('lost.reporter')}: {r.reporter_name}
        </p>
        {r.original_texts?.description && isManager && (
          <p className="text-xs text-muted">
            {t('comment.original')}: {r.original_texts.description}
          </p>
        )}
        <p>
          <b>{t('lost.keepUntil')}:</b> {r.keep_until ? formatWhen(r.keep_until) : '—'}
        </p>
        {r.status === 'awaiting' && (
          <p className="rounded-lg bg-sky-50 p-2">
            ⏳ <b>{t('lost.status.awaiting')}</b>
            {r.pickup_at && ` ・ ${t('lost.pickupAt')}: ${formatWhen(r.pickup_at)}`}
            {r.contact_note && <span className="block whitespace-pre-wrap">{r.contact_note}</span>}
          </p>
        )}
        {pastKeep(r) && <p className="rounded-lg bg-amber-50 p-2 font-bold text-amber-900">⚠️ {t('lost.keptLong', { n: days })}</p>}
        {isManager ? <AttachmentList list={found} parentId={r.id} /> : found.length > 0 && <p>📷 {t('lost.photos', { n: found.length })}</p>}
      </Card>

      {r.status !== 'stored' && r.status !== 'awaiting' && (
        <Card className="flex flex-col gap-1 text-sm">
          <h3 className="font-bold">
            {LOST_STATUS_ICON[r.status]} {t(`lost.status.${r.status}`)}
          </h3>
          {r.outcome_at && <p>{formatWhen(r.outcome_at)}</p>}
          {r.outcome_to_name && (
            <p>
              <b>{t('lost.toName')}:</b> {r.outcome_to_name} {r.outcome_to_phone}
            </p>
          )}
          {r.police_station && (
            <p>
              <b>{t('lost.station')}:</b> {r.police_station} {r.police_number && `（${t('lost.number')} ${r.police_number}）`}
            </p>
          )}
          {r.status === 'returned' && r.id_method && (
            <p>
              <b>{t('lost.idCheck')}:</b> {t(`lost.idMethod.${r.id_method}`)} {r.id_checked && '✓'}
            </p>
          )}
          {r.outcome_note && <p className="whitespace-pre-wrap">{r.outcome_note}</p>}
          {r.status === 'returned' && r.owner_type === 'customer' && (
            <p className="flex flex-wrap gap-1">
              <span className={cx('rounded-full px-2 text-xs font-bold', r.consent_face ? 'bg-green-100 text-green-900' : 'bg-slate-100 text-slate-700')}>
                🙂 {r.consent_face ? t('lost.faceYes') : t('lost.faceNone')}
              </span>
              <span className={cx('rounded-full px-2 text-xs font-bold', r.consent_marketing ? 'bg-green-100 text-green-900' : 'bg-slate-100 text-slate-700')}>
                📣 {r.consent_marketing ? t('lost.marketingYes') : t('lost.marketingNone')}
              </span>
            </p>
          )}
          <p className="text-muted">
            {t('lost.recordedBy')}: {r.outcome_by_name}
            {r.decided_by_name && ` ・ ${t(`lost.decided.${r.approval}`)}: ${r.decided_by_name}`}
          </p>
          {isManager ? <AttachmentList list={returned} parentId={r.id} /> : returned.length > 0 && <p>📷 {t('lost.photos', { n: returned.length })}</p>}
        </Card>
      )}

      {comments.length > 0 && (
        <Card className="flex flex-col gap-2 text-sm">
          <h3 className="font-bold">💬 {t('lost.comments')}</h3>
          {comments.map((c) => (
            <div key={c.id} className="rounded-lg bg-surface p-2">
              <p className="text-xs text-muted">
                {formatWhen(c.created_at)} ・ {c.author_name}
                {c.action && <b className="ml-1">{t(`lost.decided.${c.action === 'approve' ? 'approved' : c.action === 'reject' ? 'rejected' : c.action === 'dispose' ? 'disposed' : c.action}`)}</b>}
              </p>
              {c.body && <p className="whitespace-pre-wrap">{c.body}</p>}
            </div>
          ))}
        </Card>
      )}

      {(stage === 'stored' || stage === 'rejected') &&
        (outcome === 'await' ? (
          <LostAwaitForm item={r} onDone={() => setOutcome(null)} />
        ) : outcome ? (
          <LostOutcomeForm item={r} outcome={outcome} onDone={() => setOutcome(null)} />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {r.status === 'stored' && (
              <Button variant="secondary" className="col-span-2" onClick={() => setOutcome('await')}>
                ⏳ {t('lost.doAwait')}
              </Button>
            )}
            <Button onClick={() => setOutcome('returned')}>🤝 {t('lost.doReturn')}</Button>
            <Button variant="secondary" onClick={() => setOutcome('police')}>
              🚓 {t('lost.doPolice')}
            </Button>
            {r.status === 'awaiting' && (
              <Button variant="secondary" className="col-span-2" onClick={() => backToStored.mutate()} disabled={backToStored.isPending}>
                📦 {t('lost.backToStored')}
              </Button>
            )}
          </div>
        ))}
      {stage === 'rejected' && <p className="text-sm font-bold text-red-800">↩️ {t('lost.rejectedHint')}</p>}
      {isManager && <ManagerActions r={r} />}
    </Sheet>
  )
}

const FILTERS: LostFilter[] = ['stored', 'pending', 'done', 'marketing', 'all']

/** The shared list: staff (メニュー → 忘れ物・落とし物) and managers (管理 → 忘れ物). */
export function LostItemsList({ initialFilter = 'stored', canAdd = true }: { initialFilter?: LostFilter; canAdd?: boolean }) {
  const { t } = useTranslation()
  const { isManager } = useAuth()
  const stores = useStores()
  const items = useLostItems()
  const [filter, setFilter] = useState<LostFilter>(initialFilter)
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  if (items.isLoading) return <Spinner />
  const all = items.data ?? []
  const list = all.filter((r) => matchesLostFilter(r, filter))
  const open = all.find((r) => r.id === openId)
  const count = (f: LostFilter) => all.filter((r) => matchesLostFilter(r, f)).length
  return (
    <div className="flex flex-col gap-3">
      {canAdd &&
        (adding ? (
          <LostReportForm onDone={() => setAdding(false)} />
        ) : (
          <Button onClick={() => setAdding(true)}>＋ {t('lost.new')}</Button>
        ))}
      <div className="flex flex-wrap gap-2">
        {FILTERS.filter((f) => f !== 'marketing' || isManager).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cx('min-h-10 rounded-full border-[1.5px] px-3 text-sm font-bold', filter === f ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink')}
          >
            {t(`lost.filter.${f}`)} {f !== 'all' && <span className="tabular-nums">{count(f)}</span>}
          </button>
        ))}
      </div>
      {filter === 'marketing' && <p className="text-xs text-muted">{t('lost.marketingHint')}</p>}
      {items.error && <ErrorBox message={errorMessage(items.error)} />}
      {list.length === 0 ? (
        <p className="text-sm text-muted">{t('lost.none')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((r) => {
            const days = keptDays(r.found_at)
            return (
              <li key={r.id}>
                <button type="button" onClick={() => setOpenId(r.id)} className="flex w-full flex-col gap-1 rounded-xl border border-line bg-white p-3 text-left">
                  <span className="flex items-center justify-between gap-2">
                    <b>
                      {LOST_STATUS_ICON[r.status]} {r.description}
                    </b>
                    <StageChip r={r} />
                  </span>
                  <span className="text-sm text-muted">
                    {formatWhen(r.found_at)} ・ {storeName(stores.data?.find((s) => s.id === r.store_id), currentLocale())}
                  </span>
                  <span className="text-sm">
                    {LOST_OWNER_ICON[r.owner_type]} {t(`lost.owners.${r.owner_type}`)}
                    {r.owner_name && `（${r.owner_name}）`} ・ 📦 {r.storage_place ?? '—'}
                    {r.lost_item_comments.length > 0 && ` ・ 💬 ${r.lost_item_comments.length}`}
                  </span>
                  {pastKeep(r) && <span className="text-xs font-bold text-amber-800">⚠️ {t('lost.keptLong', { n: days })}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {open && <LostSheet r={open} onClose={() => setOpenId(null)} />}
    </div>
  )
}
