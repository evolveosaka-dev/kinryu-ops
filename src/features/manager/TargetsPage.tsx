import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../components/Toast'
import { Button, Card, ErrorBox, Spinner, PageTitle, TextInput } from '../../components/ui'
import { LEGACY_DAY_TYPES, TARGET_DAY_TYPES, TARGETS_V2_FROM, targetDayType, type TargetEvent } from '../../domain/targets'
import { addDays, formatShortDate } from '../../domain/time'
import { SHIFTS } from '../../domain/types'
import { errorMessage, storeName } from '../../lib/format'
import { unwrap, useHolidays, useStores, useTargetEvents } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import type { TargetBowls } from '../../lib/types'
import { PeriodBar } from './common'
import { shiftMonth, usePeriod } from './data'
import { ManagerTabs } from './ManagerTabs'
import { SalesPeriodsCard } from './SalesPeriodsCard'

const key = (storeId: string, dayType: string, shift: string) => `${storeId}|${dayType}|${shift}`
const cell = 'min-h-11 w-full rounded-lg border border-slate-300 px-1 text-center'

function useMonthTargets(month: string) {
  return useQuery({
    queryKey: ['target_bowls', 'month', month],
    queryFn: async () => unwrap<TargetBowls[]>(await supabase.from('target_bowls').select('*').eq('month', month)),
  })
}

