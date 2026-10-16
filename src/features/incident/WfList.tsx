import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useAuth, useMe } from '../../app/auth'
import { Card, Spinner } from '../../components/ui'
import { fmtMinutes, isOverdue, OPEN_STATES, PRIORITIES, WF_STATES, wfMetrics, type Priority, type WfState } from '../../domain/incidentWorkflow'
import { currentLocale } from '../../i18n'
import { cx } from '../../lib/cx'
import { storeName } from '../../lib/format'
import { getLastStore } from '../../lib/lastStore'
import { useStores } from '../../lib/queries'
import { formatWhen } from './data'
import { incidentNo, useWfIncidents, type WfIncident } from './wfData'
import { WfChips, WfDetail } from './WfDetail'

const elapsed = (from: string) => fmtMinutes(Math.max(0, Math.round((Date.now() - new Date(from).getTime()) / 60_000)))
/** 緊急 first, then overdue, then the oldest open */
const rank = (r: WfIncident) => (r.priority === 'urgent' ? 0 : isOverdue(r) ? 1 : r.priority === 'high' ? 2 : 3)

export function WfCard({ r, onOpen }: { r: WfIncident; onOpen: () => void }) {
  const { t } = useTranslation()
  const stores = useStores()
  const me = useMe()
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx('flex w-full flex-col gap-1 rounded-xl border bg-white p-3 text-left', r.priority === 'urgent' && OPEN_STATES.includes(r.wf_state) ? 'border-red-500 border-2' : 'border-line')}
    >
      <span className="flex items-start justify-between gap-2">
        <b className="min-w-0">
          🔧 {r.equipment_name ?? t('incident.kinds.equipment')} <span className="text-xs font-normal text-muted">{incidentNo(r.incident_no)}</span>
        </b>
        <WfChips r={r} />
      </span>
      <span className="text-sm text-muted">
        {storeName(stores.data?.find((s) => s.id === r.store_id), currentLocale())} ・ {t('wf.elapsed', { t: elapsed(r.occurred_at) })}
      </span>
      <span className="line-clamp-2 text-sm">{r.description}</span>
      <span className="flex flex-wrap gap-x-3 text-xs">
        <span className={cx(r.assignee_id === me.id && 'font-bold text-brand')}>👤 {r.assignee_name ?? t('wf.unassigned')}</span>
        {r.due_at && <span className={cx(isOverdue(r) && 'font-bold text-red-700')}>⏰ {formatWhen(r.due_at)}</span>}
      </span>
    </button>
  )
}

type Filter = { store: string; state: 'open' | 'all' | WfState; priority: '' | Priority; assignee: string; overdue: boolean }

