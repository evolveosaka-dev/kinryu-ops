import { useQuery } from '@tanstack/react-query'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Sheet } from '../../../components/Sheet'
import { Card, Spinner } from '../../../components/ui'
import { dayTypeCache } from '../../../domain/forecast'
import { compareDay, latestActual, yoyPct, type CompareRow } from '../../../domain/salesCompare'
import { dayView, DATA_FROM, indexSales, type Ctx } from '../../../domain/salesAnalysis'
import { addDays, formatShortDate, weekdayOf } from '../../../domain/time'
import { SHIFTS, type Shift } from '../../../domain/types'
import { cx } from '../../../lib/cx'
import { storeName } from '../../../lib/format'
import { unwrap, useHolidays, useSalesPeriods, useStores, useTargetEvents, useTargets } from '../../../lib/queries'
import { supabase } from '../../../lib/supabase'
import { today } from '../data'
import { TapNum } from '../drill'
import { useDailySales, useWeather } from './data'
import { Formula, Sources } from './explain'
import { ForecastExplain, type ForecastOpen } from './ForecastExplain'

// 管理 → ダッシュボード: 実績・予測・前年 of one day (default: yesterday, or the latest day with figures), per store × shift.
// 予測 = the forecast made the day before (only earlier figures); 前年 = 364 days before. Every number opens its source.

interface SourceRow {
  store_id: string
  business_date: string
  shift: Shift
  source: 'excel' | 'report'
}

interface SalesSyncStatus {
  at: string
  ok: boolean
  last?: string | null
  error?: string
}

/** Where the figures of the two days come from (販売日報 or the 販売杯数 workbook) + the last automatic import. */
function useDaySources(dates: string[]) {
  return useQuery({
    queryKey: ['analysis', 'daily_sales_sources', ...dates],
    staleTime: 60_000,
    queryFn: async () => {
      const rows = unwrap<SourceRow[]>(await supabase.from('daily_sales').select('store_id, business_date, shift, source').in('business_date', dates))
      const kv = unwrap<{ value: string }[]>(await supabase.from('app_kv').select('value').eq('key', 'sales_sync_status'))
      return { rows, status: kv[0] ? (JSON.parse(kv[0].value) as SalesSyncStatus) : null }
    },
  })
}

