import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Card, ErrorBox, Spinner, PageTitle } from '../../components/ui'
import { PATROL_TARGET_25 } from '../../domain/patrol'
import { choreiSlots, completion, dateRange, patrolSummary, scored } from '../../domain/stats'
import { addDays, formatShortDate, formatTokyoTime } from '../../domain/time'
import { MISS_ICON, SHIFTS } from '../../domain/types'
import { currentLocale } from '../../i18n'
import { cx } from '../../lib/cx'
import { errorMessage, storeName } from '../../lib/format'
import { unwrap, useStores } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { Dot } from './common'
import { ForecastCard } from './analysis/ForecastCard'
import { SalesCompareCard } from './analysis/SalesCompareCard'
import { ChoreiSlotSheets, DrillSheet, TapStat } from './drill'
import { avgHow, score25Line, useDrill } from './drillState'
import { visaRuns } from '../../domain/shiftChange'
import { useChanges, useVisaWindows } from '../shift/changeData'
import { startAt } from '../../domain/schedule'
import { today, useIncidents, useIssueStatus, usePeople, useRecords, useSystemStatus, weekOf, type AdminPatrol } from './data'
import { URGENT_INCIDENTS } from '../../domain/incident'
import { LOST_KEEP_DAYS, lostStage, pastKeep } from '../../domain/lostItem'
import { useLostItems } from '../lost/data'
import { systemProblems } from '../../domain/systemStatus'
import { STAFF_ISSUES_ENABLED } from '../../domain/issues'
import { PatrolDetail } from './details'
import { ManagerTabs } from './ManagerTabs'
import { ShiftChangesSheet } from './ShiftSync'
import { VisaSheet } from './VisaSheet'
import { useVisaDismissed } from './visaDismiss'
import { useMe } from '../../app/auth'
import { pastChanges, useShiftImportLog, useShiftSyncStatus } from './shiftSyncData'

/** 面談が必要 / 面談後の再発 (スタッフ別), shown only when there is something to do. */
function StaffAlerts() {
  const { t } = useTranslation('manager')
  const status = useIssueStatus()
  const interview = (status.data ?? []).filter((s) => s.level === 'interview').length
  const escalate = (status.data ?? []).filter((s) => s.level === 'escalate').length
  return (
    <>
      {escalate > 0 && (
        <li>
          <Link to="/manager/staff" className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-red-50 px-3 font-semibold text-red-900">
            <span className="flex items-center gap-2">
              <Dot tone="red" /> {t('dashboard.staffEscalate')}
            </span>
            <span>{escalate}</span>
          </Link>
        </li>
      )}
      {interview > 0 && (
        <li>
          <Link to="/manager/staff" className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 font-semibold text-amber-900">
            <span className="flex items-center gap-2">
              <Dot tone="amber" /> {t('dashboard.staffInterview')}
            </span>
            <span>{interview}</span>
          </Link>
        </li>
      )}
    </>
  )
}

/** Open coaching follow-ups and time reviews, whatever their date. */
function useOpenItems() {
  return useQuery({
    queryKey: ['admin', 'open-items'],
    queryFn: async () =>
      unwrap<AdminPatrol[]>(
        await supabase
          .from('patrol_checks')
          .select('*, attachments(id, kind, status, drive_url)')
          .neq('status', 'void')
          .eq('is_test', false)
          .or('needs_time_review.eq.true,and(judgement.eq.coaching,follow_up_done_at.is.null,status.eq.valid)')
          .order('started_at', { ascending: false }),
      ),
  })
}