/** 一覧 with the filters of the spec (店舗・状態・優先度・担当者・期限超過); カテゴリ is 設備の故障 in stage 1. */
export function WfList({ initialOpen = null, dashboard = false }: { initialOpen?: string | null; dashboard?: boolean }) {
  const { t } = useTranslation()
  const tm = useTranslation('manager').t
  const { isManager } = useAuth()
  const stores = useStores()
  const q = useWfIncidents()
  const [f, setF] = useState<Filter>({ store: '', state: 'open', priority: '', assignee: '', overdue: false })
  const [openId, setOpenId] = useState<string | null>(initialOpen)
  if (q.isLoading) return <Spinner />
  const all = q.data ?? []
  const list = all
    .filter((r) => (f.state === 'open' ? OPEN_STATES.includes(r.wf_state) : f.state === 'all' ? true : r.wf_state === f.state))
    .filter((r) => !f.store || r.store_id === f.store)
    .filter((r) => !f.priority || r.priority === f.priority)
    .filter((r) => !f.assignee || (f.assignee === '-' ? !r.assignee_id : r.assignee_id === f.assignee))
    .filter((r) => !f.overdue || isOverdue(r))
    .sort((a, b) => rank(a) - rank(b) || a.created_at.localeCompare(b.created_at))
  const open = all.find((r) => r.id === openId)
  const assignees = [...new Map(all.filter((r) => r.assignee_id).map((r) => [r.assignee_id!, r.assignee_name ?? '?'])).entries()]
  const m = wfMetrics(all)
  const sel = 'min-h-10 rounded-lg border border-slate-400 bg-white px-2 text-sm'
  const show = (patch: Partial<Filter>) => setF({ store: '', state: 'all', priority: '', assignee: '', overdue: false, ...patch })
  return (
    <div className="flex flex-col gap-3">
      {dashboard && isManager && (
        <Card className="flex flex-col gap-2">
          <h3 className="font-bold">📊 {tm('wf.dash')}</h3>
          <div className="grid grid-cols-3 gap-2 text-center">
            {(
              [
                ['total', m.total.length, () => show({})],
                ['open', m.open.length, () => show({ state: 'open' })],
                ['overdue', m.overdue.length, () => show({ overdue: true })],
                ['firstResponse', fmtMinutes(m.firstResponse.avg), () => show({})],
                ['repair', fmtMinutes(m.repair.avg), () => show({})],
                ['recur', m.recurrences.length, () => show({})],
              ] as const
            ).map(([k, v, go]) => (
              <button key={k} type="button" onClick={go} className={cx('rounded-xl border border-line p-2', k === 'overdue' && m.overdue.length > 0 && 'border-red-400 bg-red-50')}>
                <span className="block text-[11px] text-muted">{tm(`wf.m.${k}`)}</span>
                <b className="text-lg tabular-nums">{v}</b>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">
            {tm('wf.byStore')}：
            {[...m.byStore.entries()].map(([s, rows]) => `${storeName(stores.data?.find((x) => x.id === s), 'ja')} ${rows.length}`).join('・') || '—'}
          </p>
          <details className="text-xs text-muted">
            <summary className="cursor-pointer">{tm('wf.mHowTitle')}</summary>
            <p className="whitespace-pre-line">{tm('wf.mHow')}</p>
            {m.recurrences.length > 0 && (
              <p>
                {tm('wf.m.recur')}：{m.recurrences.map((r) => `${incidentNo(r.incident_no)} ${r.equipment_name ?? ''}`).join('、')}
              </p>
            )}
          </details>
        </Card>
      )}
      <div className="flex flex-wrap gap-2">
        <select aria-label={t('incident.store')} className={sel} value={f.store} onChange={(e) => setF({ ...f, store: e.target.value })}>
          <option value="">{t('wf.allStores')}</option>
          {(stores.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {storeName(s, currentLocale())}
            </option>
          ))}
        </select>
        <select aria-label={t('wf.f.state')} className={sel} value={f.state} onChange={(e) => setF({ ...f, state: e.target.value as Filter['state'] })}>
          <option value="open">{t('wf.openOnly')}</option>
          <option value="all">{t('wf.all')}</option>
          {WF_STATES.map((s) => (
            <option key={s} value={s}>
              {t(`wf.state.${s}`)}
            </option>
          ))}
        </select>
        <select aria-label={t('wf.f.priority')} className={sel} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Filter['priority'] })}>
          <option value="">{t('wf.anyPriority')}</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {t(`wf.priority.${p}`)}
            </option>
          ))}
        </select>
        <select aria-label={t('wf.f.assignee')} className={sel} value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })}>
          <option value="">{t('wf.anyAssignee')}</option>
          <option value="-">{t('wf.unassigned')}</option>
          {assignees.map(([id, n]) => (
            <option key={id} value={id}>
              {n}
            </option>
          ))}
        </select>
        <label className="flex min-h-10 items-center gap-1 text-sm">
          <input type="checkbox" checked={f.overdue} onChange={(e) => setF({ ...f, overdue: e.target.checked })} /> {t('wf.overdue')}
        </label>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-muted">{t('wf.none')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((r) => (
            <li key={r.id}>
              <WfCard r={r} onOpen={() => setOpenId(r.id)} />
            </li>
          ))}
        </ul>
      )}
      {open && <WfDetail r={open} onClose={() => setOpenId(null)} />}
    </div>
  )
}

/** ホーム / 朝礼: 未完了の設備トラブル for the next shift (the store used last on this phone first; 緊急 first). */
export function WfHandoverCard() {
  const { t } = useTranslation()
  const me = useMe()
  const q = useWfIncidents()
  const last = getLastStore()
  const open = (q.data ?? [])
    .filter((r) => OPEN_STATES.includes(r.wf_state))
    .sort((a, b) => rank(a) - rank(b) || Number(b.store_id === last) - Number(a.store_id === last) || a.created_at.localeCompare(b.created_at))
  if (!open.length) return null
  const urgent = open.some((r) => r.priority === 'urgent')
  return (
    <Card className={cx('flex flex-col gap-2', urgent && 'border-2 border-red-500')}>
      <h2 className="flex items-center justify-between font-bold">
        <span>🔧 {t('wf.handover', { n: open.length })}</span>
        <Link to="/incident?tab=wf" className="text-sm text-brand underline">
          {t('wf.seeAll')}
        </Link>
      </h2>
      {urgent && <p className="rounded-lg bg-red-50 p-2 text-sm font-bold text-red-900">⚠️ {t('wf.safety')}</p>}
      <ul className="flex flex-col gap-1 text-sm">
        {open.slice(0, 3).map((r) => (
          <li key={r.id}>
            <Link to={`/incident?tab=wf&open=${r.id}`} className="flex flex-wrap items-center gap-x-2">
              <WfChips r={r} />
              <b>{r.equipment_name}</b>
              {r.assignee_id === me.id && <span className="text-xs font-bold text-brand">{t('wf.mine')}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}
