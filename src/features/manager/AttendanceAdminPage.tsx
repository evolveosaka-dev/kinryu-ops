import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { Sheet } from '../../components/Sheet'
import { useToast } from '../../components/Toast'
import { Button, Card, ErrorBox, PageTitle, Segmented, Spinner, TextArea, TextInput } from '../../components/ui'
import { attendanceScores, GRADE_STYLE, labelOf, WINDOW_DAYS, type AttendanceEvent } from '../../domain/attendance'
import { formatMin, formatRange, STORE_BY_MARK, type Assignment } from '../../domain/schedule'
import { coverCandidates, coverProblemOf, REASON_ICON, VISA_LIMIT_MIN } from '../../domain/shiftChange'
import { addDays, formatShortDate, weekdayOf } from '../../domain/time'
import { cx } from '../../lib/cx'
import { errorMessage } from '../../lib/format'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { ChangeForm } from '../shift/ChangeForm'
import { ScoreView } from '../shift/AbsencePage'
import { noticeText, STATUS_STYLE, today, useAttendance, useChangeLabel, useChanges, useProblemText, useStaffLimits, type ChangeWithOffers } from '../shift/changeData'
import { jstDateTime } from './data'
import { ManagerTabs } from './ManagerTabs'

type Row = Assignment & { id: string; roster_name: string }

/** Active shift-table names (staff_roster), without test accounts' names. */
function useRosterNames() {
  return useQuery({
    queryKey: ['admin', 'roster_names'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [roster, tests] = await Promise.all([
        supabase.from('staff_roster').select('name').eq('active', true).order('name'),
        supabase.from('profiles').select('roster_name').eq('is_test_account', true).not('roster_name', 'is', null),
      ])
      const hidden = new Set(unwrap<{ roster_name: string }[]>(tests).map((r) => r.roster_name))
      return unwrap<{ name: string }[]>(roster)
        .map((r) => r.name)
        .filter((n) => !hidden.has(n))
    },
  })
}

const useLimits = useStaffLimits

/** Everyone's shifts of a date range (managers read all rows; paged by 1000). */
function useAssignments(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ['shift_assignments', 'range', from, to],
    enabled,
    queryFn: async () => {
      const out: Row[] = []
      for (let page = 0; ; page++) {
        const rows = unwrap<Row[]>(
          await supabase
            .from('shift_assignments')
            .select('id, roster_name, business_date, shift, store_mark, start_min, end_min, original_end_min')
            .gte('business_date', from)
            .lte('business_date', to)
            .order('business_date')
            .order('start_min')
            .order('roster_name')
            .range(page * 1000, page * 1000 + 999),
        )
        out.push(...rows)
        if (rows.length < 1000) return out
      }
    },
  })
}

const dayText = (d: string, t: (k: string) => string) => `${formatShortDate(d)}(${t(`weekday.${weekdayOf(d)}`)})`

