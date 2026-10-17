import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../../../components/Sheet'
import { useToast } from '../../../components/Toast'
import { Button, ErrorBox } from '../../../components/ui'
import type { PayrollInput, PayrollRates, PayrollResult, PayrollStaff } from '../../../domain/payroll'
import { yen } from '../../../domain/sales'
import { errorMessage } from '../../../lib/format'
import { unwrap } from '../../../lib/queries'
import { supabase } from '../../../lib/supabase'
import { hrs } from './data'

const n0 = (s: string) => (s.trim() === '' ? 0 : Number(s))

function Line({ label, formula, value, strong }: { label: string; formula?: string; value: string; strong?: boolean }) {
  return (
    <li className="flex items-start justify-between gap-2 border-b border-line py-1.5 text-sm last:border-0">
      <span>
        <span className={strong ? 'font-bold' : ''}>{label}</span>
        {formula && <span className="block text-xs text-muted tabular-nums">{formula}</span>}
      </span>
      <span className={`shrink-0 tabular-nums ${strong ? 'font-bold' : ''}`}>{value}</span>
    </li>
  )
}

function NumField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <label className="flex flex-col gap-0.5 text-sm">
      <span className="font-bold">{label}</span>
      <input inputMode="decimal" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="min-h-11 min-w-0 rounded-lg border border-line px-2 tabular-nums disabled:bg-slate-100" />
    </label>
  )
}

