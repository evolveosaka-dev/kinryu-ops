import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../components/Toast'
import { Button, Card, ErrorBox, TextInput } from '../../components/ui'
import { PERIOD_CLAMP, PERIOD_MIN_PAIRS, periodFit } from '../../domain/forecast'
import { indexSales } from '../../domain/salesAnalysis'
import { formatShortDate } from '../../domain/time'
import { SHIFTS } from '../../domain/types'
import { errorMessage, storeName } from '../../lib/format'
import { unwrap, useSalesPeriods, useStores } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { useDailySales } from './analysis/data'
import { today } from './data'

const cell = 'min-h-11 w-full rounded-lg border border-slate-300 px-1 text-center'
const fmtDate = (d: string) => `${d.slice(0, 4)}/${formatShortDate(d)}`

/**
 * 前年の特殊期間 (万博 2025…): 杯数の予測 takes last year's figures without the period's effect, measured here per
 * store × shift = (this year ÷ last year on days outside every period) ÷ (the same on days whose year-before was in it).
 */
export function SalesPeriodsCard() {
  const { t } = useTranslation('manager')
  const toast = useToast()
  const queryClient = useQueryClient()
  const stores = useStores()
  const periods = useSalesPeriods()
  const sales = useDailySales()
  const [form, setForm] = useState({ from: '', to: '', name: '', store: '', note: '' })
  const [error, setError] = useState<string | null>(null)
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['sales_periods'] })
  const storeIds = useMemo(() => (stores.data ?? []).map((s) => s.id), [stores.data])
  const fit = useMemo(
    () =>
      periods.data && sales.data
        ? periodFit({ sales: indexSales(sales.data), targets: [], events: [], holidays: new Set(), storeIds, shifts: [...SHIFTS] }, periods.data, today())
        : null,
    [periods.data, sales.data, storeIds],
  )

  const add = useMutation({
    mutationFn: async () => {
      if (!form.name.trim() || !form.from) throw new Error(t('periods.invalid'))
      const to = form.to && form.to >= form.from ? form.to : form.from
      unwrap(await supabase.from('sales_periods').insert({ name: form.name.trim(), date_from: form.from, date_to: to, store_id: form.store || null, note: form.note.trim() || null }))
    },
    onSuccess: () => {
      setError(null)
      setForm({ from: '', to: '', name: '', store: '', note: '' })
      toast(t('users.saved'))
      refresh()
    },
    onError: (e) => setError(errorMessage(e)),
  })
  const toggle = useMutation({
    mutationFn: async (p: { id: string; active: boolean }) => unwrap(await supabase.from('sales_periods').update({ active: !p.active }).eq('id', p.id)),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('sales_periods').delete().eq('id', id)),
    onSuccess: refresh,
  })
  const store = (id: string | null) => (id ? storeName(stores.data?.find((s) => s.id === id), 'ja') : t('targets.bothStores'))
  const effect = (u: number | null) => (u === null ? '—' : `${u >= 1 ? '+' : ''}${Math.round((u - 1) * 100)}%`)

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-bold">🗓 {t('periods.title')}</h2>
      <p className="text-xs whitespace-pre-line text-muted">{t('periods.help', { min: PERIOD_MIN_PAIRS, lo: PERIOD_CLAMP[0], hi: PERIOD_CLAMP[1] })}</p>
      {(periods.data ?? []).length === 0 ? (
        <p className="text-sm text-muted">{t('periods.none')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line text-sm">
          {(periods.data ?? []).map((p) => (
            <li key={p.id} className={`flex flex-col gap-1 py-2 ${p.active ? '' : 'opacity-50'}`}>
              <div className="flex items-start gap-2">
                <span className="flex min-w-0 flex-1 flex-col">
                  <b>{p.name}</b>
                  <span className="text-xs text-slate-700">
                    {fmtDate(p.date_from)}〜{fmtDate(p.date_to)}・{store(p.store_id)}
                  </span>
                  {p.note && <span className="text-xs text-muted">{p.note}</span>}
                </span>
                <button type="button" onClick={() => toggle.mutate(p)} className="min-h-9 shrink-0 rounded-lg border border-slate-300 px-2 text-xs font-bold">
                  {p.active ? 'ON' : 'OFF'}
                </button>
                <button
                  type="button"
                  onClick={() => window.confirm(t('periods.deleteConfirm')) && remove.mutate(p.id)}
                  className="min-h-9 shrink-0 rounded-lg border border-red-300 px-2 text-xs font-bold text-red-700"
                >
                  ✕
                </button>
              </div>
              {p.active && fit && (
                <table className="w-full text-xs">
                  <thead className="text-slate-600">
                    <tr>
                      <th className="text-left">{t('periods.measured')}</th>
                      {SHIFTS.map((sh) => (
                        <th key={sh} className="text-right">
                          {t(`common:shift.${sh}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {storeIds
                      .filter((s) => !p.store_id || p.store_id === s)
                      .map((s) => (
                        <tr key={s} className="border-t border-line">
                          <td>{storeName(stores.data?.find((x) => x.id === s), 'ja')}</td>
                          {SHIFTS.map((sh) => {
                            const u = fit.uplift.get(`${p.id}|${s}|${sh}`)
                            return (
                              <td key={sh} className="text-right tabular-nums">
                                <b>{effect(u?.uplift ?? null)}</b>
                                {u && (
                                  <span className="block text-[11px] text-slate-500">
                                    {u.uplift === null
                                      ? t('periods.few', { n: u.inside.pairs })
                                      : t('periods.ratio', { in: Math.round((u.inside.sum / u.inside.sumLy - 1) * 100), out: Math.round((u.outside.sum / u.outside.sumLy - 1) * 100) })}
                                  </span>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </li>
          ))}
        </ul>
      )}
      <details className="rounded-xl border border-line p-2">
        <summary className="min-h-10 cursor-pointer py-2 font-bold text-brand">＋ {t('periods.add')}</summary>
        <div className="flex flex-col gap-2 pt-2">
          <TextInput label={t('periods.name')} value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <TextInput label={t('targets.from')} type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
            <TextInput label={t('targets.to')} type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
          </div>
          <label className="flex flex-col gap-1 text-[15px] font-bold">
            {t('targets.store')}
            <select className={cell} value={form.store} onChange={(e) => setForm({ ...form, store: e.target.value })}>
              <option value="">{t('targets.bothStores')}</option>
              {(stores.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {storeName(s, 'ja')}
                </option>
              ))}
            </select>
          </label>
          <TextInput label={t('targets.note')} value={form.note} maxLength={300} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          {error && <ErrorBox message={error} />}
          <Button onClick={() => add.mutate()} disabled={add.isPending}>
            {t('periods.add')}
          </Button>
        </div>
      </details>
    </Card>
  )
}