type Col = 'actual' | 'forecast' | 'lastYear'
const signed = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v}`)
type Info = { kind: 'cell'; row: CompareRow; col: 'actual' | 'lastYear' } | { kind: 'sum'; store: string | null; col: Col }

export function SalesCompareCard() {
  const { t } = useTranslation('manager')
  const stores = useStores()
  const holidays = useHolidays()
  const targets = useTargets()
  const events = useTargetEvents()
  const periods = useSalesPeriods()
  const sales = useDailySales()
  const weather = useWeather()
  const now = today()
  const [picked, setPicked] = useState<string | null>(null)
  const [info, setInfo] = useState<Info | null>(null)
  const [explain, setExplain] = useState<ForecastOpen | null>(null)

  const base = useMemo(() => {
    if (!stores.data || !holidays.data || !targets.data || !events.data || !sales.data || !weather.data) return null
    const ctx: Ctx = { sales: indexSales(sales.data), targets: targets.data, events: events.data, holidays: holidays.data, storeIds: stores.data.map((s) => s.id), shifts: [...SHIFTS] }
    return { ctx, typeOf: dayTypeCache(holidays.data), latest: latestActual(ctx, addDays(now, -1)) }
  }, [stores.data, holidays.data, targets.data, events.data, sales.data, weather.data, now])
  const date = picked ?? base?.latest ?? addDays(now, -1)
  const day = useMemo(
    () => (base && weather.data && periods.data ? compareDay(base.ctx, base.typeOf, weather.data, date, DATA_FROM, periods.data) : null),
    [base, weather.data, periods.data, date],
  )
  const sources = useDaySources(day ? [day.date, day.lastYearDate] : [])

  if (weather.error) return null
  if (!base || !day) return <Spinner />
  const short = (id: string) => storeName(stores.data?.find((s) => s.id === id), 'ja').replace('店', '')
  const storeRefs = (stores.data ?? []).map((s) => ({ id: s.id, code: s.code, label: short(s.id) }))
  const dayLabel = (d: string) => `${formatShortDate(d)}(${t(`weekday.${weekdayOf(d)}`)})`
  const lyLabel = `${day.lastYearDate.slice(0, 4)}/${dayLabel(day.lastYearDate)}`
  const dayType = dayView(base.ctx, day.date).dayType
  const status = sources.data?.status
  const sourceOf = (d: string, store: string, shift: Shift) => sources.data?.rows.find((r) => r.business_date === d && r.store_id === store && r.shift === shift)?.source
  const rate = (a: number | null, f: number | null) => (a !== null && f ? Math.round((a / f) * 100) : null)
  const num = (v: number | null) => (v === null ? '—' : v.toLocaleString())
  const slotRow = (r: CompareRow) => ({ ...r.forecast, target: null })

  const cells = (vals: { actual: number | null; forecast: number | null; lastYear: number | null }, open: (c: Col) => void, bold?: boolean) => {
    const rr = rate(vals.actual, vals.forecast)
    const yy = yoyPct(vals.actual, vals.lastYear)
    return (
      <>
        <td className="text-right tabular-nums">
          <TapNum onOpen={() => open('actual')} className={cx(bold && 'font-bold')}>
            {num(vals.actual)}
            {rr !== null && <span className={cx('block text-[11px] font-bold', rr < 90 ? 'text-red-700' : rr >= 110 ? 'text-green-700' : 'text-slate-500')}>{rr}%</span>}
          </TapNum>
        </td>
        <td className="text-right tabular-nums">
          <TapNum onOpen={() => open('forecast')} className={cx(bold && 'font-bold')}>
            {num(vals.forecast)}
          </TapNum>
        </td>
        <td className="pr-1 text-right tabular-nums">
          <TapNum onOpen={() => open('lastYear')} className={cx(bold && 'font-bold')}>
            {num(vals.lastYear)}
            {yy !== null && <span className={cx('block text-[11px] font-bold', yy < -5 ? 'text-red-700' : yy >= 0 ? 'text-green-700' : 'text-amber-700')}>{signed(yy)}%</span>}
          </TapNum>
        </td>
      </>
    )
  }
  const openCell = (r: CompareRow) => (c: Col) => (c === 'forecast' ? setExplain({ kind: 'slot', slot: slotRow(r), dayType }) : setInfo({ kind: 'cell', row: r, col: c }))
  const openSum = (store: string | null) => (c: Col) =>
    c === 'forecast' && store === null ? setExplain({ kind: 'day', date: day.date, dayType, slots: day.rows.map(slotRow) }) : setInfo({ kind: 'sum', store, col: c })

  return (
    <Card className="flex flex-col gap-2">
      {explain && (
        <ForecastExplain open={explain} setOpen={setExplain} stores={storeRefs} factors={day.model.factors} weatherFactors={day.model.wf} rainFrom={DATA_FROM} check={day.model.check} />
      )}
      {info && (
        <CompareInfo
          info={info}
          day={day}
          dayLabel={dayLabel}
          lyLabel={lyLabel}
          short={short}
          storeCode={(id) => stores.data?.find((s) => s.id === id)?.code ?? ''}
          sourceOf={sourceOf}
          onClose={() => setInfo(null)}
        />
      )}
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold">📊 {t('compare.title')}</h2>
        <div className="flex items-center gap-1">
          <button type="button" aria-label={t('compare.prev')} onClick={() => setPicked(addDays(date, -1))} className="min-h-9 min-w-9 rounded-lg bg-surface font-bold">
            ‹
          </button>
          <span className="font-bold whitespace-nowrap">{dayLabel(day.date)}</span>
          <button
            type="button"
            aria-label={t('compare.next')}
            disabled={date >= addDays(now, -1)}
            onClick={() => setPicked(addDays(date, 1))}
            className="min-h-9 min-w-9 rounded-lg bg-surface font-bold disabled:opacity-30"
          >
            ›
          </button>
        </div>
      </div>
      <p className="text-xs text-muted">
        {t('compare.lyLabel', { date: lyLabel })}・{t(`chorei:target.${dayType}`)}
      </p>
      {status && !status.ok && <p className="rounded-lg bg-red-50 p-2 text-sm font-bold text-red-900">✗ {t('compare.syncFail', { error: status.error })}</p>}
      {day.rows.every((r) => r.actual === null) && <p className="rounded-lg bg-amber-50 p-2 text-sm font-bold text-amber-900">{t('compare.noActual')}</p>}
      <table className="w-full text-sm">
        <thead className="text-xs text-slate-600">
          <tr>
            <th className="text-left">{t('compare.colWhere')}</th>
            <th className="text-right">{t('compare.colActual')}</th>
            <th className="text-right">{t('compare.colForecast')}</th>
            <th className="pr-1 text-right">{t('compare.colLastYear')}</th>
          </tr>
        </thead>
        <tbody>
          {base.ctx.storeIds.map((store) => (
            <StoreRows key={store} label={short(store)}>
              {day.rows
                .filter((r) => r.store === store)
                .map((r) => (
                  <tr key={r.shift} className="border-t border-line">
                    <td className="py-0.5 pl-3">{t(`common:shift.${r.shift}`)}</td>
                    {cells({ actual: r.actual, forecast: r.forecast.value, lastYear: r.lastYear }, openCell(r))}
                  </tr>
                ))}
              <tr className="border-t border-line bg-slate-50">
                <td className="py-0.5 pl-3 font-bold">{t('compare.total')}</td>
                {cells(day.sums[store]!, openSum(store), true)}
              </tr>
            </StoreRows>
          ))}
          <tr className="border-t-2 border-slate-400 bg-sky-50">
            <td className="py-1 font-bold">{t('compare.all')}</td>
            {cells(day.sums.all, openSum(null), true)}
          </tr>
        </tbody>
      </table>
      {day.model.check.error !== null && (
        <p className="text-xs">
          <TapNum onOpen={() => setExplain({ kind: 'error' })} className="text-xs">
            {t('compare.check', { err: day.model.check.error, bias: signed(day.model.check.bias) })}
          </TapNum>
        </p>
      )}
      <p className="text-xs text-muted">
        {t('compare.legend')} {t('compare.tapHint')}
      </p>
    </Card>
  )
}

function StoreRows({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <tr className="border-t border-line">
        <td colSpan={4} className="pt-1.5 font-bold">
          {label}
        </td>
      </tr>
      {children}
    </>
  )
}

function CompareInfo({
  info,
  day,
  dayLabel,
  lyLabel,
  short,
  storeCode,
  sourceOf,
  onClose,
}: {
  info: Info
  day: ReturnType<typeof compareDay>
  dayLabel: (d: string) => string
  lyLabel: string
  short: (id: string) => string
  storeCode: (id: string) => string
  sourceOf: (d: string, store: string, shift: Shift) => 'excel' | 'report' | undefined
  onClose: () => void
}) {
  const { t } = useTranslation('manager')
  const shiftName = (s: Shift) => t(`common:shift.${s}`)
  if (info.kind === 'cell') {
    const r = info.row
    const where = `${short(r.store)} ${shiftName(r.shift)}`
    const d = info.col === 'actual' ? day.date : day.lastYearDate
    const v = info.col === 'actual' ? r.actual : r.lastYear
    const src = sourceOf(d, r.store, r.shift)
    return (
      <Sheet title={t(info.col === 'actual' ? 'compare.x.actualTitle' : 'compare.x.lyTitle', { date: dayLabel(day.date), where })} onClose={onClose}>
        {v === null ? (
          <p className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">{t('compare.x.none', { date: info.col === 'actual' ? dayLabel(d) : lyLabel })}</p>
        ) : (
          <Formula text={info.col === 'actual' ? t('compare.x.actualFormula', { n: v.toLocaleString() }) : t('compare.x.lyFormula', { ly: lyLabel, n: v.toLocaleString() })} />
        )}
        {info.col === 'lastYear' && r.actual !== null && r.lastYear ? (
          <Formula text={t('compare.x.yoyFormula', { a: r.actual.toLocaleString(), ly: r.lastYear.toLocaleString(), p: signed(yoyPct(r.actual, r.lastYear)) })} />
        ) : null}
        {info.col === 'lastYear' && <p className="text-sm">{t('compare.x.lyNote')}</p>}
        {src && <p className="rounded-lg bg-surface p-2 text-sm">{t(src === 'report' ? 'compare.x.fromReport' : 'compare.x.fromExcel')}</p>}
        {src === 'report' && (
          <Link to={`/sales?store=${storeCode(r.store)}&date=${d}&shift=${r.shift}`} className="font-bold text-brand underline">
            {t('compare.x.openReport')}
          </Link>
        )}
        <Sources keys={info.col === 'actual' ? ['sales'] : ['sales', 'lastYear']} />
      </Sheet>
    )
  }
  const rows = day.rows.filter((r) => info.store === null || r.store === info.store)
  const val = (r: CompareRow) => (info.col === 'actual' ? r.actual : info.col === 'forecast' ? r.forecast.value : r.lastYear)
  const sum = day.sums[info.store ?? 'all']![info.col]
  const where = info.store === null ? t('compare.all') : short(info.store)
  const col = t(`compare.col${info.col === 'actual' ? 'Actual' : info.col === 'forecast' ? 'Forecast' : 'LastYear'}`)
  return (
    <Sheet title={t('compare.x.sumTitle', { date: dayLabel(day.date), where, col })} onClose={onClose}>
      {sum === null ? (
        <p className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">{t('compare.x.sumMissing')}</p>
      ) : (
        <Formula text={t('compare.x.sumFormula', { col, parts: rows.map((r) => val(r)!.toLocaleString()).join(' + '), n: sum.toLocaleString() })} />
      )}
      <ul className="flex flex-col gap-1 text-sm">
        {rows.map((r) => (
          <li key={`${r.store}${r.shift}`} className="flex justify-between border-b border-line py-1">
            <span>
              {short(r.store)} {shiftName(r.shift)}
            </span>
            <b className="tabular-nums">{val(r) === null ? '—' : val(r)!.toLocaleString()}</b>
          </li>
        ))}
      </ul>
      {info.col === 'lastYear' && day.sums[info.store ?? 'all']!.actual !== null && sum ? (
        <Formula text={t('compare.x.yoyFormula', { a: day.sums[info.store ?? 'all']!.actual!.toLocaleString(), ly: sum.toLocaleString(), p: signed(yoyPct(day.sums[info.store ?? 'all']!.actual, sum)) })} />
      ) : null}
      {info.col === 'lastYear' && <p className="text-sm">{t('compare.x.lyNote')}</p>}
      {info.col === 'forecast' && <p className="text-sm">{t('compare.x.forecastNote', { date: dayLabel(day.date) })}</p>}
      <Sources keys={info.col === 'actual' ? ['sales'] : info.col === 'forecast' ? ['sales', 'events', 'weather'] : ['sales', 'lastYear']} />
    </Sheet>
  )
}
