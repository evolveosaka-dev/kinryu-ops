import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { Button, Card, ErrorBox, PageTitle, Spinner, TextArea, TextInput } from '../../components/ui'
import { addDays, formatShortDate } from '../../domain/time'
import {
  ESCALATION_STEPS,
  escalationStep,
  ISSUE_CATEGORIES,
  ISSUE_WINDOW_DAYS,
  type IssueCategory,
  type IssueStatus,
} from '../../domain/issues'
import { currentLocale } from '../../i18n'
import { cx } from '../../lib/cx'
import { errorMessage, storeName } from '../../lib/format'
import { unwrap, useRoster, useStores } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { Dot } from './common'
import { JUDGE_STYLE, today, useIssueStatus, usePeople, type AdminPatrol } from './data'
import { PatrolDetail } from './details'
import { ManagerTabs } from './ManagerTabs'

interface Interview {
  id: string
  staff_name: string
  category: IssueCategory
  held_on: string
  interviewer_id: string
  interviewer_name: string
  note: string
  measure: string
  created_at: string
}

const selectClass = 'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2'

function AlertCard({ s, onPick }: { s: IssueStatus; onPick?: () => void }) {
  const { t } = useTranslation('manager')
  const [advice, setAdvice] = useState<string | null>(null)
  const ai = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<{ text: string }>('staff-ai', {
        body: { action: 'measures', staff: s.staff, category: s.category },
      })
      if (error || !data) throw new Error(error?.message ?? 'AI failed')
      return data.text
    },
    onSuccess: setAdvice,
  })
  const escalate = s.level === 'escalate'
  return (
    <li className={cx('flex flex-col gap-1.5 rounded-xl p-2.5 text-sm ring-1', escalate ? 'bg-red-50 ring-red-300' : 'bg-amber-50 ring-amber-300')}>
      <p className="flex flex-wrap items-center gap-2 font-bold">
        <Dot tone={escalate ? 'red' : 'amber'} />
        {onPick ? (
          <button type="button" className="text-brand underline" onClick={onPick}>
            {s.staff}
          </button>
        ) : (
          s.staff
        )}
        <span>（{t(`patrol:issues.cat.${s.category}`)}）</span>
        <span className="rounded bg-white px-1.5 text-xs">{escalate ? t('staff.levelEscalate') : t('staff.levelInterview')}</span>
      </p>
      <p>{escalate ? t('staff.escalate', { interviews: s.interviews, n: s.occurrences }) : t('staff.interviewNeeded', { n: s.occurrences })}</p>
      {escalate && (
        <>
          <p>
            <b>{t('staff.nextStep')}:</b> {escalationStep(s.interviews)}
          </p>
          {advice ? (
            <p lang="ja" className="whitespace-pre-wrap rounded-lg bg-white p-2 leading-relaxed">
              {advice}
            </p>
          ) : (
            <Button variant="secondary" className="min-h-10 self-start px-3 text-sm" onClick={() => ai.mutate()} disabled={ai.isPending}>
              {ai.isPending ? t('staff.aiLoading') : t('staff.ai')}
            </Button>
          )}
          {ai.error && <ErrorBox message={errorMessage(ai.error)} />}
        </>
      )}
    </li>
  )
}

function InterviewForm({ staff, statuses }: { staff: string; statuses: IssueStatus[] }) {
  const { t } = useTranslation('manager')
  const queryClient = useQueryClient()
  const alert = statuses.find((s) => s.level)
  const [category, setCategory] = useState<IssueCategory>(alert?.category ?? 'voice')
  const [heldOn, setHeldOn] = useState(today())
  const [note, setNote] = useState('')
  const [measure, setMeasure] = useState('')
  const current = statuses.find((s) => s.category === category)
  const add = useMutation({
    mutationFn: async () =>
      unwrap(
        await supabase.from('staff_interviews').insert({ staff_name: staff, category, held_on: heldOn, note: note.trim(), measure: measure.trim() }),
      ),
    onSuccess: () => {
      setNote('')
      setMeasure('')
      void queryClient.invalidateQueries({ queryKey: ['staff'] })
    },
  })
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line p-2.5">
      <h3 className="font-bold">{t('staff.addInterview')}</h3>
      <label className="text-sm font-bold">
        {t('staff.category')}
        <select className={selectClass} value={category} onChange={(e) => setCategory(e.target.value as IssueCategory)}>
          {ISSUE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`patrol:issues.cat.${c}`)}
            </option>
          ))}
        </select>
      </label>
      <TextInput label={t('staff.heldOn')} type="date" value={heldOn} max={today()} onChange={(e) => setHeldOn(e.target.value)} />
      <TextArea label={t('staff.note')} placeholder={t('staff.notePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} />
      <TextArea label={t('staff.measure')} placeholder={t('staff.measurePlaceholder')} value={measure} onChange={(e) => setMeasure(e.target.value)} maxLength={1000} />
      {current?.interviews ? (
        <button type="button" className="min-h-9 self-start text-sm font-bold text-brand underline" onClick={() => setMeasure(escalationStep(current.interviews))}>
          {t('staff.useStep')}
        </button>
      ) : null}
      <Button onClick={() => add.mutate()} disabled={add.isPending || !heldOn || !note.trim()}>
        {t('staff.save')}
      </Button>
      {add.error && <ErrorBox message={errorMessage(add.error)} />}
    </div>
  )
}

