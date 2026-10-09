import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../components/Toast'
import { Button, Card, ErrorBox, Spinner, PageTitle } from '../../components/ui'
import { SHIFTS, type DayType } from '../../domain/types'
import { errorMessage, storeName } from '../../lib/format'
import { unwrap, useStores } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import type { TargetBowls } from '../../lib/types'
import { PeriodBar } from './common'
import { shiftMonth, usePeriod } from './data'
import { ManagerTabs } from './ManagerTabs'

const DAY_TYPES: DayType[] = ['weekday', 'weekend_holiday']
const key = (storeId: string, dayType: string, shift: string) => `${storeId}|${dayType}|${shift}`

function useMonthTargets(month: string) {
  return useQuery({
    queryKey: ['target_bowls', 'month', month],
    queryFn: async () => unwrap<TargetBowls[]>(await supabase.from('target_bowls').select('*').eq('month', month)),
  })
}

/** 目標杯数 per month (store × 平日/土日祝 × shift). */
export function TargetsPage() {
  const { t } = useTranslation('manager')
  const toast = useToast()
  const queryClient = useQueryClient()
  const period = usePeriod('month')
  const month = period.range.from // YYYY-MM-01
  const stores = useStores()
  const [edits, setEdits] = useState<Record<string, string>>({})

  const current = useMonthTargets(month)
  const previous = useMonthTargets(`${shiftMonth(month.slice(0, 7), -1)}-01`)

  const saved = new Map((current.data ?? []).map((r) => [key(r.store_id, r.day_type, r.shift), r.bowls]))
  const value = (k: string) => edits[k] ?? (saved.has(k) ? String(saved.get(k)) : '')

  const save = useMutation({
    mutationFn: async () => {
      const rows = (stores.data ?? []).flatMap((s) =>
        DAY_TYPES.flatMap((dt) =>
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
    setEdits(Object.fromEntries((previous.data ?? []).map((r) => [key(r.store_id, r.day_type, r.shift), String(r.bowls)])))

  if (stores.isLoading || current.isLoading) return <Spinner />

  return (
    <div className="flex flex-col gap-3">
      <ManagerTabs />
      <PageTitle title={t('targets.title')} />
      <PeriodBar period={period} allowModes={false} />
      {(current.data ?? []).length === 0 && <p className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">⚠️ {t('targets.empty')}</p>}
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
              </tr>
            </thead>
            <tbody>
              {DAY_TYPES.map((dt) => (
                <tr key={dt}>
                  <th className="py-1 text-left text-xs">{t(`chorei:target.${dt}`)}</th>
                  {SHIFTS.map((shift) => {
                    const k = key(s.id, dt, shift)
                    return (
                      <td key={shift} className="p-1">
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          aria-label={`${storeName(s, 'ja')} ${t(`chorei:target.${dt}`)} ${t(`common:shift.${shift}`)}`}
                          className="min-h-11 w-full rounded-lg border border-slate-300 px-1 text-center"
                          value={value(k)}
                          onChange={(e) => setEdits((x) => ({ ...x, [k]: e.target.value }))}
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
      <Button onClick={() => save.mutate()} disabled={save.isPending || Object.keys(edits).length === 0}>
        {t('targets.save')}
      </Button>
      {save.error && <ErrorBox message={errorMessage(save.error)} />}
    </div>
  )
}