/** One report: details, offers, candidates → approve with someone / without / reject. */
function DecideSheet({ c, onClose }: { c: ChangeWithOffers; onClose: () => void }) {
  const { t } = useTranslation('manager')
  const { t: ts } = useTranslation('shift')
  const toast = useToast()
  const queryClient = useQueryClient()
  const label = useChangeLabel()
  const names = useRosterNames()
  const limits = useLimits()
  const rows = useAssignments(addDays(c.business_date, -7), addDays(c.business_date, 7), c.status === 'open' && c.kind !== 'late')
  const [pick, setPick] = useState<{ offer?: string; cover?: string } | null>(c.status === 'open' && c.proposed_cover ? { cover: c.proposed_cover } : null)
  const problemText = useProblemText()
  const [note, setNote] = useState('')
  const [showAll, setShowAll] = useState(false)
  const decide = useMutation({
    mutationFn: async ({ approve, offer, cover }: { approve: boolean; offer?: string; cover?: string }) =>
      unwrap(await supabase.rpc('decide_shift_change', { p_id: c.id, p_approve: approve, p_offer: offer ?? null, p_cover: cover ?? null, p_note: note.trim() || null })),
    onSuccess: (_, { approve }) => {
      toast(approve ? t('attendance.approved') : t('attendance.rejected'))
      void queryClient.invalidateQueries({ queryKey: ['shift_changes'] })
      void queryClient.invalidateQueries({ queryKey: ['shift_assignments'] })
      void queryClient.invalidateQueries({ queryKey: ['attendance'] })
      onClose()
    },
  })
  const limitMap = new Map(
    (limits.data ?? []).filter((l) => l.visa || l.weekly_limit_min).map((l) => [l.roster_name, l.visa ? VISA_LIMIT_MIN : l.weekly_limit_min!]),
  )
  const candidates = c.kind === 'late' || c.status !== 'open' ? [] : coverCandidates(c, rows.data ?? [], names.data ?? [], limitMap)
  const byName = new Map(candidates.map((x) => [x.name, x]))
  const offers = c.offers.filter((o) => o.status !== 'withdrawn')
  const checks = (name: string) => {
    const x = byName.get(name)
    if (!x) return null
    return (
      <span className="flex flex-wrap gap-x-2 text-xs">
        <span>{t('attendance.week', { h: Math.round((x.weekMin / 60) * 10) / 10 })}{x.limitMin ? ` / ${t('attendance.limit', { h: x.limitMin / 60 })}` : ''}</span>
        {x.overLimit && <b className="text-red-700">⚠ {t('attendance.overLimit')}</b>}
        {x.chainMin >= 12 * 60 && <b className="text-amber-700">⚠ {t('attendance.chain', { h: Math.round((x.chainMin / 60) * 10) / 10 })}</b>}
        {x.conflict && <b className="text-red-700">✗ {t('attendance.conflict')}</b>}
      </span>
    )
  }
  const pickedName = pick?.cover ?? offers.find((o) => o.id === pick?.offer)?.roster_name ?? null
  return (
    <Sheet title={`${c.roster_name} ・ ${label(c)}`} onClose={onClose}>
      <Card className="flex flex-col gap-1 text-sm">
        <p className="text-base font-bold">
          {dayText(c.business_date, t)} {t(`common:shift.${c.shift}`)} {formatRange(c)} {STORE_BY_MARK[c.store_mark]?.ja ?? c.store_mark}
        </p>
        <p>
          {REASON_ICON[c.reason]} {ts(`change.reason.${c.reason}`)}
          {c.note && `：${c.note}`}
        </p>
        {c.note_original && <p className="text-xs text-muted">{t('detail.original')}: {c.note_original}</p>}
        <p>
          📞 {jstDateTime(c.reported_at)}（{noticeText(ts, c.notice_min)}）{c.by_manager && ` ・ ${t('attendance.byManager')}`}
        </p>
        <p>
          <span className={cx('rounded-full px-2 py-0.5 font-bold', STATUS_STYLE[c.status])}>{ts(`change.status.${c.status}`)}</span>
          {c.cover_name && ` ・ ${ts('change.coveredBy', { name: c.cover_name })}`}
          {c.give_date && ` ・ 🔁 ${dayText(c.give_date, t)} ${t(`common:shift.${c.give_shift}`)}`}
        </p>
        {c.manager_note && <p>💬 {c.manager_note}</p>}
      </Card>

      {c.status === 'open' && c.proposed_cover && (
        <Card className="flex flex-col gap-1 border-2 border-brand">
          <h3 className="font-bold">🤝 {t('attendance.proposed', { name: c.proposed_cover })}</h3>
          {checks(c.proposed_cover)}
          <Button variant={pick?.cover === c.proposed_cover ? 'primary' : 'secondary'} className="min-h-10 py-1 text-sm" onClick={() => setPick({ cover: c.proposed_cover! })}>
            {t('attendance.chooseProposed')}
          </Button>
        </Card>
      )}
      {c.status === 'open' && c.kind !== 'late' && (
        <>
          <h3 className="font-bold">🙋 {t('attendance.offers', { n: offers.filter((o) => o.status === 'offered').length })}</h3>
          {offers.length === 0 && <p className="text-sm text-muted">{c.recruit ? t('attendance.noOffers') : t('attendance.notRecruiting')}</p>}
          <ul className="flex flex-col gap-1.5">
            {offers.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  disabled={o.status !== 'offered'}
                  onClick={() => setPick({ offer: o.id })}
                  className={cx('flex w-full flex-col gap-0.5 rounded-xl border-[1.5px] p-2.5 text-left', pick?.offer === o.id ? 'border-brand bg-brand-soft' : 'border-line bg-white', o.status !== 'offered' && 'opacity-50')}
                >
                  <b>
                    {o.roster_name} {o.give_date && `🔁 ${dayText(o.give_date, t)} ${t(`common:shift.${o.give_shift}`)}`}
                  </b>
                  {checks(o.roster_name)}
                  {o.note && <span className="text-xs text-muted">{o.note}</span>}
                </button>
              </li>
            ))}
          </ul>
          <h3 className="font-bold">👥 {t('attendance.candidates')}</h3>
          <p className="text-xs text-muted">{t('attendance.candidatesHelp')}</p>
          {rows.isLoading ? (
            <Spinner />
          ) : (
            <ul className="flex flex-col gap-1">
              {candidates
                .filter((x) => !x.conflict)
                .slice(0, showAll ? undefined : 8)
                .map((x) => (
                  <li key={x.name}>
                    <button
                      type="button"
                      onClick={() => setPick({ cover: x.name })}
                      className={cx('flex w-full items-center justify-between gap-2 rounded-xl border-[1.5px] px-2.5 py-2 text-left', pick?.cover === x.name ? 'border-brand bg-brand-soft' : 'border-line bg-white')}
                    >
                      <b>{x.name}</b>
                      {checks(x.name)}
                    </button>
                  </li>
                ))}
            </ul>
          )}
          {!showAll && candidates.filter((x) => !x.conflict).length > 8 && (
            <Button variant="ghost" onClick={() => setShowAll(true)}>
              {t('attendance.showAll')}
            </Button>
          )}
        </>
      )}

      {c.status === 'open' && (
        <Card className="flex flex-col gap-2">
          <TextArea label={t('attendance.managerNote')} value={note} onChange={(e) => setNote(e.target.value)} />
          {decide.error && <ErrorBox message={coverProblemOf(decide.error) ? problemText(coverProblemOf(decide.error)!) : errorMessage(decide.error)} />}
          {pickedName && (
            <Button onClick={() => decide.mutate({ approve: true, offer: pick?.offer, cover: pick?.cover })} disabled={decide.isPending}>
              ✅ {t('attendance.approveWith', { name: pickedName })}
            </Button>
          )}
          <Button variant={pickedName ? 'secondary' : 'primary'} onClick={() => decide.mutate({ approve: true })} disabled={decide.isPending}>
            {c.kind === 'late' ? `✅ ${t('attendance.confirm')}` : `✅ ${t('attendance.approveWithout')}`}
          </Button>
          <Button variant="danger" onClick={() => decide.mutate({ approve: false })} disabled={decide.isPending}>
            {t('attendance.reject')}
          </Button>
          <p className="text-xs text-muted">{t('attendance.decideHelp')}</p>
        </Card>
      )}
    </Sheet>
  )
}

