import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { useMe } from '../../app/auth'
import { Sheet } from '../../components/Sheet'
import { useToast } from '../../components/Toast'
import { Button, Card, ErrorBox, PageTitle, Segmented, SectionTitle, Spinner } from '../../components/ui'
import { attendanceScores, GRADE_STYLE, labelOf, WINDOW_DAYS, type AttendanceEvent } from '../../domain/attendance'
import { chainMinutes, formatMin, LONG_CHAIN_MIN, type Assignment } from '../../domain/schedule'
import { coverPart, coverProblemOf, REASON_ICON, reportable, type Recruit } from '../../domain/shiftChange'
import { cx } from '../../lib/cx'
import { errorMessage } from '../../lib/format'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { useMySchedule } from '../schedule/data'
import { ShiftChip, StoreLabel, TimeRange } from '../schedule/parts'
import { hours, useDayLabel } from '../schedule/style'
import { ChangeForm } from './ChangeForm'
import { noticeText, STATUS_STYLE, useAttendance, useChangeLabel, useMyChanges, useProblemText, useRecruits, type ChangeWithOffers } from './changeData'

type Tab = 'report' | 'recruit' | 'score'

/** One shift as a line: 10/15(木) 早番 7:00–17:00 千日前店 */
function ShiftLine({ a }: { a: Assignment }) {
  const dayLabel = useDayLabel()
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <b>{dayLabel(a.business_date)}</b>
      <ShiftChip shift={a.shift} />
      <TimeRange a={a} />
      <StoreLabel mark={a.store_mark} />
    </span>
  )
}

function MyChange({ c }: { c: ChangeWithOffers }) {
  const { t } = useTranslation('shift')
  const toast = useToast()
  const queryClient = useQueryClient()
  const label = useChangeLabel()
  const cancel = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('cancel_shift_change', { p_id: c.id })),
    onSuccess: () => {
      toast(t('change.cancelled'))
      void queryClient.invalidateQueries({ queryKey: ['shift_changes'] })
    },
  })
  const offers = c.offers.filter((o) => o.status === 'offered').length
  return (
    <li className="flex flex-col gap-1.5 rounded-xl border border-line bg-white p-3">
      <span className="flex items-start justify-between gap-2">
        <ShiftLine a={c} />
        <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-sm font-bold', STATUS_STYLE[c.status])}>{t(`change.status.${c.status}`)}</span>
      </span>
      <span className="font-bold">
        {label(c)} ・ {REASON_ICON[c.reason]} {t(`change.reason.${c.reason}`)}
      </span>
      {c.note && <span className="text-sm text-muted">{c.note_original ?? c.note}</span>}
      {c.status === 'open' && c.proposed_cover && <span className="text-sm font-bold text-brand-dark">🤝 {t('change.namedPending', { name: c.proposed_cover })}</span>}
      {c.status === 'open' && c.recruit && <span className="text-sm">🙋 {offers ? t('change.offersN', { n: offers }) : t('change.waiting')}</span>}
      {c.status === 'approved' && c.kind !== 'late' && (
        <span className="text-sm font-bold text-green-800">{c.cover_name ? `✅ ${t('change.coveredBy', { name: c.cover_name })}` : `✅ ${t('change.approvedNoCover')}`}</span>
      )}
      {c.give_date && (
        <span className="text-sm font-bold text-violet-800">
          🔁 {t('change.swapGot', { date: c.give_date.slice(5).replace('-', '/'), shift: t(`common:shift.${c.give_shift}`) })}
        </span>
      )}
      {c.manager_note && <span className="rounded-lg bg-surface px-2 py-1 text-sm">💬 {c.manager_note}</span>}
      {c.status === 'open' && (
        <Button variant="secondary" className="min-h-10 py-1 text-sm" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
          {t('change.cancel')}
        </Button>
      )}
      {cancel.error && <ErrorBox message={errorMessage(cancel.error)} />}
    </li>
  )
}

