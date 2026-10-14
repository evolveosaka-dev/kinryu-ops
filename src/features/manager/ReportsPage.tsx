import { FunctionsHttpError } from '@supabase/supabase-js'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMe } from '../../app/auth'
import { Button, Card, Checkbox, ErrorBox, PageTitle, Segmented, Spinner } from '../../components/ui'
import { rate, reportPeriods, type AiReport } from '../../domain/report'
import { formatShortDate, weekdayOf } from '../../domain/time'
import { cx } from '../../lib/cx'
import { errorMessage } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { jstDateTime, today, useReports } from './data'
import { ManagerTabs } from './ManagerTabs'

const SHIFT_JA: Record<string, string> = { early: '早番', middle: '中番', late: '遅番' }

function Num({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'warn' }) {
  return (
    <div className="rounded-xl border border-line bg-white p-2.5">
      <p className="text-xs font-bold text-slate-600">{label}</p>
      <p className={cx('text-xl font-bold', tone === 'good' && 'text-green-700', tone === 'warn' && 'text-amber-700')}>{value}</p>
      {sub && <p className="text-xs text-slate-600">{sub}</p>}
    </div>
  )
}

function ReportView({ r }: { r: AiReport }) {
  const { t } = useTranslation('manager')
  const { t: tc } = useTranslation()
  const d = r.data
  const target = rate(d.sales.bowls_with_target, d.sales.target)
  const ly = rate(d.sales.bowls_with_last_year, d.sales.last_year)
  const chorei = rate(d.chorei.done, d.chorei.due)
  const wd = (x: string) => t(`weekday.${weekdayOf(x)}`)
  const title =
    r.kind === 'monthly'
      ? t('reports.monthly', { y: r.period_from.slice(0, 4), m: Number(r.period_from.slice(5, 7)) })
      : t('reports.weekly', { from: `${formatShortDate(r.period_from)}(${wd(r.period_from)})`, to: `${formatShortDate(r.period_to)}(${wd(r.period_to)})` })
  return (
    <article className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          <p className="text-xs text-muted">
            {t('reports.made', { at: jstDateTime(r.created_at) })}
            {r.mailed_at && ` ・ ${t('reports.mailed')}`}
          </p>
        </div>
        <Button variant="secondary" className="min-h-10 px-3 text-sm print:hidden" onClick={() => window.print()}>
          🖨️ {t('reports.print')}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Num label={t('reports.bowls')} value={`${d.sales.bowls.toLocaleString()}${t('reports.bowlUnit')}`} sub={t('reports.days', { n: d.sales.days })} />
        <Num label={t('reports.vsTarget')} value={target === null ? '—' : `${target}%`} tone={target === null ? undefined : target >= 100 ? 'good' : 'warn'} sub={t('reports.vsLastYear', { v: ly === null ? '—' : `${ly}%` })} />
        <Num label={t('reports.patrol')} value={d.patrol.avg25 === null ? '—' : `${d.patrol.avg25}`} tone={d.patrol.avg25 === null ? undefined : d.patrol.avg25 >= 20 ? 'good' : 'warn'} sub={t('reports.patrolSub', { n: d.patrol.count, c: d.patrol.coaching })} />
        <Num label={t('reports.chorei')} value={chorei === null ? '—' : `${chorei}%`} sub={`${d.chorei.done}/${d.chorei.due}`} tone={chorei === null ? undefined : chorei >= 95 ? 'good' : 'warn'} />
      </div>
      <Card className="whitespace-pre-wrap text-[15px] leading-relaxed">
        <p className="mb-1 text-xs font-bold text-brand">🤖 {t('reports.ai')}</p>
        {r.summary}
      </Card>
      <Card className="flex flex-col gap-1 text-sm">
        <h3 className="font-bold">{t('reports.bySlot')}</h3>
        <table className="w-full">
          <thead className="text-xs text-slate-600">
            <tr>
              <th className="text-left">{t('reports.slot')}</th>
              <th className="text-right">{t('reports.bowls')}</th>
              <th className="text-right">{t('reports.vsTarget')}</th>
              <th className="text-right">{t('reports.lastYearShort')}</th>
            </tr>
          </thead>
          <tbody>
            {d.sales.by_slot.map((x) => {
              const tr = rate(x.bowls_with_target, x.target)
              return (
                <tr key={`${x.store}${x.shift}`} className="border-t border-line">
                  <td className="py-1">
                    {x.store.replace('店', '')} {SHIFT_JA[x.shift] ?? x.shift}
                  </td>
                  <td className="text-right tabular-nums">{x.bowls}</td>
                  <td className={cx('text-right font-bold tabular-nums', tr !== null && (tr >= 100 ? 'text-green-700' : 'text-amber-700'))}>{tr === null ? '—' : `${tr}%`}</td>
                  <td className="text-right tabular-nums">{rate(x.bowls_with_last_year, x.last_year) ?? '—'}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
      <Card className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <h3 className="col-span-2 font-bold">{t('reports.others')}</h3>
        <span>{t('reports.absence')}</span>
        <b className="text-right">
          {d.attendance.absence}（{t('reports.sameDay', { n: d.attendance.absence_same_day })}）
        </b>
        <span>{t('reports.lateEarly')}</span>
        <b className="text-right">
          {d.attendance.late} / {d.attendance.early_leave}
        </b>
        <span>{t('reports.notReported')}</span>
        <b className={cx('text-right', d.attendance.not_reported > 0 && 'text-red-700')}>{d.attendance.not_reported}</b>
        <span>{t('reports.covered')}</span>
        <b className="text-right">{d.attendance.covered}</b>
        {d.attendance.visa_over_people > 0 && (
          <>
            <span>{t('reports.visa')}</span>
            <b className="text-right text-red-700">{d.attendance.visa_over_people}</b>
          </>
        )}
        <span>{t('reports.loss')}</span>
        <b className="text-right">{d.stock.loss_events}</b>
        <span>{t('reports.diffs')}</span>
        <b className="text-right">
          {d.stock.sales_reports_with_noodle_diff} / {d.stock.sales_reports_with_cash_diff}
        </b>
        <span>{t('reports.incidents')}</span>
        <b className="text-right">
          {Object.entries(d.incidents.by_kind)
            .map(([k, n]) => `${tc(`incident.kinds.${k}`)} ${n}`)
            .join('、') || '0'}
        </b>
      </Card>
    </article>
  )
}

/** 管理 → レポート: AI weekly / monthly reports (made automatically, or now). */
export function ReportsPage() {
  const { t } = useTranslation('manager')
  const me = useMe()
  const queryClient = useQueryClient()
  const reports = useReports()
  const periods = reportPeriods(today())
  const [key, setKey] = useState(periods[0]!.key)
  const [mail, setMail] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const make = useMutation({
    mutationFn: async () => {
      const p = periods.find((x) => x.key === key)!
      const { data, error } = await supabase.functions.invoke<{ id: string }>('send-notifications', { body: { action: 'report', kind: p.kind, from: p.from, to: p.to, mail } })
      if (error) {
        const detail = error instanceof FunctionsHttpError ? ((await (error.context as Response).json().catch(() => ({}))) as { error?: string }).error : null
        throw new Error(detail ?? error.message)
      }
      return data!
    },
    onSuccess: (r) => {
      setOpenId(r.id)
      void queryClient.invalidateQueries({ queryKey: ['admin', 'ai_reports'] })
    },
  })
  if (reports.isLoading) return <Spinner />
  const list = reports.data ?? []
  const shown = list.find((r) => r.id === openId) ?? list[0] ?? null
  return (
    <div className="flex flex-col gap-3">
      <div className="print:hidden">
        <ManagerTabs />
      </div>
      <div className="flex flex-col gap-3 print:hidden">
        <PageTitle title={t('reports.title')} subtitle={t('reports.subtitle')} />
        {!me.is_test_account && (
          <Card className="flex flex-col gap-2">
            <Segmented label={t('reports.make')} value={key} onChange={setKey} columns={2} options={periods.map((p) => ({ value: p.key, label: t(`reports.period.${p.key}`) }))} />
            <Checkbox checked={mail} onChange={setMail}>
              {t('reports.mailToo')}
            </Checkbox>
            {make.error && <ErrorBox message={errorMessage(make.error)} />}
            <Button onClick={() => make.mutate()} disabled={make.isPending}>
              {make.isPending ? t('reports.making') : `🤖 ${t('reports.makeNow')}`}
            </Button>
          </Card>
        )}
        {list.length > 1 && (
          <select className="min-h-11 rounded-xl border border-slate-300 bg-white px-2" value={shown?.id ?? ''} onChange={(e) => setOpenId(e.target.value)}>
            {list.map((r) => (
              <option key={r.id} value={r.id}>
                {r.kind === 'monthly' ? t('reports.monthly', { y: r.period_from.slice(0, 4), m: Number(r.period_from.slice(5, 7)) }) : t('reports.weekly', { from: formatShortDate(r.period_from), to: formatShortDate(r.period_to) })}
              </option>
            ))}
          </select>
        )}
      </div>
      {shown ? <ReportView r={shown} /> : <p className="rounded-xl bg-surface p-4 text-center text-muted">{t('reports.none')}</p>}
    </div>
  )
}
