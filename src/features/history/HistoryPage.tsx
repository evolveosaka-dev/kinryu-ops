import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { useAuth, useMe } from '../../app/auth'
import { Button, Card, ErrorBox, Segmented, Spinner, PageTitle } from '../../components/ui'
import { cx } from '../../lib/cx'
import { formatShortDate, formatTokyoTime, tokyoParts, weekdayOf } from '../../domain/time'
import { CHOREI_STEPS, type Shift, type StepsDone } from '../../domain/types'
import { currentLocale } from '../../i18n'
import { errorMessage, storeName } from '../../lib/format'
import { unwrap, useStores } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import type { AttachmentSummary, ChoreiRecord, PatrolCheck } from '../../lib/types'
import { ChoreiComments, type ChoreiComment } from '../chorei/Comments'

type Tab = 'chorei' | 'patrol'
type Scope = 'mine' | 'all'

/** What a 朝礼 card shows, from the own-history table query or the store_chorei_month RPC. */
interface ChoreiView {
  id: string
  business_date: string
  shift: Shift
  store_id?: string
  submitted_at: string
  leader?: string
  participants: string[]
  stock_none: boolean
  stock_text: string | null
  target_bowls: number | null
  caution_text: string | null
  steps_done: StepsDone
  skip_reason: string | null
  original_texts: Record<string, string> | null
  is_test: boolean
  status?: string
  notes: { body: string; author?: string; created_at: string }[]
  attachments: AttachmentSummary[]
  comments: ChoreiComment[]
}
type PatrolView = PatrolCheck & { patroller?: string }

const ITEMS = [
  ['score_smile', 'smile'],
  ['score_voice', 'voice'],
  ['score_grooming', 'grooming'],
  ['score_clean', 'clean'],
  ['score_quality', 'quality'],
] as const

const thisMonth = () => tokyoParts(new Date()).date.slice(0, 7)
const shiftMonth = (month: string, n: number) => {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1))
  return d.toISOString().slice(0, 7)
}

function TestBadge() {
  const { t } = useTranslation()
  return <span className="ml-2 rounded bg-slate-200 px-1 text-xs font-bold text-slate-700">{t('history.test')}</span>
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 text-sm">
      <span className="font-bold text-slate-600">{label}</span>
      <span className="whitespace-pre-wrap break-words">{children}</span>
    </div>
  )
}

function Original({ texts, field }: { texts: Record<string, string> | null; field: string }) {
  const { t } = useTranslation()
  const o = texts?.[field]
  return o ? <span className="mt-0.5 block text-xs text-slate-600">{t('history.original')}: {o}</span> : null
}

function Attachments({ list }: { list?: AttachmentSummary[] }) {
  const { t } = useTranslation()
  const { isManager } = useAuth()
  const uploaded = (list ?? []).filter((a) => a.status === 'uploaded')
  if (uploaded.length === 0) return null
  return (
    <Line label={t('attach.title')}>
      <span className="flex flex-wrap gap-2">
        {t('attach.count', { n: uploaded.length })}
        {isManager &&
          uploaded.map((a, i) =>
          a.drive_url ? (
            <a key={a.id} href={a.drive_url} target="_blank" rel="noreferrer" className="text-brand underline">
              {a.kind === 'video' ? '🎥' : '📷'}
              {i + 1}
            </a>
          ) : null,
        )}
      </span>
    </Line>
  )
}

function DateTitle({ date, shift, store, test, children }: { date: string; shift: Shift; store?: string; test: boolean; children?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-baseline justify-between gap-2">
      <p className="font-bold">
        {formatShortDate(date)}({t(`wd.${weekdayOf(date)}`)}) {t(`shift.${shift}`)}
        {store && ` ・ ${store}`}
        {test && <TestBadge />}
      </p>
      {children}
    </div>
  )
}