/** One person: how every figure is made, the daily rows, the settings and the month's inputs. */
export function PayrollDetail({ r, rates, month, closed, onClose }: { r: PayrollResult; rates: PayrollRates; month: string; closed: boolean; onClose: () => void }) {
  const { t } = useTranslation('manager')
  const toast = useToast()
  const queryClient = useQueryClient()
  const s = r.staff
  const [staff, setStaff] = useState({ code: s.staff_code ?? '', kind: s.kind, commute: String(s.commute_unit), leader: String(s.leader_unit), shiftMake: String(s.shift_make_amount) })
  const inp = r.input
  const [input, setInput] = useState({
    paidDaily: String(inp.paid_daily),
    paidDays: String(inp.paid_days),
    busy: String(inp.busy_hours),
    o1: String(inp.other1_amount),
    o1n: inp.other1_note ?? '',
    o2: String(inp.other2_amount),
    o2n: inp.other2_note ?? '',
    adj: String(inp.commute_adjust),
    ref: String(inp.referral_amount),
    refn: inp.referral_note ?? '',
  })
  const save = useMutation({
    mutationFn: async () => {
      const nums = [staff.commute, staff.leader, staff.shiftMake, input.paidDaily, input.paidDays, input.busy, input.o1, input.o2, input.adj, input.ref].map(n0)
      if (nums.some((x) => !Number.isFinite(x))) throw new Error(t('payroll.badNumber'))
      const st: Partial<PayrollStaff> & { roster_name: string } = {
        roster_name: s.roster_name,
        staff_code: staff.code.trim() || null,
        kind: staff.kind,
        commute_unit: n0(staff.commute),
        leader_unit: n0(staff.leader),
        shift_make_amount: n0(staff.shiftMake),
      }
      unwrap(await supabase.from('payroll_staff').upsert(st))
      if (!closed) {
        const row: PayrollInput & { month: string; roster_name: string } = {
          month,
          roster_name: s.roster_name,
          paid_daily: n0(input.paidDaily),
          paid_days: n0(input.paidDays),
          busy_hours: n0(input.busy),
          other1_amount: n0(input.o1),
          other1_note: input.o1n.trim() || null,
          other2_amount: n0(input.o2),
          other2_note: input.o2n.trim() || null,
          commute_adjust: n0(input.adj),
          referral_amount: n0(input.ref),
          referral_note: input.refn.trim() || null,
        }
        unwrap(await supabase.from('payroll_inputs').upsert(row))
      }
    },
    onSuccess: () => {
      toast(t('payroll.saved'))
      void queryClient.invalidateQueries({ queryKey: ['payroll', 'month', month] })
      onClose()
    },
  })
  const a = r.allowances
  const p = r.pay
  return (
    <Sheet title={`${s.roster_name}（${s.kind}）`} onClose={onClose}>
      {r.missingCodes.length > 0 && <ErrorBox message={t('payroll.missingCodes', { codes: r.missingCodes.join('、') })} />}
      <section>
        <h3 className="font-bold">⏱ {t('payroll.hoursTitle')}</h3>
        <ul>
          <Line label={t('payroll.h.normal')} formula={t('payroll.f.normal', { k: hrs(r.sums.normal), l: hrs(r.sums.normalAdj), m: hrs(r.sums.normalExtra) })} value={hrs(r.normalTotal)} />
          <Line label={t('payroll.h.night')} formula={t('payroll.f.night', { n: hrs(r.sums.night), o: hrs(r.sums.nightAdj), p: hrs(r.sums.nightExtra) })} value={hrs(r.nightTotal)} />
          <Line label={t('payroll.h.total')} value={hrs(r.totalHours)} strong />
          <Line label={t('payroll.h.overtime')} formula={t('payroll.f.overtime', { total: hrs(r.totalHours), legal: hrs(r.legal) })} value={hrs(r.overtimeHours)} />
          <Line label={t('payroll.h.training')} formula={t('payroll.f.training', { n: r.trainingCount })} value={`${hrs(r.trainingNormalHours)} / ${hrs(r.trainingNightHours)}`} />
          <Line label={t('payroll.h.days')} value={String(r.workDays)} />
        </ul>
      </section>
      <section>
        <h3 className="font-bold">💴 {t('payroll.payTitle')}</h3>
        <ul>
          <Line label={t('payroll.p.normal')} formula={t('payroll.f.times', { rate: yen(rates.normal), h: hrs(r.normalHours), of: t('payroll.f.normalHours', { total: hrs(r.normalTotal), tr: hrs(r.trainingNormalHours), ot: hrs(r.overtimeHours) }) })} value={yen(Math.round(p.normal))} />
          <Line label={t('payroll.p.night')} formula={t('payroll.f.times', { rate: yen(rates.night), h: hrs(r.nightHours), of: '' })} value={yen(Math.round(p.night))} />
          <Line label={t('payroll.p.overtime')} formula={t('payroll.f.times', { rate: yen(rates.overtime), h: hrs(r.overtimeHours), of: '' })} value={yen(Math.round(p.overtime))} />
          <Line label={t('payroll.p.training')} formula={`${yen(rates.training_normal)} × ${hrs(r.trainingNormalHours)} + ${yen(rates.training_night)} × ${hrs(r.trainingNightHours)}`} value={yen(Math.round(p.trainingNormal + p.trainingNight))} />
          <Line label={t('payroll.a.paid')} formula={`${yen(r.input.paid_daily)} × ${r.input.paid_days}`} value={yen(a.paid)} />
          <Line label={t('payroll.a.leader')} formula={`${yen(s.leader_unit)} × ${hrs(r.totalHours)}`} value={yen(a.leader)} />
          <Line label={t('payroll.a.shiftMake')} value={yen(a.shiftMake)} />
          <Line label={t('payroll.a.dayLeader')} formula={`${yen(rates.day_leader_unit)} × ${hrs(a.dayLeaderHours)}`} value={yen(a.dayLeader)} />
          <Line label={t('payroll.a.trainingAllowance')} formula={`${yen(rates.training_allowance_unit)} × ${hrs(a.trainingAllowanceHours)}`} value={yen(a.trainingAllowance)} />
          <Line label={t('payroll.a.busy')} formula={`${yen(rates.busy_unit)} × ${hrs(r.input.busy_hours)}`} value={yen(a.busy)} />
          <Line label={t('payroll.a.other')} formula={[r.input.other1_note, r.input.other2_note].filter(Boolean).join(' / ')} value={yen(a.other1 + a.other2)} />
          <Line label={t('payroll.a.commute')} formula={t('payroll.f.commute', { unit: yen(s.commute_unit), days: r.workDays, adj: r.input.commute_adjust })} value={yen(a.commute)} />
          <Line label={t('payroll.a.referral')} formula={r.input.referral_note ?? ''} value={yen(a.referral)} />
          <Line label={t('payroll.total')} formula={t('payroll.f.total')} value={yen(r.total)} strong />
        </ul>
      </section>
      <details className="rounded-xl bg-white ring-1 ring-line">
        <summary className="cursor-pointer p-3 text-sm font-bold">📅 {t('payroll.daily')}</summary>
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-muted">
                {['day', 'early', 'middle', 'late', 'normal', 'adj', 'extra', 'night', 'total'].map((k) => (
                  <th key={k} className="px-1 py-1 text-left">
                    {t(`payroll.col.${k}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.days
                .filter((d) => d.total || d.early || d.middle || d.late)
                .map((d) => (
                  <tr key={d.day} className="border-t border-line">
                    <td className="px-1 py-1">{d.day}</td>
                    <td className="px-1">{d.early}{d.earlyTraining ? ` 研${d.earlyTraining}` : ''}</td>
                    <td className="px-1">{d.middle}{d.middleTraining ? ` 研${d.middleTraining}` : ''}</td>
                    <td className="px-1">{d.late}{d.lateTraining ? ` 研${d.lateTraining}` : ''}</td>
                    <td className="px-1">{d.normal}</td>
                    <td className="px-1">{d.normalAdj + d.nightAdj || ''}</td>
                    <td className="px-1">{d.normalExtra + d.nightExtra || ''}</td>
                    <td className="px-1">{d.night + d.nightAdj + d.nightExtra || ''}</td>
                    <td className="px-1 font-bold">{d.total}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
      <section className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3 ring-1 ring-line">
        <h3 className="font-bold">⚙️ {t('payroll.settingsTitle')}</h3>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-0.5 text-sm">
            <span className="font-bold">{t('payroll.s.code')}</span>
            <input value={staff.code} onChange={(e) => setStaff({ ...staff, code: e.target.value })} className="min-h-11 min-w-0 rounded-lg border border-line px-2" />
          </label>
          <label className="flex flex-col gap-0.5 text-sm">
            <span className="font-bold">{t('payroll.s.kind')}</span>
            <select value={staff.kind} onChange={(e) => setStaff({ ...staff, kind: e.target.value })} className="min-h-11 rounded-lg border border-line px-2">
              {['早番', '中番', '遅番', '正社員'].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <NumField label={t('payroll.s.commute')} value={staff.commute} onChange={(v) => setStaff({ ...staff, commute: v })} />
          <NumField label={t('payroll.s.leader')} value={staff.leader} onChange={(v) => setStaff({ ...staff, leader: v })} />
          <NumField label={t('payroll.s.shiftMake')} value={staff.shiftMake} onChange={(v) => setStaff({ ...staff, shiftMake: v })} />
        </div>
        <h3 className="mt-2 font-bold">🗓 {t('payroll.inputsTitle')}</h3>
        {closed && <p className="text-sm font-bold text-amber-800">{t('payroll.closedNoEdit')}</p>}
        <div className="grid grid-cols-2 gap-2">
          <NumField disabled={closed} label={t('payroll.i.paidDaily')} value={input.paidDaily} onChange={(v) => setInput({ ...input, paidDaily: v })} />
          <NumField disabled={closed} label={t('payroll.i.paidDays')} value={input.paidDays} onChange={(v) => setInput({ ...input, paidDays: v })} />
          <NumField disabled={closed} label={t('payroll.i.busy')} value={input.busy} onChange={(v) => setInput({ ...input, busy: v })} />
          <NumField disabled={closed} label={t('payroll.i.adjust')} value={input.adj} onChange={(v) => setInput({ ...input, adj: v })} />
          <NumField disabled={closed} label={t('payroll.i.other1')} value={input.o1} onChange={(v) => setInput({ ...input, o1: v })} />
          <label className="flex flex-col gap-0.5 text-sm">
            <span className="font-bold">{t('payroll.i.note')}</span>
            <input disabled={closed} value={input.o1n} onChange={(e) => setInput({ ...input, o1n: e.target.value })} className="min-h-11 min-w-0 rounded-lg border border-line px-2 disabled:bg-slate-100" />
          </label>
          <NumField disabled={closed} label={t('payroll.i.other2')} value={input.o2} onChange={(v) => setInput({ ...input, o2: v })} />
          <label className="flex flex-col gap-0.5 text-sm">
            <span className="font-bold">{t('payroll.i.note')}</span>
            <input disabled={closed} value={input.o2n} onChange={(e) => setInput({ ...input, o2n: e.target.value })} className="min-h-11 min-w-0 rounded-lg border border-line px-2 disabled:bg-slate-100" />
          </label>
          <NumField disabled={closed} label={t('payroll.i.referral')} value={input.ref} onChange={(v) => setInput({ ...input, ref: v })} />
          <label className="flex flex-col gap-0.5 text-sm">
            <span className="font-bold">{t('payroll.i.note')}</span>
            <input disabled={closed} value={input.refn} onChange={(e) => setInput({ ...input, refn: e.target.value })} className="min-h-11 min-w-0 rounded-lg border border-line px-2 disabled:bg-slate-100" />
          </label>
        </div>
        {save.error && <ErrorBox message={errorMessage(save.error)} />}
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          {t('payroll.save')}
        </Button>
      </section>
    </Sheet>
  )
}