/** A manager records a phone call: person → their shift → the usual form. */
function RecordCallSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('manager')
  const toast = useToast()
  const names = useRosterNames()
  const [name, setName] = useState('')
  const [shiftKey, setShiftKey] = useState('')
  const rows = useAssignments(addDays(today(), -7), addDays(today(), 31), Boolean(name))
  const theirs = (rows.data ?? []).filter((a) => a.roster_name === name)
  const shift = theirs.find((a) => `${a.business_date}|${a.shift}` === shiftKey)
  return (
    <Sheet title={t('attendance.recordCall')} onClose={onClose}>
      <label className="flex flex-col gap-1 font-bold">
        {t('attendance.person')}
        <select className="min-h-12 rounded-xl border border-slate-400 bg-white px-2 font-normal" value={name} onChange={(e) => { setName(e.target.value); setShiftKey('') }}>
          <option value="">—</option>
          {(names.data ?? []).map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      {name && (
        <label className="flex flex-col gap-1 font-bold">
          {t('attendance.shift')}
          <select className="min-h-12 rounded-xl border border-slate-400 bg-white px-2 font-normal" value={shiftKey} onChange={(e) => setShiftKey(e.target.value)}>
            <option value="">—</option>
            {theirs.map((a) => (
              <option key={a.id} value={`${a.business_date}|${a.shift}`}>
                {dayText(a.business_date, t)} {t(`common:shift.${a.shift}`)} {formatRange(a)} {STORE_BY_MARK[a.store_mark]?.short ?? a.store_mark}
              </option>
            ))}
          </select>
        </label>
      )}
      {shift && (
        <ChangeForm
          key={shiftKey}
          a={shift}
          rosterName={name}
          onDone={() => {
            toast(t('attendance.recorded'))
            onClose()
          }}
        />
      )}
    </Sheet>
  )
}