function ChoreiCard({ r, store }: { r: ChoreiView; store?: string }) {
  const { t } = useTranslation('chorei')
  const skipped = CHOREI_STEPS.filter((s) => r.steps_done[s] === false)
  return (
    <Card className={cx('flex flex-col gap-1.5', r.status === 'void' && 'opacity-50')}>
      <DateTitle date={r.business_date} shift={r.shift} store={store} test={r.is_test} />
      {r.status === 'void' && <p className="text-sm font-bold">{t('common:status.void')}</p>}
      <p className="text-sm text-slate-700">
        {r.leader !== undefined && <>👤 {t('common:history.leader')} <b>{r.leader || '—'}</b> ・ </>}
        {t('common:history.sentAt', { time: formatTokyoTime(new Date(r.submitted_at)) })}
      </p>
      <Line label={`${t('participants.label')}（${r.participants.length}）`}>{r.participants.join('、') || '—'}</Line>
      <Line label={t('previous.stock')}>
        {r.stock_none ? t('stock.none') : r.stock_text}
        <Original texts={r.original_texts} field="stock_text" />
      </Line>
      <Line label={t('previous.target')}>{r.target_bowls ?? '—'}</Line>
      <Line label={t('previous.caution')}>
        <span lang="ja">{r.caution_text || '—'}</span>
        <Original texts={r.original_texts} field="caution_text" />
      </Line>
      <Line label={t('common:history.steps')}>
        {skipped.length ? (
          <>
            {t('common:history.skipped')}: {skipped.map((s) => t(`steps.${s}`)).join('、')}（{r.skip_reason}）
            <Original texts={r.original_texts} field="skip_reason" />
          </>
        ) : (
          t('common:history.allSteps')
        )}
      </Line>
      {r.notes.length > 0 && (
        <Line label={t('previous.notes')}>
          {r.notes.map((n, i) => (
            <span key={i} className="block">
              {n.body}
              <span className="text-xs text-slate-600">
                {' '}— {n.author ? `${n.author} ` : ''}
                {formatTokyoTime(new Date(n.created_at))}
              </span>
            </span>
          ))}
        </Line>
      )}
      <Attachments list={r.attachments} />
      <ChoreiComments choreiId={r.id} comments={r.comments ?? []} canWrite={r.status !== 'void'} />
    </Card>
  )
}

function PatrolCard({ r, store }: { r: PatrolView; store?: string }) {
  const { t } = useTranslation('patrol')
  return (
    <Card className={cx('flex flex-col gap-1.5', r.status === 'void' && 'opacity-50')}>
      <DateTitle date={r.business_date} shift={r.shift} store={store} test={r.is_test}>
        <p className="shrink-0 font-bold text-brand">
          {r.total}/{r.max_total}
        </p>
      </DateTitle>
      <p className="text-sm text-slate-700">
        {r.patroller !== undefined && <>👤 {t('common:history.patroller')} <b>{r.patroller || '—'}</b> ・ </>}
        {t(`type.${r.patrol_type}`)} ・ {formatTokyoTime(new Date(r.started_at))}–{r.ended_at && formatTokyoTime(new Date(r.ended_at))}（
        {t('minutes', { min: r.duration_min ?? 0 })}）
      </p>
      <p className="text-sm font-bold">
        {r.judgement && t(`common:judgement.${r.judgement}`)}
        {r.needs_time_review && ` ・ ⚠️ ${t('timeReview')}`}
      </p>
      <ul className="grid grid-cols-5 gap-1 text-center text-xs">
        {ITEMS.map(([k, name]) => (
          <li key={k} className="rounded-lg bg-slate-100 p-1">
            <span className="block truncate">{t(`items.${name}.name`)}</span>
            <b className="text-base">{r[k] ?? '－'}</b>
            {k === 'score_smile' && r.mask_worn && <span className="block">😷</span>}
          </li>
        ))}
      </ul>
      <Line label={t('staffOnShift')}>{r.staff_names?.length ? r.staff_names.join('、') : r.staff_on_shift}</Line>
      <Line label={t('goodPoints.label')}>
        {r.good_points}
        <Original texts={r.original_texts} field="good_points" />
      </Line>
      <Line label={t('improvements.label')}>
        {r.improvements}
        <Original texts={r.original_texts} field="improvements" />
      </Line>
      {r.remarks && (
        <Line label={t('remarks.label')}>
          {r.remarks}
          <Original texts={r.original_texts} field="remarks" />
        </Line>
      )}
      <Attachments list={r.attachments} />
    </Card>
  )
}