export function DashboardPage() {
  const { t } = useTranslation('manager')
  const stores = useStores()
  const people = usePeople()
  const now = new Date()
  const day = today()
  const thisWeek = weekOf(day)
  const lastWeek = weekOf(addDays(thisWeek.from, -7))
  const records = useRecords({ from: addDays(day, -13), to: day })
  const open = useOpenItems()
  const [selected, setSelected] = useState<AdminPatrol | null>(null)
  // today's slot opened from the grid (date|store|shift)
  const [slotKey, setSlotKey] = useState<string | null>(null)
  const drill = useDrill()
  const me = useMe()
  const visa = useVisaWindows()
  const visaDismiss = useVisaDismissed(me.id)
  const visaShown = visaRuns(visa.data ?? []).filter((r) => !visaDismiss.isHidden(r))
  const system = useSystemStatus()
  const incidents = useIncidents()
  const openIncidents = (incidents.data ?? []).filter((r) => r.status !== 'done')
  const urgentIncidents = openIncidents.filter((r) => URGENT_INCIDENTS.includes(r.kind))
  const lost = useLostItems()
  const lostPending = (lost.data ?? []).filter((r) => lostStage(r) === 'pending').length
  const lostLong = (lost.data ?? []).filter((r) => pastKeep(r)).length
  const sysProblems = system.data ? systemProblems(system.data, now) : []
  const changes = useChanges(addDays(day, -1), addDays(day, 60))
  const pendingChanges = (changes.data ?? []).filter((c) => c.status === 'open')
  const urgentChanges = pendingChanges.filter((c) => startAt(c).getTime() - now.getTime() < 12 * 3600_000)
  const [visaOpen, setVisaOpen] = useState(false)
  // シフト表の変更 (Office 365 / app imports of the last 7 days) and a failed automatic import
  const shiftLogs = useShiftImportLog(7)
  const shiftSync = useShiftSyncStatus()
  const [shiftOpen, setShiftOpen] = useState(false)
  const shiftChangeCount = (shiftLogs.data ?? []).reduce((n, l) => n + l.n_changes, 0)
  const shiftPastCount = (shiftLogs.data ?? []).reduce((n, l) => n + pastChanges(l).length, 0)

  if (records.isLoading || stores.isLoading) return <Spinner />
  if (records.error) return <ErrorBox message={errorMessage(records.error)} />

  const storeIds = (stores.data ?? []).map((s) => s.id)
  const chorei = records.chorei.data ?? []
  const patrols = records.patrols.data ?? []
  const misses = records.misses.data ?? []
  const todaySlots = choreiSlots(chorei, [day], storeIds, now, misses)
  // 要対応: missing 朝礼 that nobody explained yet
  const missingSlots = choreiSlots(chorei, dateRange(addDays(day, -6), day), storeIds, now, misses).filter((s) => s.state === 'missing' && !s.miss)
  const inRange = (r: { from: string; to: string }) => patrols.filter((p) => p.business_date >= r.from && p.business_date <= r.to)
  const cur = patrolSummary(inRange(thisWeek))
  const prev = patrolSummary(inRange(lastWeek))
  const weekSlots = choreiSlots(chorei, dateRange(thisWeek.from, day), storeIds, now, misses).filter((s) => s.state === 'done' || s.state === 'missing')
  const weekChorei = completion(weekSlots)
  const weekScored = scored(inRange(thisWeek))
  const openSlot = todaySlots.find((s) => `${s.date}|${s.storeId}|${s.shift}` === slotKey) ?? null
  const coaching = (open.data ?? []).filter((p) => p.judgement === 'coaching' && !p.follow_up_done_at && p.status === 'valid')
  const timeReview = (open.data ?? []).filter((p) => p.needs_time_review)
  const pending = (people.data ?? []).filter((p) => p.status === 'pending').length
  const delta = cur.average !== null && prev.average !== null ? Math.round((cur.average - prev.average) * 10) / 10 : null
  const storeLabel = (id: string) => storeName(stores.data?.find((s) => s.id === id), currentLocale())

  return (
    <div className="flex flex-col gap-4">
      <ManagerTabs />
      <PageTitle title={t('dashboard.title')} />

      <Card className="flex flex-col gap-2">
        <h2 className="font-bold">{t('dashboard.today', { date: formatShortDate(day) })}</h2>
        <table className="w-full text-center text-sm">
          <thead>
            <tr>
              <th />
              {SHIFTS.map((s) => (
                <th key={s} className="py-1">
                  {t(`common:shift.${s}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {storeIds.map((sid) => (
              <tr key={sid} className="border-t border-slate-100">
                <th className="py-2 text-left">{storeLabel(sid)}</th>
                {SHIFTS.map((shift) => {
                  const slot = todaySlots.find((x) => x.storeId === sid && x.shift === shift)!
                  const label =
                    slot.state === 'done'
                        ? slot.record
                          ? `✓ ${formatTokyoTime(new Date(slot.record.submitted_at))}`
                          : `✓ ${t('misses.confirmedShort')}`
                        : slot.state === 'missing'
                          ? slot.miss?.reason
                            ? `${MISS_ICON[slot.miss.reason]} ${t(`chorei:miss.reason.${slot.miss.reason}`)}`
                            : `✗ ${t('dashboard.missing')}`
                          : '―'
                  const tone = slot.state === 'done' ? 'text-green-700' : slot.state === 'missing' ? (slot.miss ? 'text-amber-800' : 'text-red-700') : 'text-slate-500'
                  return (
                    <td key={shift} className={cx('py-1 font-bold', tone)}>
                      {slot.state === 'done' || slot.state === 'missing' ? (
                        <button type="button" onClick={() => setSlotKey(`${slot.date}|${slot.storeId}|${slot.shift}`)} className="min-h-10 w-full rounded underline decoration-dotted underline-offset-2 active:bg-slate-50">
                          {label}
                        </button>
                      ) : (
                        label
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {sysProblems.length > 0 && (
        <Link to="/manager/system" className="flex min-h-11 items-center justify-between gap-2 rounded-xl border-2 border-red-300 bg-red-50 px-3 font-bold text-red-900">
          <span>⚠ {t('system.problems', { n: sysProblems.length })}</span>
          <span>›</span>
        </Link>
      )}

      <Card className="flex flex-col gap-2">
        <h2 className="font-bold">{t('dashboard.todo')}</h2>
        <ul className="flex flex-col gap-1 text-sm">
          <li>
            <Link to="/manager/patrol?filter=coaching" className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-red-50 px-3 font-semibold text-red-900">
              <span className="flex items-center gap-2">
                <Dot tone="red" /> {t('dashboard.coaching')}
              </span>
              <span>{coaching.length}</span>
            </Link>
          </li>
          {STAFF_ISSUES_ENABLED && <StaffAlerts />}
          <li>
            <Link to="/manager/patrol?filter=time" className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 font-semibold text-amber-900">
              <span className="flex items-center gap-2">
                <Dot tone="amber" /> {t('dashboard.timeReview')}
              </span>
              <span>{timeReview.length}</span>
            </Link>
          </li>
          <li>
            <button
              type="button"
              onClick={() => drill.open(() => ({ kind: 'chorei', title: t('dashboard.missingChorei'), how: t('drill.missingRecent'), slots: missingSlots }))}
              className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 text-left font-semibold text-amber-900"
            >
              <span className="flex items-center gap-2">
                <Dot tone="amber" /> {t('dashboard.missingChorei')}
              </span>
              <span>{missingSlots.length} ›</span>
            </button>
          </li>
          {openIncidents.length > 0 && (
            <li>
              <Link
                to="/manager/incidents"
                className={cx('flex min-h-11 items-center justify-between gap-2 rounded-xl px-3 font-semibold', urgentIncidents.length ? 'bg-red-50 text-red-900' : 'bg-amber-50 text-amber-900')}
              >
                <span className="flex items-center gap-2">
                  <Dot tone={urgentIncidents.length ? 'red' : 'amber'} /> {t('dashboard.openIncidents')}
                </span>
                <span>{openIncidents.length} ›</span>
              </Link>
            </li>
          )}
          {(lostPending > 0 || lostLong > 0) && (
            <li>
              <Link to="/manager/lost-items" className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 font-semibold text-amber-900">
                <span className="flex items-center gap-2">
                  <Dot tone="amber" /> {t('dashboard.lostItems', { long: lostLong, days: LOST_KEEP_DAYS })}
                </span>
                <span>{lostPending} ›</span>
              </Link>
            </li>
          )}
          {pendingChanges.length > 0 && (
            <li>
              <Link
                to="/manager/attendance"
                className={cx(
                  'flex min-h-11 items-center justify-between gap-2 rounded-xl px-3 font-semibold',
                  urgentChanges.length ? 'bg-red-50 text-red-900' : 'bg-amber-50 text-amber-900',
                )}
              >
                <span className="flex items-center gap-2">
                  <Dot tone={urgentChanges.length ? 'red' : 'amber'} /> {t('dashboard.pendingChanges')}
                  {urgentChanges.length > 0 && <span className="text-xs">（{t('dashboard.pendingSoon', { n: urgentChanges.length })}）</span>}
                </span>
                <span>{pendingChanges.length} ›</span>
              </Link>
            </li>
          )}
          {visaShown.length > 0 && (
            <li>
              <button type="button" onClick={() => setVisaOpen(true)} className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl bg-red-50 px-3 text-left font-semibold text-red-900">
                <span className="flex items-center gap-2">
                  <Dot tone="red" /> {t('dashboard.visaOver')}
                </span>
                <span>{new Set(visaShown.map((r) => r.name)).size} ›</span>
              </button>
            </li>
          )}
          {shiftSync.data?.status && !shiftSync.data.status.ok && (
            <li>
              <Link to="/manager/shift-import" className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-red-50 px-3 font-semibold text-red-900">
                <span className="flex items-center gap-2">
                  <Dot tone="red" /> {t('shiftSync.failed')}
                </span>
                <span>›</span>
              </Link>
            </li>
          )}
          {shiftChangeCount > 0 && (
            <li>
              <button
                type="button"
                onClick={() => setShiftOpen(true)}
                className={cx(
                  'flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-3 text-left font-semibold',
                  shiftPastCount ? 'bg-red-50 text-red-900' : 'bg-amber-50 text-amber-900',
                )}
              >
                <span className="flex flex-wrap items-center gap-x-2">
                  <Dot tone={shiftPastCount ? 'red' : 'amber'} /> {t('shiftSync.dashboard')}
                  {shiftPastCount > 0 && <span className="text-xs">（{t('shiftSync.pastCount', { n: shiftPastCount })}）</span>}
                </span>
                <span>{shiftChangeCount} ›</span>
              </button>
            </li>
          )}
          <li>
            <Link to="/manager/users" className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-blue-50 px-3 font-semibold text-blue-900">
              {t('dashboard.pendingUsers')} <span>{pending}</span>
            </Link>
          </li>
        </ul>
        {coaching.length > 0 && (
          <ul className="flex flex-col gap-1">
            {coaching.slice(0, 5).map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => setSelected(p)} className="w-full rounded-lg bg-white p-2 text-left text-sm ring-1 ring-red-200">
                  {formatShortDate(p.business_date)} {t(`common:shift.${p.shift}`)} {storeLabel(p.store_id)} — {p.total}/{p.max_total}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <SalesCompareCard />
      <ForecastCard days={2} compact />

      <h2 className="font-bold">{t('dashboard.thisWeek', { from: formatShortDate(thisWeek.from), to: formatShortDate(thisWeek.to) })}</h2>
      <div className="grid grid-cols-2 gap-2">
        <TapStat
          label={t('dashboard.avgScore')}
          value={cur.average ?? '—'}
          sub={`${t('dashboard.target', { n: PATROL_TARGET_25 })}${delta !== null ? ` / ${t('dashboard.vsLastWeek')} ${delta >= 0 ? '▲+' : '▼'}${delta}` : ''}`}
          tone={cur.average === null ? undefined : cur.average >= PATROL_TARGET_25 ? 'good' : 'warn'}
          onOpen={() => drill.open(() => ({ kind: 'patrol', title: t('dashboard.avgScore'), how: avgHow(t, weekScored), patrols: weekScored, extra: score25Line(t) }))}
        />
        <TapStat
          label={t('dashboard.choreiRate')}
          value={weekChorei.rate === null ? '—' : `${weekChorei.rate}%`}
          sub={`${weekChorei.done}/${weekChorei.due}`}
          onOpen={() => drill.open(() => ({ kind: 'chorei', title: t('dashboard.choreiRate'), how: t('drill.choreiRate', { done: weekChorei.done, due: weekChorei.due, rate: weekChorei.rate ?? '—' }), slots: weekSlots }))}
        />
        <TapStat
          label={t('dashboard.patrols')}
          value={cur.count}
          sub={`${t('common:judgement.good')} ${cur.good} / ${t('common:judgement.improve')} ${cur.improve} / ${t('common:judgement.coaching')} ${cur.coaching}`}
          onOpen={() => drill.open(() => ({ kind: 'patrol', title: t('dashboard.patrols'), how: t('drill.patrols'), patrols: weekScored }))}
        />
        <TapStat
          label={t('dashboard.mask')}
          value={cur.mask}
          onOpen={() => drill.open(() => ({ kind: 'patrol', title: t('dashboard.mask'), how: t('drill.mask'), patrols: weekScored.filter((p) => p.mask_worn) }))}
        />
      </div>

      {shiftOpen && <ShiftChangesSheet logs={shiftLogs.data ?? []} onClose={() => setShiftOpen(false)} />}
      {visaOpen && <VisaSheet windows={visa.data ?? []} dismiss={visaDismiss} onClose={() => setVisaOpen(false)} />}
      <DrillSheet drill={drill} slots={choreiSlots(chorei, dateRange(addDays(day, -13), day), storeIds, now, misses)} patrols={patrols} />
      {openSlot && <ChoreiSlotSheets key={slotKey} slot={openSlot} onClose={() => setSlotKey(null)} />}
      {selected && <PatrolDetail patrol={selected} patrollerName={people.name(selected.patroller_id)} onClose={() => setSelected(null)} />}
    </div>
  )
}