function StaffDetail({ staff }: { staff: string }) {
  const { t } = useTranslation('manager')
  const queryClient = useQueryClient()
  const stores = useStores()
  const people = usePeople()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const status = useIssueStatus(staff)
  const patrols = useQuery({
    queryKey: ['staff', 'patrols', staff],
    queryFn: async () =>
      unwrap<AdminPatrol[]>(
        await supabase
          .from('patrol_checks')
          .select('*, attachments(id, kind, status, drive_url), comments:patrol_comments(id, body, author_id, author_name, created_at, read_at)')
          .eq('status', 'valid')
          .eq('is_test', false)
          .contains('staff_names', [staff])
          .order('business_date', { ascending: false })
          .order('started_at', { ascending: false })
          .order('created_at', { referencedTable: 'comments' })
          .limit(100),
      ),
  })
  const interviews = useQuery({
    queryKey: ['staff', 'interviews', staff],
    queryFn: async () =>
      unwrap<Interview[]>(await supabase.from('staff_interviews').select('*').eq('staff_name', staff).order('held_on', { ascending: false })),
  })
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('staff_interviews').delete().eq('id', id)),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['staff'] }),
  })

  if (status.isLoading || patrols.isLoading || interviews.isLoading) return <Spinner />
  const error = status.error ?? patrols.error ?? interviews.error
  if (error) return <ErrorBox message={errorMessage(error)} />

  const list = patrols.data ?? []
  const rows = status.data ?? []
  const since = addDays(today(), -ISSUE_WINDOW_DAYS)
  const count = (c: IssueCategory, from?: string) =>
    list.filter((p) => (!from || p.business_date > from) && p.issue_tags?.some((x) => x.staff === staff && x.category === c)).length
  const selected = list.find((p) => p.id === selectedId) ?? null
  const storeLabel = (id: string) => storeName(stores.data?.find((s) => s.id === id), currentLocale())

  return (
    <>
      {rows.some((s) => s.level) && (
        <ul className="flex flex-col gap-2">
          {rows
            .filter((s) => s.level)
            .map((s) => (
              <AlertCard key={s.category} s={s} />
            ))}
        </ul>
      )}

      <Card className="flex flex-col gap-2">
        <h2 className="font-bold">{t('staff.counts')}</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-600">
              <th className="py-1 font-semibold">{t('staff.category')}</th>
              <th className="py-1 text-right font-semibold">{t('staff.last30')}</th>
              <th className="py-1 text-right font-semibold">{t('staff.sinceInterview')}</th>
              <th className="py-1 text-right font-semibold">{t('staff.total')}</th>
            </tr>
          </thead>
          <tbody>
            {ISSUE_CATEGORIES.map((c) => {
              const s = rows.find((r) => r.category === c)
              const last30 = count(c, since)
              return (
                <tr key={c} className={cx('border-t border-line', s?.level && 'font-bold text-red-800')}>
                  <td className="py-1.5">{t(`patrol:issues.cat.${c}`)}</td>
                  <td className="py-1.5 text-right">{last30 || '—'}</td>
                  <td className="py-1.5 text-right">{s?.last_interview ? count(c, s.last_interview) : '—'}</td>
                  <td className="py-1.5 text-right">{count(c) || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="font-bold">{t('staff.interviews')}</h2>
        {interviews.data?.length ? (
          <ul className="flex flex-col gap-2">
            {interviews.data.map((i) => (
              <li key={i.id} className="rounded-lg bg-slate-50 p-2 text-sm">
                <p className="font-bold">
                  {formatShortDate(i.held_on)} ・ {t(`patrol:issues.cat.${i.category}`)}
                  <span className="font-normal text-slate-600">
                    {' '}
                    ・ {t('staff.by')} {i.interviewer_name || people.name(i.interviewer_id)}
                  </span>
                </p>
                <p className="whitespace-pre-wrap">{i.note}</p>
                {i.measure && (
                  <p className="whitespace-pre-wrap">
                    <b>{t('staff.measure')}:</b> {i.measure}
                  </p>
                )}
                <button
                  type="button"
                  className="min-h-9 text-xs text-slate-600 underline"
                  onClick={() => window.confirm(t('staff.deleteConfirm')) && remove.mutate(i.id)}
                  disabled={remove.isPending}
                >
                  {t('staff.delete')}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-600">{t('staff.noInterviews')}</p>
        )}
        {remove.error && <ErrorBox message={errorMessage(remove.error)} />}
        <InterviewForm key={staff} staff={staff} statuses={rows} />
      </Card>

      <h2 className="font-bold">{t('staff.patrols', { n: list.length })}</h2>
      {list.length === 0 && <p className="text-sm text-slate-600">{t('staff.noPatrols')}</p>}
      <ul className="flex flex-col gap-2">
        {list.map((p) => {
          const mine = p.issue_tags?.filter((x) => x.staff === staff) ?? []
          return (
            <li key={p.id}>
              <button type="button" onClick={() => setSelectedId(p.id)} className="flex w-full flex-col gap-1 rounded-xl bg-white p-2.5 text-left text-sm ring-1 ring-line">
                <span className="flex items-center justify-between gap-2 font-bold">
                  <span>
                    {formatShortDate(p.business_date)} {t(`common:shift.${p.shift}`)} {storeLabel(p.store_id)}
                  </span>
                  {p.judgement && (
                    <span className={cx('rounded px-1.5 text-xs', JUDGE_STYLE[p.judgement])}>
                      {p.total}/{p.max_total} {t(`common:judgement.${p.judgement}`)}
                    </span>
                  )}
                </span>
                <span>
                  <b className="text-green-800">{t('patrol:goodPoints.label')}:</b> {p.good_points}
                </span>
                <span>
                  <b className="text-red-800">{t('patrol:improvements.label')}:</b> {p.improvements}
                </span>
                <span className="text-xs text-slate-700">
                  {t('staff.thisPerson')}:{' '}
                  {p.issue_tags === null
                    ? t('staff.notTagged')
                    : mine.length
                      ? mine.map((x) => t(`patrol:issues.cat.${x.category}`)).join('、')
                      : t('patrol:issues.all')}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {selected && <PatrolDetail patrol={selected} patrollerName={people.name(selected.patroller_id)} onClose={() => setSelectedId(null)} />}
    </>
  )
}

export function StaffPage() {
  const { t } = useTranslation('manager')
  const [params, setParams] = useSearchParams()
  const roster = useRoster()
  const all = useIssueStatus()
  const name = params.get('name') ?? ''
  const pick = (n: string) => setParams(n ? { name: n } : {}, { replace: true })

  const names = [...new Set([...(roster.data ?? []).map((r) => r.name), ...(all.data ?? []).map((s) => s.staff)])].sort((a, b) => a.localeCompare(b, 'ja'))
  const alerts = (all.data ?? []).filter((s) => s.level).sort((a, b) => (a.level === b.level ? b.occurrences - a.occurrences : a.level === 'escalate' ? -1 : 1))

  return (
    <div className="flex flex-col gap-3">
      <ManagerTabs />
      <PageTitle title={t('staff.title')} />
      <p className="text-sm text-slate-600">{t('staff.rule')}</p>

      <Card className="flex flex-col gap-2">
        <h2 className="font-bold">{t('staff.alerts')}</h2>
        {all.isLoading ? (
          <Spinner />
        ) : all.error ? (
          <ErrorBox message={errorMessage(all.error)} />
        ) : alerts.length ? (
          <ul className="flex flex-col gap-2">
            {alerts.map((s) => (
              <AlertCard key={`${s.staff}:${s.category}`} s={s} onPick={() => pick(s.staff)} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-600">{t('staff.noAlerts')}</p>
        )}
        <details className="text-sm">
          <summary className="min-h-9 cursor-pointer font-bold text-slate-700">{t('staff.ladder')}</summary>
          <ol className="list-decimal pl-5">
            {ESCALATION_STEPS.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </details>
      </Card>

      <label className="text-sm font-bold">
        {t('staff.pick')}
        <select className={selectClass} value={name} onChange={(e) => pick(e.target.value)}>
          <option value="">—</option>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      {name ? <StaffDetail key={name} staff={name} /> : <p className="text-sm text-slate-600">{t('staff.pickHint')}</p>}
    </div>
  )
}