function ListState({ loading, error, empty, emptyText, children }: { loading: boolean; error: unknown; empty: boolean; emptyText: string; children: ReactNode }) {
  if (loading) return <Spinner />
  if (error) return <ErrorBox message={errorMessage(error)} />
  if (empty) return <p className="text-slate-600">{emptyText}</p>
  return <ul className="flex flex-col gap-2">{children}</ul>
}

function MyChorei() {
  const { t } = useTranslation('chorei')
  const me = useMe()
  const stores = useStores()
  const queryClient = useQueryClient()
  const q = useQuery({
    queryKey: ['my_chorei', me.id],
    queryFn: async () =>
      unwrap<(ChoreiRecord & { chorei_notes: { body: string; created_at: string }[]; chorei_comments: ChoreiComment[] })[]>(
        await supabase
          .from('chorei_records')
          .select('*, attachments(id, kind, status, drive_url), chorei_notes(body, created_at), chorei_comments(id, body, author_id, author_name, created_at, read_at)')
          .eq('leader_id', me.id)
          .order('business_date', { ascending: false })
          .order('created_at', { referencedTable: 'chorei_comments' })
          .limit(50),
      ),
  })
  // Seen now: the 新着 marks stay on this screen, the ホーム card and badge go away.
  const unread = (q.data ?? []).some((r) => r.chorei_comments?.some((c) => !c.read_at && c.author_id !== me.id))
  useEffect(() => {
    if (!unread) return
    void supabase.rpc('mark_chorei_comments_read').then(() => queryClient.invalidateQueries({ queryKey: ['unread_comments'] }))
  }, [unread, queryClient])
  return (
    <ListState loading={q.isLoading} error={q.error} empty={!q.data?.length} emptyText={t('historyEmpty')}>
      {q.data?.map((r) => (
        <li key={r.id}>
          <ChoreiCard
            r={{ ...r, participants: r.participants_extra, notes: r.chorei_notes ?? [], attachments: r.attachments ?? [], comments: r.chorei_comments ?? [] }}
            store={storeName(stores.data?.find((s) => s.id === r.store_id), currentLocale())}
          />
        </li>
      ))}
    </ListState>
  )
}

function MyPatrols() {
  const { t } = useTranslation('patrol')
  const me = useMe()
  const stores = useStores()
  const q = useQuery({
    queryKey: ['my_patrols', me.id],
    queryFn: async () =>
      unwrap<PatrolCheck[]>(
        await supabase
          .from('patrol_checks')
          .select('*, attachments(id, kind, status, drive_url)')
          .eq('patroller_id', me.id)
          .neq('status', 'draft')
          .order('business_date', { ascending: false })
          .limit(50),
      ),
  })
  return (
    <ListState loading={q.isLoading} error={q.error} empty={!q.data?.length} emptyText={t('historyEmpty')}>
      {q.data?.map((r) => (
        <li key={r.id}>
          <PatrolCard r={r} store={storeName(stores.data?.find((s) => s.id === r.store_id), currentLocale())} />
        </li>
      ))}
    </ListState>
  )
}