function ReportsTab() {
  const { t } = useTranslation('manager')
  const { t: ts } = useTranslation('shift')
  const label = useChangeLabel()
  const changes = useChanges(addDays(today(), -14), addDays(today(), 60))
  const [openId, setOpenId] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  if (changes.isLoading) return <Spinner />
  if (changes.error) return <ErrorBox message={errorMessage(changes.error)} />
  const all = changes.data ?? []
  const open = all.filter((c) => c.status === 'open')
  const done = all.filter((c) => c.status !== 'open').reverse()
  const selected = all.find((c) => c.id === openId) ?? null
  const item = (c: ChangeWithOffers) => (
    <li key={c.id}>
      <button type="button" onClick={() => setOpenId(c.id)} className={cx('flex w-full flex-col gap-0.5 rounded-xl border bg-white p-3 text-left active:bg-surface', c.status === 'open' && c.notice_min < 1440 ? 'border-red-300' : 'border-line')}>
        <span className="flex items-center justify-between gap-2">
          <b>
            {c.roster_name} ・ {label(c)}
          </b>
          <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-xs font-bold', STATUS_STYLE[c.status])}>{ts(`change.status.${c.status}`)}</span>
        </span>
        <span className="text-sm">
          {dayText(c.business_date, t)} {t(`common:shift.${c.shift}`)} {formatMin(c.start_min)}– {STORE_BY_MARK[c.store_mark]?.short ?? c.store_mark} ・ {REASON_ICON[c.reason]} {ts(`change.reason.${c.reason}`)}
        </span>
        <span className="text-xs text-muted">
          📞 {noticeText(ts, c.notice_min)}
          {c.status === 'open' && c.recruit && ` ・ 🙋 ${t('attendance.offers', { n: c.offers.filter((o) => o.status === 'offered').length })}`}
          {c.status === 'open' && c.proposed_cover && ` ・ 🤝 ${t('attendance.proposed', { name: c.proposed_cover })}`}
          {c.cover_name && ` ・ ${ts('change.coveredBy', { name: c.cover_name })}`}
        </span>
      </button>
    </li>
  )
  return (
    <div className="flex flex-col gap-3">
      <Button variant="secondary" onClick={() => setRecording(true)}>
        📞 {t('attendance.recordCall')}
      </Button>
      <h2 className="font-bold">{t('attendance.openTitle', { n: open.length })}</h2>
      {open.length === 0 ? <p className="text-sm text-muted">{t('attendance.noOpen')}</p> : <ul className="flex flex-col gap-2">{open.map(item)}</ul>}
      <h2 className="font-bold">{t('attendance.doneTitle')}</h2>
      {done.length === 0 ? <p className="text-sm text-muted">{t('stats.noData')}</p> : <ul className="flex flex-col gap-2">{done.map(item)}</ul>}
      {selected && <DecideSheet key={selected.id} c={selected} onClose={() => setOpenId(null)} />}
      {recording && <RecordCallSheet onClose={() => setRecording(false)} />}
    </div>
  )
}

