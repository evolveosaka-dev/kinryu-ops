import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Button, Card, Checkbox, ErrorBox, PageTitle, Segmented, Spinner } from '../../components/ui'
import { signedDiff, type SalesReport } from '../../domain/sales'
import { addDays, formatShortDate } from '../../domain/time'
import { SHIFTS } from '../../domain/types'
import { cx } from '../../lib/cx'
import { errorMessage, storeName } from '../../lib/format'
import { unwrap, useStores } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { fetchLossEvents, useSalesReports } from '../sales/data'
import { PeriodBar } from './common'
import { today, usePeriod } from './data'
import { ManagerTabs } from './ManagerTabs'

const flagged = (r: SalesReport) => Boolean(r.noodle_diff) || Boolean(r.cash_diff)

/** 管理 → 販売日報: each day × store × shift (✓ sent, ⚠ 差引 / 過不足 ≠ 0, 下書き, — none), Excel in the paper layout. */
export function SalesAdminPage() {
  const { t } = useTranslation('manager')
  const stores = useStores()
  const period = usePeriod('month')
  const { from, to } = period.range
  const reports = useSalesReports(from, to)
  const [storeFilter, setStoreFilter] = useState('all')
  const [onlyFlagged, setOnlyFlagged] = useState(false)

  const shownStores = (stores.data ?? []).filter((s) => storeFilter === 'all' || s.id === storeFilter)
  const byKey = new Map((reports.data ?? []).map((r) => [`${r.business_date}|${r.store_id}|${r.shift}`, r]))
  const last = to < today() ? to : today()
  const days: string[] = []
  for (let d = last; d >= from; d = addDays(d, -1)) days.push(d)
  const shownDays = onlyFlagged ? days.filter((d) => shownStores.some((s) => SHIFTS.some((sh) => { const r = byKey.get(`${d}|${s.id}|${sh}`); return r && flagged(r) }))) : days
  const inScope = (reports.data ?? []).filter((r) => storeFilter === 'all' || r.store_id === storeFilter)
  const flaggedCount = inScope.filter(flagged).length

  const download = useMutation({
    mutationFn: async () => {
      const [{ exportSalesXlsx }, losses, noodles] = await Promise.all([
        import('../sales/excel'),
        fetchLossEvents(from, to),
        supabase.from('stock_items').select('id').eq('code', 'noodle'),
      ])
      const ids = new Set(unwrap<{ id: string }[]>(noodles).map((n) => n.id))
      const store = stores.data?.find((s) => s.id === storeFilter)
      await exportSalesXlsx(`販売日報_${from.slice(0, 7)}${store ? `_${store.name_ja}` : ''}.xlsx`, inScope, stores.data ?? [], losses, ids)
    },
  })

  if (stores.isLoading || reports.isLoading) return <Spinner />
  if (reports.error) return <ErrorBox message={errorMessage(reports.error)} />

  return (
    <div className="flex flex-col gap-3">
      <ManagerTabs />
      <PageTitle title={t('sales.title')} subtitle={t('sales.subtitle')} />
      <PeriodBar period={period} allowModes={false} />
      <Segmented
        label=""
        value={storeFilter}
        onChange={setStoreFilter}
        options={[{ value: 'all', label: t('sales.allStores') }, ...(stores.data ?? []).map((s) => ({ value: s.id, label: storeName(s, 'ja') }))]}
      />
      <Card className="flex flex-col gap-2">
        <p className="text-sm">
          {t('sales.count', { n: inScope.length })}
          {flaggedCount > 0 && (
            <button type="button" onClick={() => setOnlyFlagged(!onlyFlagged)} className="ml-2 min-h-9 font-bold text-red-700 underline decoration-dotted underline-offset-2">
              ⚠ {t('sales.flagged', { n: flaggedCount })} ›
            </button>
          )}
        </p>
        <Checkbox checked={onlyFlagged} onChange={setOnlyFlagged}>
          {t('sales.onlyFlagged')}
        </Checkbox>
        <Button onClick={() => download.mutate()} disabled={download.isPending || inScope.length === 0}>
          {download.isPending ? t('common:action.loading') : `📥 ${t('sales.export')}`}
        </Button>
        <p className="text-xs text-muted">{t('sales.exportHint')}</p>
        {download.error && <ErrorBox message={errorMessage(download.error)} />}
      </Card>

      <p className="text-xs text-muted">{t('sales.legend')}</p>
      <Card className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-line text-xs">
              <th className="p-2 text-left">{t('sales.date')}</th>
              {shownStores.map((s) => (
                <th key={s.id} className="p-2 text-center" colSpan={3}>
                  {storeName(s, 'ja')}
                  <span className="block font-normal text-muted">早・中・遅</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shownDays.map((d) => (
              <tr key={d} className="border-b border-line">
                <td className="p-2 font-bold whitespace-nowrap">{formatShortDate(d)}</td>
                {shownStores.flatMap((s) =>
                  SHIFTS.map((sh) => {
                    const r = byKey.get(`${d}|${s.id}|${sh}`)
                    const bad = r && flagged(r)
                    return (
                      <td key={`${s.id}${sh}`} className="p-0.5 text-center">
                        <Link
                          to={`/sales?store=${s.code}&date=${d}&shift=${sh}`}
                          title={r ? `麺 ${signedDiff(r.noodle_diff)} / 現金 ${signedDiff(r.cash_diff, '円')}` : ''}
                          className={cx(
                            'flex min-h-10 min-w-9 items-center justify-center rounded-lg font-bold',
                            !r && 'text-slate-400',
                            r && bad && 'bg-red-100 text-red-800',
                            r && !bad && r.status === 'submitted' && 'bg-green-100 text-green-800',
                            r && !bad && r.status === 'draft' && 'bg-slate-200 text-slate-700',
                          )}
                        >
                          {!r ? '—' : bad ? '⚠' : r.status === 'submitted' ? '✓' : '…'}
                        </Link>
                      </td>
                    )
                  }),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