function StoreMonth({ tab, store, month }: { tab: Tab; store: string; month: string }) {
  const { t } = useTranslation()
  const q = useQuery({
    queryKey: ['store_history', tab, store, month],
    queryFn: async () =>
      unwrap<ChoreiView[] | PatrolView[]>(
        await supabase.rpc(tab === 'chorei' ? 'store_chorei_month' : 'store_patrol_month', { p_store: store, p_month: `${month}-01` }),
      ),
  })
  const list = q.data ?? []
  return (
    <>
      {!q.isLoading && !q.error && list.length > 0 && <p className="text-sm font-bold text-slate-700">{t('history.count', { n: list.length })}</p>}
      <ListState loading={q.isLoading} error={q.error} empty={!list.length} emptyText={t('history.monthEmpty')}>
        {tab === 'chorei'
          ? (list as ChoreiView[]).map((r) => (
              <li key={r.id}>
                <ChoreiCard r={r} />
              </li>
            ))
          : (list as PatrolView[]).map((r) => (
              <li key={r.id}>
                <PatrolCard r={r} />
              </li>
            ))}
      </ListState>
    </>
  )
}

export function HistoryPage() {
  const { t } = useTranslation()
  const { canPatrol, isManager } = useAuth()
  const stores = useStores()
  const [params, setParams] = useSearchParams()
  const showPatrol = canPatrol || isManager
  const tab: Tab = showPatrol && params.get('tab') === 'patrol' ? 'patrol' : 'chorei'
  // 巡回 of all stores: managers only
  const canSeeAll = tab === 'chorei' || isManager
  const scope: Scope = canSeeAll && params.get('scope') === 'all' ? 'all' : 'mine'
  const store = params.get('store') ?? ''
  const month = /^\d{4}-\d\d$/.test(params.get('month') ?? '') ? params.get('month')! : thisMonth()

  const go = (next: { tab?: Tab; scope?: Scope; store?: string; month?: string }) => {
    const v = { tab, scope, store, month, ...next }
    const p: Record<string, string> = {}
    if (v.tab === 'patrol') p.tab = 'patrol'
    if (v.scope === 'all') {
      p.scope = 'all'
      if (v.store) p.store = v.store
      if (v.month !== thisMonth()) p.month = v.month
    }
    setParams(p, { replace: true })
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title={t('history.title')} />
      {showPatrol && (
        <Segmented<Tab>
          label=""
          value={tab}
          onChange={(v) => go({ tab: v })}
          options={[
            { value: 'chorei', label: t('history.chorei') },
            { value: 'patrol', label: t('history.patrol') },
          ]}
        />
      )}
      {canSeeAll && (
        <Segmented<Scope>
          label=""
          value={scope}
          onChange={(v) => go({ scope: v })}
          options={[
            { value: 'mine', label: t('history.mine') },
            { value: 'all', label: t('history.allStores') },
          ]}
        />
      )}
      {scope === 'mine' ? (
        tab === 'chorei' ? (
          <MyChorei />
        ) : (
          <MyPatrols />
        )
      ) : (
        <>
          <Segmented<string>
            label={t('history.pickStore')}
            value={store}
            onChange={(v) => go({ store: v })}
            options={(stores.data ?? []).map((s) => ({ value: s.id, label: storeName(s, currentLocale()) }))}
          />
          <div className="flex items-center justify-between gap-2">
            <Button variant="secondary" className="min-h-10 px-3" onClick={() => go({ month: shiftMonth(month, -1) })} aria-label={t('history.prevMonth')}>
              ‹
            </Button>
            <p className="font-bold">{t('history.month', { y: month.slice(0, 4), m: Number(month.slice(5, 7)) })}</p>
            <Button
              variant="secondary"
              className="min-h-10 px-3"
              onClick={() => go({ month: shiftMonth(month, 1) })}
              disabled={month >= thisMonth()}
              aria-label={t('history.nextMonth')}
            >
              ›
            </Button>
          </div>
          {store ? <StoreMonth tab={tab} store={store} month={month} /> : <p className="text-slate-600">{t('history.pickStoreHint')}</p>}
        </>
      )}
    </div>
  )
}
