import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../../components/Toast'
import { Button, Card, ErrorBox, PageTitle, Spinner } from '../../../components/ui'
import { computePayroll, EMPTY_INPUT, type PayrollRates, type PayrollResult } from '../../../domain/payroll'
import { yen } from '../../../domain/sales'
import { cx } from '../../../lib/cx'
import { errorMessage } from '../../../lib/format'
import { unwrap } from '../../../lib/queries'
import { supabase } from '../../../lib/supabase'
import { exportXlsx, jstDateTime } from '../data'
import { ManagerTabs } from '../ManagerTabs'
import { hrs, useIsPayrollAdmin, usePayrollFiles, usePayrollMonth, usePayrollMonths, type ClosedResult } from './data'
import { PayrollDetail } from './PayrollDetail'

const RATE_KEYS: (keyof PayrollRates)[] = ['normal', 'night', 'overtime', 'training_normal', 'training_night', 'day_leader_unit', 'training_allowance_unit', 'busy_unit']

const toClosed = (r: PayrollResult): ClosedResult => ({
  name: r.staff.roster_name,
  code: r.staff.staff_code,
  kind: r.staff.kind,
  workDays: r.workDays,
  totalHours: r.totalHours,
  report: r.report,
  pay: r.pay,
  allowances: r.allowances,
  total: r.total,
})