/** One person: events (exclude / change points with a note) and the weekly limit. */
function PersonSheet({ name, events, onClose }: { name: string; events: AttendanceEvent[]; onClose: () => void }) {
  const { t } = useTranslation('manager')
  const { t: ts } = useTranslation('shift')
  const queryClient = useQueryClient()
  const limits = useLimits()
  const current = limits.data?.find((l) => l.roster_name === name)
  const [limitH, setLimitH] = useState<string | null>(null)
  const [editing, setEditing] = useState<AttendanceEvent | null>(null)
  const [points, setPoints] = useState('')
  const [excluded, setExcluded] = useState(false)
  const [note, setNote] = useState('')
  const saveLimit = useMutation({
    mutationFn: async () => {
      const h = Number(limitH)
      if (!limitH?.trim()) unwrap(await supabase.from('staff_limits').delete().eq('roster_name', name))
      else unwrap(await supabase.from('staff_limits').upsert({ roster_name: name, weekly_limit_min: Math.round(h * 60) }))
    },
    onSuccess: () => {
      setLimitH(null)
      void queryClient.invalidateQueries({ queryKey: ['admin', 'staff_limits'] })
    },
  })
  const saveOverride = useMutation({
    mutationFn: async (reset: boolean) => {
      if (reset) unwrap(await supabase.from('attendance_overrides').delete().eq('event_key', editing!.event_key))
      else
        unwrap(
          await supabase.from('attendance_overrides').upsert({
            event_key: editing!.event_key,
            excluded,
            points: excluded || points.trim() === '' ? null : Number(points),
            note: note.trim() || null,
          }),
        )
    },
    onSuccess: () => {
      setEditing(null)
      void queryClient.invalidateQueries({ queryKey: ['attendance'] })
    },
  })
  return (
    <Sheet title={`${name} ・ ${t('attendance.scoreTitle')}`} onClose={onClose}>
      <ScoreView events={events} name={name} />
      <Card className="flex flex-col gap-2">
        <h3 className="font-bold">✏️ {t('attendance.adjust')}</h3>
        <p className="text-xs text-muted">{t('attendance.adjustHelp')}</p>
        <ul className="flex flex-col gap-1">
          {events
            .filter((e) => e.roster_name === name)
            .map((e) => (
              <li key={e.event_key}>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(e)
                    setExcluded(e.excluded)
                    setPoints(e.points === e.base_points || e.excluded ? '' : String(e.points))
                    setNote(e.note ?? '')
                  }}
                  className="flex w-full justify-between gap-2 rounded-lg bg-surface px-2 py-1.5 text-left text-sm"
                >
                  <span>
                    {e.kind === 'perfect' ? e.business_date.slice(0, 7) : dayText(e.business_date, t)} {ts(`score.label.${labelOf(e)}`)}
                  </span>
                  <b>
                    {e.excluded ? ts('score.excluded') : e.points}
                    {e.points !== e.base_points && !e.excluded && `（${t('attendance.base')} ${e.base_points}）`}
                  </b>
                </button>
              </li>
            ))}
        </ul>
        {editing && (
          <div className="flex flex-col gap-2 rounded-xl border-2 border-brand p-2">
            <b>
              {dayText(editing.business_date, t)} {ts(`score.label.${labelOf(editing)}`)}（{t('attendance.base')} {editing.base_points}）
            </b>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="size-5" checked={excluded} onChange={(e) => setExcluded(e.target.checked)} />
              {t('attendance.exclude')}
            </label>
            {!excluded && <TextInput type="number" label={t('attendance.points')} value={points} onChange={(e) => setPoints(e.target.value)} placeholder={String(editing.base_points)} />}
            <TextInput label={t('attendance.note')} value={note} onChange={(e) => setNote(e.target.value)} />
            {saveOverride.error && <ErrorBox message={errorMessage(saveOverride.error)} />}
            <Button onClick={() => saveOverride.mutate(false)} disabled={saveOverride.isPending}>
              {t('attendance.save')}
            </Button>
            <Button variant="secondary" onClick={() => saveOverride.mutate(true)} disabled={saveOverride.isPending}>
              {t('attendance.reset')}
            </Button>
          </div>
        )}
      </Card>
      <Card className="flex flex-col gap-2">
        <h3 className="font-bold">⏱️ {t('attendance.limitTitle')}</h3>
        <p className="text-xs text-muted">{t('attendance.limitHelp')}</p>
        {current?.visa && <p className="rounded-lg bg-violet-50 p-2 text-sm font-bold text-violet-900">🎓 {t(`users.visa.${current.visa}`)}: {t('attendance.visaLimit')}</p>}
        <div className="flex items-end gap-2">
          <TextInput
            type="number"
            label={t('attendance.limitHours')}
            value={limitH ?? (current?.weekly_limit_min ? String(current.weekly_limit_min / 60) : '')}
            onChange={(e) => setLimitH(e.target.value)}
          />
          <Button onClick={() => saveLimit.mutate()} disabled={limitH === null || saveLimit.isPending}>
            {t('attendance.save')}
          </Button>
        </div>
        {saveLimit.error && <ErrorBox message={errorMessage(saveLimit.error)} />}
      </Card>
    </Sheet>
  )
}