/** イベント (阪神, Halloween…): % per store and shift on a date; the month shown above. */
function EventsCard({ month }: { month: string }) {
  const { t } = useTranslation('manager')
  const toast = useToast()
  const queryClient = useQueryClient()
  const stores = useStores()
  const events = useTargetEvents()
  const end = `${shiftMonth(month.slice(0, 7), 1)}-01`
  // consecutive days with the same event / store / % are one line (10/14〜10/19)
  const groups: { first: TargetEvent; last: string; ids: string[] }[] = []
  for (const e of (events.data ?? []).filter((x) => x.event_date >= month && x.event_date < end)) {
    const same = (g: (typeof groups)[number]) =>
      g.first.name === e.name && g.first.store_id === e.store_id && g.first.active === e.active && g.first.note === e.note &&
      g.first.early_pct === e.early_pct && g.first.middle_pct === e.middle_pct && g.first.late_pct === e.late_pct && addDays(g.last, 1) === e.event_date
    const g = groups.find(same)
    if (g) {
      g.last = e.event_date
      g.ids.push(e.id)
    } else groups.push({ first: e, last: e.event_date, ids: [e.id] })
  }
  const [form, setForm] = useState({ from: month, to: '', name: '', store: '', early: '0', middle: '0', late: '0', note: '' })
  const [error, setError] = useState<string | null>(null)
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['target_events'] })

  const add = useMutation({
    mutationFn: async () => {
      const pct = [form.early, form.middle, form.late].map((v) => Number(v))
      if (!form.name.trim() || !form.from || pct.some((p) => !Number.isInteger(p) || p < -90 || p > 300)) throw new Error(t('targets.eventInvalid'))
      const to = form.to && form.to >= form.from ? form.to : form.from
      const rows = []
      for (let d = form.from; d <= to && rows.length < 31; d = addDays(d, 1)) {
        rows.push({ event_date: d, name: form.name.trim(), store_id: form.store || null, early_pct: pct[0], middle_pct: pct[1], late_pct: pct[2], note: form.note.trim() || null })
      }
      unwrap(await supabase.from('target_events').insert(rows))
    },
    onSuccess: () => {
      setError(null)
      setForm((f) => ({ ...f, name: '', note: '' }))
      toast(t('users.saved'))
      refresh()
    },
    onError: (e) => setError(errorMessage(e)),
  })
  const toggle = useMutation({
    mutationFn: async (g: (typeof groups)[number]) => unwrap(await supabase.from('target_events').update({ active: !g.first.active }).in('id', g.ids)),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: async (ids: string[]) => unwrap(await supabase.from('target_events').delete().in('id', ids)),
    onSuccess: refresh,
  })
  const pct = (n: number) => (n === 0 ? '±0' : `${n > 0 ? '+' : ''}${n}%`)
  const store = (id: string | null) => (id ? storeName(stores.data?.find((s) => s.id === id), 'ja') : t('targets.bothStores'))

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-bold">🎉 {t('targets.events')}</h2>
      <p className="text-xs text-muted">{t('targets.eventsHelp')}</p>
      {groups.length === 0 ? (
        <p className="text-sm text-muted">{t('targets.noEvents')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line text-sm">
          {groups.map(({ first: e, last, ids }, gi) => (
            <li key={e.id} className={`flex items-start gap-2 py-2 ${e.active ? '' : 'opacity-50'}`}>
              <span className="w-24 shrink-0 font-bold">
                {formatShortDate(e.event_date)}
                {last !== e.event_date && <span className="block">〜{formatShortDate(last)}</span>}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <b>{e.name}</b>
                <span className="text-xs text-slate-700">
                  {store(e.store_id)}・{t('common:shift.early')} {pct(e.early_pct)} / {t('common:shift.middle')} {pct(e.middle_pct)} / {t('common:shift.late')} {pct(e.late_pct)}
                </span>
                {e.note && <span className="text-xs text-muted">{e.note}</span>}
              </span>
              <button type="button" onClick={() => toggle.mutate(groups[gi]!)} className="min-h-9 shrink-0 rounded-lg border border-slate-300 px-2 text-xs font-bold">
                {e.active ? 'ON' : 'OFF'}
              </button>
              <button type="button" onClick={() => window.confirm(t('targets.deleteConfirm')) && remove.mutate(ids)} className="min-h-9 shrink-0 rounded-lg border border-red-300 px-2 text-xs font-bold text-red-700">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <details className="rounded-xl border border-line p-2">
        <summary className="min-h-10 cursor-pointer py-2 font-bold text-brand">＋ {t('targets.addEvent')}</summary>
        <div className="flex flex-col gap-2 pt-2">
          <TextInput label={t('targets.eventName')} value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} />
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
          <div className="grid grid-cols-3 gap-2">
            {(['early', 'middle', 'late'] as const).map((sh) => (
              <TextInput key={sh} label={`${t(`common:shift.${sh}`)}（%）`} inputMode="numeric" value={form[sh]} onChange={(e) => setForm({ ...form, [sh]: e.target.value })} className="text-center" />
            ))}
          </div>
          <TextInput label={t('targets.note')} value={form.note} maxLength={300} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          {error && <ErrorBox message={error} />}
          <Button onClick={() => add.mutate()} disabled={add.isPending}>
            {t('targets.addEvent')}
          </Button>
        </div>
      </details>
    </Card>
  )
}

/** 「目標杯数の設定基準」: how the day types, initial values and events work (opens on tap). */
function TargetBasis() {
  const { t } = useTranslation('manager')
  const part = (h: string, body: string) => (
    <section className="flex flex-col gap-1">
      <h3 className="font-bold">{t(`targets.basis.${h}`)}</h3>
      <p className="whitespace-pre-line">{t(`targets.basis.${body}`)}</p>
    </section>
  )
  return (
    <details className="rounded-xl border border-line bg-white p-2">
      <summary className="min-h-10 cursor-pointer py-2 font-bold text-brand">
        📏 {t('targets.basis.title')}
        <span className="ml-2 text-xs font-normal text-muted">{t('targets.basis.tap')}</span>
      </summary>
      <div className="flex flex-col gap-3 pt-2 text-sm leading-relaxed">
        {part('whatH', 'what')}
        <section className="flex flex-col gap-1">
          <h3 className="font-bold">{t('targets.basis.typesH')}</h3>
          <p>{t('targets.basis.typesIntro')}</p>
          <dl className="flex flex-col gap-1.5">
            {TARGET_DAY_TYPES.map((dt) => (
              <div key={dt} className="rounded-lg bg-slate-50 p-2">
                <dt className="font-bold">{t(`chorei:target.${dt}`)}</dt>
                <dd className="whitespace-pre-line">{t(`targets.basis.type.${dt}`)}</dd>
              </div>
            ))}
          </dl>
          <p className="whitespace-pre-line text-slate-700">{t('targets.basis.typesExample')}</p>
        </section>
        {part('initialH', 'initial')}
        {part('eventsH', 'events')}
        {part('useH', 'use')}
        {part('changeH', 'change')}
      </div>
    </details>
  )
}

/** 目標杯数 per month (store × day type × shift) and the events of the month. */
export function TargetsPage() {
  const { t } = useTranslation('manager')
  const toast = useToast()
  const queryClient = useQueryClient()
  const period = usePeriod('month')
  const month = period.range.from // YYYY-MM-01
  const stores = useStores()
  const holidays = useHolidays()
  const [edits, setEdits] = useState<Record<string, string>>({})
  const dayTypes: readonly string[] = month >= TARGETS_V2_FROM ? TARGET_DAY_TYPES : LEGACY_DAY_TYPES

  const current = useMonthTargets(month)
  const previous = useMonthTargets(`${shiftMonth(month.slice(0, 7), -1)}-01`)

  const saved = new Map((current.data ?? []).map((r) => [key(r.store_id, r.day_type, r.shift), r.bowls]))
  const value = (k: string) => edits[k] ?? (saved.has(k) ? String(saved.get(k)) : '')

  // how many days of each type this month has
  const counts = new Map<string, number>()
  if (holidays.data && month >= TARGETS_V2_FROM) {
    const end = `${shiftMonth(month.slice(0, 7), 1)}-01`
    for (let d = month; d < end; d = addDays(d, 1)) {
      const k = targetDayType(d, holidays.data)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      const rows = (stores.data ?? []).flatMap((s) =>
        dayTypes.flatMap((dt) =>
          SHIFTS.map((shift) => ({ store_id: s.id, month, day_type: dt, shift, bowls: Number(value(key(s.id, dt, shift))) })),
        ),
      )
      if (rows.some((r) => !Number.isInteger(r.bowls) || r.bowls < 0 || value(key(r.store_id, r.day_type, r.shift)) === '')) throw new Error(t('targets.fillAll'))
      unwrap(await supabase.from('target_bowls').upsert(rows, { onConflict: 'store_id,month,shift,day_type' }))
    },
    onSuccess: () => {
      setEdits({})
      toast(t('users.saved'))
      void queryClient.invalidateQueries({ queryKey: ['target_bowls'] })
    },
  })

  const copyPrevious = () =>
    setEdits(Object.fromEntries((previous.data ?? []).filter((r) => dayTypes.includes(r.day_type)).map((r) => [key(r.store_id, r.day_type, r.shift), String(r.bowls)])))

  if (stores.isLoading || current.isLoading) return <Spinner />

  return (
    <div className="flex flex-col gap-3">
      <ManagerTabs />
      <PageTitle title={t('targets.title')} />
      <PeriodBar period={period} allowModes={false} />
      {(current.data ?? []).length === 0 && <p className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">⚠️ {t('targets.empty')}</p>}
      {month >= TARGETS_V2_FROM && <p className="text-xs text-muted">{t('targets.typesHelp')}</p>}
      {month >= TARGETS_V2_FROM && <TargetBasis />}
      {(previous.data ?? []).length > 0 && (
        <Button variant="secondary" onClick={copyPrevious}>
          {t('targets.copyPrevious')}
        </Button>
      )}
      {(stores.data ?? []).map((s) => (
        <Card key={s.id} className="flex flex-col gap-2">
          <h2 className="font-bold">{storeName(s, 'ja')}</h2>
          <table className="w-full text-center text-sm">
            <thead className="text-xs text-slate-600">
              <tr>
                <th />
                {SHIFTS.map((shift) => (
                  <th key={shift}>{t(`common:shift.${shift}`)}</th>
                ))}
                <th>{t('targets.total')}</th>
              </tr>
            </thead>
            <tbody>
              {dayTypes.map((dt) => {
                const total = SHIFTS.reduce((sum, shift) => sum + (Number(value(key(s.id, dt, shift))) || 0), 0)
                return (
                  <tr key={dt}>
                    <th className="py-1 text-left text-xs">
                      {t(`chorei:target.${dt}`)}
                      {counts.has(dt) && <span className="block font-normal text-muted">{t('targets.days', { n: counts.get(dt) })}</span>}
                    </th>
                    {SHIFTS.map((shift) => {
                      const k = key(s.id, dt, shift)
                      return (
                        <td key={shift} className="p-1">
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            aria-label={`${storeName(s, 'ja')} ${t(`chorei:target.${dt}`)} ${t(`common:shift.${shift}`)}`}
                            className={cell}
                            value={value(k)}
                            onChange={(e) => setEdits((x) => ({ ...x, [k]: e.target.value }))}
                          />
                        </td>
                      )
                    })}
                    <td className="p-1 font-bold tabular-nums">{total || ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      ))}
      <Button onClick={() => save.mutate()} disabled={save.isPending || Object.keys(edits).length === 0}>
        {t('targets.save')}
      </Button>
      {save.error && <ErrorBox message={errorMessage(save.error)} />}
      <EventsCard month={month} />
      <SalesPeriodsCard />
    </div>
  )
}