function ReportTab() {
  const { t } = useTranslation('shift')
  const me = useMe()
  const schedule = useMySchedule(me.roster_name)
  const mine = useMyChanges(me.roster_name)
  const [picked, setPicked] = useState<string | null>(null)
  const toast = useToast()
  if (schedule.isLoading || mine.isLoading) return <Spinner />
  const active = new Map((mine.data ?? []).filter((c) => c.status === 'open' || c.status === 'approved').map((c) => [`${c.business_date}|${c.shift}`, c]))
  const shifts = reportable(schedule.data ?? [], new Date())
  const pickedShift = shifts.find((a) => `${a.business_date}|${a.shift}` === picked) ?? null
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <SectionTitle>{t('change.pickShift')}</SectionTitle>
        {shifts.length === 0 ? (
          <p className="text-muted">{t('change.noShifts')}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {shifts.map((a) => {
              const key = `${a.business_date}|${a.shift}`
              const done = active.get(key)
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    disabled={Boolean(done)}
                    onClick={() => setPicked(key)}
                    className="flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-white p-3 text-left active:bg-surface disabled:bg-surface"
                  >
                    <ShiftLine a={a} />
                    {done ? (
                      <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-sm font-bold', STATUS_STYLE[done.status])}>{t(`change.status.${done.status}`)}</span>
                    ) : (
                      <span aria-hidden className="text-xl text-slate-500">
                        ›
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      {(mine.data ?? []).length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionTitle>{t('change.mine')}</SectionTitle>
          <ul className="flex flex-col gap-2">
            {mine.data!.map((c) => (
              <MyChange key={c.id} c={c} />
            ))}
          </ul>
        </section>
      )}
      {pickedShift && (
        <Sheet title={<ShiftLine a={pickedShift} />} onClose={() => setPicked(null)}>
          <ChangeForm
            a={pickedShift}
            onDone={() => {
              setPicked(null)
              toast(t('change.sent'))
            }}
          />
        </Sheet>
      )}
    </div>
  )
}

function RecruitCardItem({ r, mySchedule }: { r: Recruit; mySchedule: (Assignment & { id: string })[] }) {
  const { t } = useTranslation('shift')
  const toast = useToast()
  const queryClient = useQueryClient()
  const label = useChangeLabel()
  const dayLabel = useDayLabel()
  const [give, setGive] = useState('')
  const problemText = useProblemText()
  const part = coverPart({ ...r, leave_min: r.kind === 'early_leave' ? r.start_min : null })
  const chain = chainMinutes([...mySchedule, part]).get(part) ?? 0
  const giveable = reportable(mySchedule, new Date())
  const done = () => void queryClient.invalidateQueries({ queryKey: ['shift_recruits'] })
  const offer = useMutation({
    mutationFn: async () => {
      const [d, s] = give ? give.split('|') : [null, null]
      unwrap(await supabase.rpc('offer_shift_cover', { p_change: r.id, p_give_date: d, p_give_shift: s }))
    },
    onSuccess: () => {
      toast(t('change.offered'))
      done()
    },
  })
  const withdraw = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('withdraw_shift_offer', { p_offer: r.my_offer_id! })),
    onSuccess: done,
  })
  const state = r.assigned
    ? 'assigned'
    : r.designated && r.status === 'open'
      ? 'designated'
      : r.my_offer_status === 'offered'
        ? 'offered'
        : r.my_offer_status === 'declined' || (r.status !== 'open' && (r.my_offer_id || r.designated))
          ? 'declined'
          : 'open'
  const over = r.my_over_min !== null && state === 'open'
  return (
    <li className={cx('flex flex-col gap-2 rounded-xl border bg-white p-3', state === 'assigned' ? 'border-green-400' : 'border-line')}>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <b>{dayLabel(r.business_date)}</b>
        <ShiftChip shift={r.shift} />
        <TimeRange a={r} />
        <StoreLabel mark={r.store_mark} />
      </span>
      <span className="text-sm">
        {t('change.recruitFrom', { name: r.roster_name })}（{label({ kind: r.kind, late_min: null, leave_min: r.kind === 'early_leave' ? r.start_min : null })}）
        {r.swap_ok && ` ・ 🔁 ${t('change.swapPossible')}`}
      </span>
      {chain >= LONG_CHAIN_MIN && <p className="rounded-lg bg-amber-50 px-2 py-1 text-sm font-bold text-amber-900">⚠️ {t('schedule.long', { h: hours(chain) })}</p>}
      {state === 'assigned' && <p className="font-bold text-green-800">✅ {t('change.youCover')}</p>}
      {state === 'designated' && <p className="font-bold text-brand-dark">🤝 {t('change.designatedYou', { name: r.roster_name })}</p>}
      {over && <p className="rounded-lg bg-red-50 px-2 py-1.5 text-sm font-bold text-red-800">✗ {t('change.visaBlockedYou', { h: Math.round((r.my_over_min! / 60) * 10) / 10 })}</p>}
      {state === 'declined' && <p className="text-sm text-muted">{t('change.otherChosen')}</p>}
      {state === 'offered' && (
        <>
          <p className="font-bold text-brand-dark">
            🙋 {t('change.offeredWait')}
            {r.my_give_date && ` ・ 🔁 ${dayLabel(r.my_give_date)} ${t(`common:shift.${r.my_give_shift}`)}`}
          </p>
          <Button variant="secondary" className="min-h-10 py-1 text-sm" onClick={() => withdraw.mutate()} disabled={withdraw.isPending}>
            {t('change.withdraw')}
          </Button>
        </>
      )}
      {state === 'open' && !over && (
        <>
          {r.swap_ok && giveable.length > 0 && (
            <label className="flex flex-col gap-1 text-sm font-bold">
              🔁 {t('change.giveLabel')}
              <select className="min-h-11 rounded-xl border border-slate-400 bg-white px-2 font-normal" value={give} onChange={(e) => setGive(e.target.value)}>
                <option value="">{t('change.giveNone')}</option>
                {giveable.map((a) => (
                  <option key={a.id} value={`${a.business_date}|${a.shift}`}>
                    {dayLabel(a.business_date)} {t(`common:shift.${a.shift}`)} {formatMin(a.start_min)}–{formatMin(a.end_min)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button onClick={() => offer.mutate()} disabled={offer.isPending}>
            🙋 {t('change.offer')}
          </Button>
        </>
      )}
      {(offer.error ?? withdraw.error) && (
        <ErrorBox message={coverProblemOf(offer.error) ? problemText(coverProblemOf(offer.error)!) : errorMessage(offer.error ?? withdraw.error)} />
      )}
    </li>
  )
}

function RecruitTab() {
  const { t } = useTranslation('shift')
  const me = useMe()
  const schedule = useMySchedule(me.roster_name)
  const recruits = useRecruits()
  if (recruits.isLoading || schedule.isLoading) return <Spinner />
  const list = recruits.data ?? []
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">{t('change.recruitHelp')}</p>
      {list.length === 0 ? (
        <p className="rounded-xl bg-surface p-4 text-center text-muted">{t('change.noRecruits')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((r) => (
            <RecruitCardItem key={r.id} r={r} mySchedule={schedule.data ?? []} />
          ))}
        </ul>
      )}
    </div>
  )
}

/** 出勤評価: score, the rules, and the events behind it. Used by staff (own) and managers. */
export function ScoreView({ events, name }: { events: AttendanceEvent[]; name: string }) {
  const { t } = useTranslation('shift')
  const dayLabel = useDayLabel()
  const [s] = attendanceScores(events.filter((e) => e.roster_name === name), [name])
  if (!s) return null
  return (
    <div className="flex flex-col gap-3">
      <Card className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-muted">{t('score.title', { n: WINDOW_DAYS })}</p>
          <p className="text-4xl font-bold tabular-nums">{s.score}</p>
        </div>
        <span className={cx('rounded-2xl px-5 py-3 text-3xl font-bold', GRADE_STYLE[s.grade])}>{s.grade}</span>
      </Card>
      <p className="text-sm text-muted">{t(`score.gradeHint.${s.grade}`)}</p>
      <section className="flex flex-col gap-1.5">
        <SectionTitle>{t('score.events')}</SectionTitle>
        {s.events.length === 0 ? (
          <p className="text-muted">{t('score.noEvents')}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {[...s.events].reverse().map((e) => (
              <li key={e.event_key} className={cx('flex items-start justify-between gap-2 rounded-xl border border-line bg-white p-2.5', e.excluded && 'opacity-60')}>
                <span className="flex flex-col">
                  <b>
                    {e.kind === 'perfect' ? e.business_date.slice(0, 7) : dayLabel(e.business_date)} {e.shift && t(`common:shift.${e.shift}`)}
                  </b>
                  <span className="text-sm">
                    {t(`score.label.${labelOf(e)}`)}
                    {e.kind === 'late' && e.minutes ? ` ${t('change.minutes', { n: e.minutes })}` : ''}
                    {e.notice_min !== null && e.kind !== 'cover' && ` ・ ${noticeText(t, e.notice_min)}`}
                    {e.notice_min === null && !e.reported && ` ・ ${t('score.notReported')}`}
                  </span>
                  {e.note && <span className="text-sm text-muted">💬 {e.note}</span>}
                </span>
                <b className={cx('shrink-0 text-lg tabular-nums', e.points < 0 ? 'text-red-700' : e.points > 0 ? 'text-green-700' : 'text-slate-500')}>
                  {e.excluded ? t('score.excluded') : e.points > 0 ? `+${e.points}` : e.points}
                </b>
              </li>
            ))}
          </ul>
        )}
      </section>
      <details className="rounded-xl border border-line bg-white p-3">
        <summary className="cursor-pointer font-bold">📏 {t('score.rulesTitle')}</summary>
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {(t('score.rules', { returnObjects: true }) as string[]).map((r) => (
            <li key={r}>・{r}</li>
          ))}
        </ul>
      </details>
    </div>
  )
}

function ScoreTab() {
  const me = useMe()
  const events = useAttendance()
  if (events.isLoading) return <Spinner />
  if (events.error) return <ErrorBox message={errorMessage(events.error)} />
  return <ScoreView events={events.data ?? []} name={me.roster_name!} />
}

/** メニュー → 休み・遅刻の連絡: report, 代わり募集, 出勤の評価. */
export function AbsencePage() {
  const { t } = useTranslation('shift')
  const me = useMe()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab | null) ?? 'report'
  const recruits = useRecruits(Boolean(me.roster_name))
  const openCount = (recruits.data ?? []).filter((r) => r.status === 'open' && !r.my_offer_id && r.my_over_min === null).length
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title={t('change.title')} subtitle={t('change.subtitle')} />
      {!me.roster_name ? (
        <p className="rounded-xl bg-amber-50 p-4 font-bold text-amber-900">{t('change.noRosterName')}</p>
      ) : (
        <>
          <Segmented
            label=""
            value={tab}
            onChange={(v) => setParams(v === 'report' ? {} : { tab: v }, { replace: true })}
            options={[
              { value: 'report', label: t('change.tabReport') },
              { value: 'recruit', label: `${t('change.tabRecruit')}${openCount ? ` (${openCount})` : ''}` },
              { value: 'score', label: t('change.tabScore') },
            ]}
          />
          {tab === 'report' && <ReportTab />}
          {tab === 'recruit' && <RecruitTab />}
          {tab === 'score' && <ScoreTab />}
        </>
      )}
    </div>
  )
}