function RatesCard({ month, rates, closed }: { month: string; rates: (PayrollRates & { valid_from: string }) | null; closed: boolean }) {
  const { t } = useTranslation('manager')
  const toast = useToast()
  const queryClient = useQueryClient()
  const [edit, setEdit] = useState<Record<string, string> | null>(null)
  const save = useMutation({
    mutationFn: async (v: Record<string, string>) => {
      const row = Object.fromEntries(RATE_KEYS.map((k) => [k, Number(v[k])]))
      if (Object.values(row).some((x) => !Number.isInteger(x) || x < 0)) throw new Error(t('payroll.badNumber'))
      unwrap(await supabase.from('payroll_rates').upsert({ valid_from: month, ...row }))
    },
    onSuccess: () => {
      setEdit(null)
      toast(t('payroll.saved'))
      void queryClient.invalidateQueries({ queryKey: ['payroll', 'month'] })
    },
  })
  return (
    <details className="rounded-xl bg-white ring-1 ring-line">
      <summary className="cursor-pointer p-3 font-bold">
        🧮 {t('payroll.ratesTitle')}
        {rates && <span className="ml-2 text-sm font-normal text-muted">{t('payroll.ratesFrom', { m: Number(rates.valid_from.slice(5, 7)), y: rates.valid_from.slice(0, 4) })}</span>}
      </summary>
      <div className="flex flex-col gap-2 p-3 pt-0">
        {!rates && <ErrorBox message={t('payroll.noRates')} />}
        <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          {RATE_KEYS.map((k) => (
            <li key={k} className="flex items-center justify-between gap-2">
              <span>{t(`payroll.rate.${k}`)}</span>
              {edit ? (
                <input inputMode="numeric" value={edit[k] ?? ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} className="min-h-10 w-20 rounded-lg border border-line px-2 text-right tabular-nums" />
              ) : (
                <b className="tabular-nums">{rates ? yen(rates[k]) : '—'}</b>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">{t('payroll.ratesNote')}</p>
        {save.error && <ErrorBox message={errorMessage(save.error)} />}
        {edit ? (
          <div className="flex gap-2">
            <Button className="flex-1" disabled={save.isPending} onClick={() => save.mutate(edit)}>
              {t('payroll.saveRates', { m: Number(month.slice(5, 7)) })}
            </Button>
            <Button variant="secondary" className="flex-1" onClick={() => setEdit(null)}>
              {t('payroll.cancel')}
            </Button>
          </div>
        ) : (
          !closed && (
            <Button variant="secondary" onClick={() => setEdit(Object.fromEntries(RATE_KEYS.map((k) => [k, rates ? String(rates[k]) : ''])))}>
              ✏️ {t('payroll.editRates')}
            </Button>
          )
        )}
      </div>
    </details>
  )
}

export function PayrollPage() {
  const { t } = useTranslation('manager')
  const toast = useToast()
  const queryClient = useQueryClient()
  const allowed = useIsPayrollAdmin()
  const months = usePayrollMonths(allowed)
  const files = usePayrollFiles(allowed)
  const [picked, setPicked] = useState<string | null>(null)
  const list = months.data ?? []
  const month = picked ?? list.at(-1)?.month ?? null
  const q = usePayrollMonth(allowed ? month : null)
  const [open, setOpen] = useState<string | null>(null)

  const results = useMemo(() => {
    const d = q.data
    if (!d?.source || !d.rates) return []
    return d.staff
      .filter((s) => s.active)
      .map((s) => computePayroll(d.source!, s, d.rates!, d.inputs.find((i) => i.roster_name === s.roster_name) ?? EMPTY_INPUT))
  }, [q.data])
  // names in this month's shift sheets with no payroll settings
  const unknown = useMemo(() => {
    const d = q.data
    if (!d?.source) return []
    const names = new Set([...Object.keys(d.source.shifts.early), ...Object.keys(d.source.shifts.middle), ...Object.keys(d.source.shifts.late)])
    return [...names].filter((n) => !d.staff.some((s) => s.roster_name === n)).sort()
  }, [q.data])

  const close = useMutation({
    mutationFn: async () =>
      unwrap(await supabase.rpc('close_payroll', { p_month: month, p_results: results.map(toClosed), p_total: results.filter((r) => r.staff.kind !== '正社員').reduce((s, r) => s + r.total, 0) })),
    onSuccess: () => {
      toast(t('payroll.closedToast'))
      void queryClient.invalidateQueries({ queryKey: ['payroll', 'month', month] })
    },
  })
  const reopen = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('reopen_payroll', { p_month: month })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['payroll', 'month', month] }),
  })
  const addStaff = useMutation({
    mutationFn: async (name: string) => {
      const d = q.data!.source!
      const kind = d.shifts.early[name] ? '早番' : d.shifts.middle[name] ? '中番' : '遅番'
      unwrap(await supabase.from('payroll_staff').upsert({ roster_name: name, kind }))
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['payroll', 'month', month] }),
  })

  if (!allowed)
    return (
      <div className="flex flex-col gap-3">
        <ManagerTabs />
        <ErrorBox message={t('payroll.noAccess')} />
      </div>
    )
  if (months.isLoading || q.isLoading) return <Spinner />
  const d = q.data
  const closing = d?.closing ?? null
  const rows: ClosedResult[] = closing ? closing.results : results.map(toClosed)
  // 正社員: hours only (the workbook says their block is not for pay)
  const paid = (r: { kind: string }) => r.kind !== '正社員'
  const total = rows.filter(paid).reduce((s, r) => s + r.total, 0)
  const hours = rows.reduce((s, r) => s + r.totalHours, 0)
  const idx = list.findIndex((m) => m.month === month)

  const exportExcel = () => {
    const head = [t('payroll.x.code'), t('payroll.x.name'), t('payroll.x.kind'), t('payroll.x.days'), ...['normal', 'night', 'overtime', 'training11Normal', 'training11Night', 'training10Normal', 'training10Night', 'extraNormal', 'extraNight'].map((k) => t(`payroll.r.${k}`)), ...['paid', 'leader', 'shiftMake', 'dayLeader', 'trainingAllowance', 'busy', 'other1', 'other2', 'commute', 'referral'].map((k) => t(`payroll.x.${k}`)), t('payroll.x.hourly'), t('payroll.total')]
    const body = rows.map((r) => [
      r.code,
      r.name,
      r.kind,
      r.workDays,
      ...['normal', 'night', 'overtime', 'training11Normal', 'training11Night', 'training10Normal', 'training10Night', 'extraNormal', 'extraNight'].map((k) => Math.round((r.report[k] ?? 0) * 100) / 100),
      ...['paid', 'leader', 'shiftMake', 'dayLeader', 'trainingAllowance', 'busy', 'other1', 'other2', 'commute', 'referral'].map((k) => r.allowances[k] ?? 0),
      paid(r) ? Math.round(r.pay.hourly ?? 0) : null,
      paid(r) ? r.total : null,
    ])
    void exportXlsx(`給与計算_${month!.slice(0, 7)}.xlsx`, [{ name: t('payroll.title'), rows: [head, ...body] }])
  }

  const detail = open ? results.find((r) => r.staff.roster_name === open) : null
  return (
    <div className="flex flex-col gap-3">
      <ManagerTabs />
      <PageTitle title={`💴 ${t('payroll.title')}`} subtitle={t('payroll.subtitle')} />
      {list.length === 0 ? (
        <ErrorBox message={t('payroll.noSource')} />
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <Button variant="secondary" className="px-4" disabled={idx <= 0} onClick={() => setPicked(list[idx - 1]!.month)}>
              ‹
            </Button>
            <b className="text-lg">{t('payroll.month', { y: month!.slice(0, 4), m: Number(month!.slice(5, 7)) })}</b>
            <Button variant="secondary" className="px-4" disabled={idx >= list.length - 1} onClick={() => setPicked(list[idx + 1]!.month)}>
              ›
            </Button>
          </div>
          {q.error && <ErrorBox message={errorMessage(q.error)} />}
          <p className="text-sm text-muted">{t('payroll.source', { at: d?.importedAt ? jstDateTime(d.importedAt).slice(5) : '—' })}</p>
          <p className={cx('rounded-lg p-2 text-sm font-bold', closing ? 'bg-green-50 text-green-900' : 'bg-amber-50 text-amber-900')}>
            {closing ? t('payroll.closedAt', { at: jstDateTime(closing.closed_at).slice(5), by: closing.closed_by_name ?? '' }) : t('payroll.draft')}
            {closing && d?.importedAt && closing.source_imported_at && d.importedAt > closing.source_imported_at && <span className="block text-red-800">{t('payroll.sourceChanged')}</span>}
          </p>
          <RatesCard month={month!} rates={d?.rates ?? null} closed={Boolean(closing)} />
          {unknown.length > 0 && !closing && (
            <Card className="flex flex-col gap-2 ring-2 ring-amber-300">
              <p className="text-sm font-bold">⚠️ {t('payroll.unknown', { n: unknown.length })}</p>
              <ul className="flex flex-wrap gap-2">
                {unknown.map((n) => (
                  <li key={n}>
                    <button type="button" disabled={addStaff.isPending} onClick={() => addStaff.mutate(n)} className="rounded-full bg-white px-3 py-1 text-sm font-bold ring-1 ring-amber-400">
                      ＋ {n}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted">{t('payroll.unknownHint')}</p>
            </Card>
          )}
          <div className="grid grid-cols-3 gap-2 text-center">
            <Card className="p-2">
              <p className="text-xs text-muted">{t('payroll.people')}</p>
              <b className="text-lg">{rows.filter(paid).length}</b>
            </Card>
            <Card className="p-2">
              <p className="text-xs text-muted">{t('payroll.hours')}</p>
              <b className="text-lg">{hrs(hours)}</b>
            </Card>
            <Card className="p-2">
              <p className="text-xs text-muted">{t('payroll.total')}</p>
              <b className="text-lg">{yen(total)}</b>
            </Card>
          </div>
          <details className="rounded-xl bg-sky-50 p-3 text-sm text-sky-950">
            <summary className="cursor-pointer font-bold">📐 {t('payroll.howTitle')}</summary>
            <p className="mt-2 whitespace-pre-line">{t('payroll.how')}</p>
          </details>
          <ul className="flex flex-col gap-1">
            {rows.map((r) => (
              <li key={r.name}>
                <button
                  type="button"
                  onClick={() => setOpen(r.name)}
                  className="flex min-h-12 w-full items-center justify-between gap-2 rounded-xl bg-white px-3 text-left ring-1 ring-line disabled:opacity-100"
                >
                  <span className="min-w-0">
                    <b>{r.name}</b> <span className="text-xs text-muted">{r.kind}</span>
                    <span className="block text-xs text-muted tabular-nums">{t('payroll.rowSub', { days: r.workDays, h: hrs(r.totalHours) })}</span>
                  </span>
                  <span className="shrink-0 font-bold tabular-nums">
                    {paid(r) ? yen(r.total) : t('payroll.hoursOnly')}
                    {' ›'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Button variant="secondary" onClick={exportExcel}>
            📥 {t('payroll.export')}
          </Button>
          {(close.error || reopen.error) && <ErrorBox message={errorMessage(close.error ?? reopen.error)} />}
          {closing ? (
            <Button variant="secondary" disabled={reopen.isPending} onClick={() => window.confirm(t('payroll.reopenConfirm')) && reopen.mutate()}>
              🔓 {t('payroll.reopen')}
            </Button>
          ) : (
            <Button disabled={close.isPending || !d?.rates || results.length === 0} onClick={() => window.confirm(t('payroll.closeConfirm')) && close.mutate()}>
              🔒 {t('payroll.close')}
            </Button>
          )}
          <details className="rounded-xl bg-white ring-1 ring-line">
            <summary className="cursor-pointer p-3 text-sm font-bold">📎 {t('payroll.files')}</summary>
            <ul className="flex flex-col gap-1 p-3 pt-0 text-sm">
              {(files.data ?? []).map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className="text-left font-bold text-brand underline"
                    onClick={async () => {
                      const { data, error } = await supabase.storage.from('payroll').createSignedUrl(f.storage_path, 300, { download: f.name })
                      if (error) toast(error.message)
                      else window.location.href = data.signedUrl
                    }}
                  >
                    {f.name}
                  </button>
                  <span className="block text-xs text-muted break-all">
                    {jstDateTime(f.uploaded_at)} · {Math.round(f.size_bytes / 1024)} KB · SHA-256 {f.sha256}
                  </span>
                </li>
              ))}
              {(files.data ?? []).length === 0 && <li className="text-muted">{t('payroll.noFiles')}</li>}
            </ul>
          </details>
        </>
      )}
      {detail && d?.rates && <PayrollDetail r={detail} rates={d.rates} month={month!} closed={Boolean(closing)} onClose={() => setOpen(null)} />}
    </div>
  )
}