function ScoresTab() {
  const { t } = useTranslation('manager')
  const events = useAttendance()
  const names = useRosterNames()
  const [who, setWho] = useState<string | null>(null)
  if (events.isLoading || names.isLoading) return <Spinner />
  if (events.error) return <ErrorBox message={errorMessage(events.error)} />
  const scores = attendanceScores(events.data ?? [], names.data ?? [])
  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-xl bg-sky-50 p-3 text-sm font-bold whitespace-pre-line text-sky-900">{t('attendance.how', { n: WINDOW_DAYS })}</p>
      <Card className="overflow-x-auto p-2">
        <table className="w-full min-w-[22rem] text-sm">
          <thead className="text-xs text-slate-600">
            <tr>
              <th className="text-left">{t('stats.name')}</th>
              <th>{t('attendance.score')}</th>
              <th>{t('attendance.col.noShow')}</th>
              <th>{t('attendance.col.sameDay')}</th>
              <th>{t('attendance.col.late')}</th>
              <th>{t('attendance.col.early')}</th>
              <th>{t('attendance.col.cover')}</th>
            </tr>
          </thead>
          <tbody>
            {scores.map((s) => (
              <tr key={s.name} className="border-t border-slate-100 text-center">
                <td className="py-1 text-left">
                  <button type="button" onClick={() => setWho(s.name)} className="min-h-9 text-left font-bold underline decoration-dotted underline-offset-2">
                    {s.urgent && '⚠ '}
                    {s.name}
                  </button>
                </td>
                <td>
                  <span className={cx('rounded-full px-2 py-0.5 font-bold', GRADE_STYLE[s.grade])}>
                    {s.score} {s.grade}
                  </span>
                </td>
                <td className={s.counts.noShow ? 'font-bold text-red-700' : 'text-slate-400'}>{s.counts.noShow}</td>
                <td className={s.counts.sameDay ? 'font-bold' : 'text-slate-400'}>{s.counts.sameDay}</td>
                <td className={s.counts.late ? 'font-bold' : 'text-slate-400'}>{s.counts.late}</td>
                <td className={s.counts.early ? 'font-bold' : 'text-slate-400'}>{s.counts.early}</td>
                <td className={s.counts.cover ? 'font-bold text-green-700' : 'text-slate-400'}>{s.counts.cover}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-muted">{t('attendance.legalNote')}</p>
      {who && <PersonSheet name={who} events={events.data ?? []} onClose={() => setWho(null)} />}
    </div>
  )
}

/** 管理 → 出勤: 休み・遅刻・早退の連絡 (approve with a replacement) and 出勤評価. */
export function AttendanceAdminPage() {
  const { t } = useTranslation('manager')
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'score' ? 'score' : 'reports'
  return (
    <div className="flex flex-col gap-3">
      <ManagerTabs />
      <PageTitle title={t('attendance.title')} />
      <Segmented
        label=""
        value={tab}
        onChange={(v) => setParams(v === 'reports' ? {} : { tab: v }, { replace: true })}
        options={[
          { value: 'reports', label: t('attendance.tabReports') },
          { value: 'score', label: t('attendance.tabScore') },
        ]}
      />
      {tab === 'reports' ? <ReportsTab /> : <ScoresTab />}
    </div>
  )
}
