import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, Spinner } from '../../../components/ui'
import { backtest, dayTypeCache, forecastSlot, rainFactors, rainOf, RAINY_MM, weatherFactors } from '../../../domain/forecast'
import { dayView, DATA_FROM, indexSales, type Ctx } from '../../../domain/salesAnalysis'
import { addDays, formatShortDate, weekdayOf } from '../../../domain/time'
import { SHIFTS } from '../../../domain/types'
import { cx } from '../../../lib/cx'
import { storeName } from '../../../lib/format'
import { useHolidays, useStores, useTargetEvents, useTargets } from '../../../lib/queries'
import { today } from '../data'
import { TapNum } from '../drill'
import { useDailySales, useWeather } from './data'
import { ForecastExplain, type ForecastOpen } from './ForecastExplain'

/**
 * 杯数の予測 for the next `days` days (today included), store × shift, with the target and the rain.
 * `compact`: only today and tomorrow, for the ダッシュボード. Every figure opens its calculation (ForecastExplain).
 */
export function ForecastCard({ days, compact = false }: { days: number; compact?: boolean }) {
  const { t } = useTranslation('manager')
  const stores = useStores()
  const holidays = useHolidays()
  const targets = useTargets()
  const events = useTargetEvents()
  const sales = useDailySales()
  const weather = useWeather()
  const [open, setOpen] = useState<string | null>(null)
  const [explain, setExplain] = useState<ForecastOpen | null>(null)
  const now = today()

  const result = useMemo(() => {
    if (!stores.data || !holidays.data || !targets.data || !events.data || !sales.data || !weather.data) return null
    const wx = weather.data
    const rain = rainOf(wx)
    const ctx: Ctx = {
      sales: indexSales(sales.data),
      targets: targets.data,
      events: events.data,
      holidays: holidays.data,
      storeIds: stores.data.map((s) => s.id),
      shifts: [...SHIFTS],
    }
    const typeOf = dayTypeCache(holidays.data)
    // the factors are measured before the 28 backtest days, so the backtest is a fair test of them
    const fitTo = addDays(now, -29)
    const factors = rainFactors(ctx, typeOf, rain, DATA_FROM, fitTo)
    const wf = weatherFactors(ctx, typeOf, wx, DATA_FROM, fitTo)
    const check = backtest(ctx, typeOf, rain, factors, now, 28, { wx, factors: wf })
    const wIn = { wx, rain: factors, factors: wf, mode: check.weatherChosen }
    const dates = Array.from({ length: days }, (_, i) => addDays(now, i))
    const rows = dates.map((date) => {
      const view = dayView(ctx, date)
      const slots = ctx.storeIds.flatMap((store) =>
        SHIFTS.map((shift) => ({ ...forecastSlot(ctx, typeOf, date, store, shift, rain, factors, check.chosen, wIn), target: view.slots.find((s) => s.store === store && s.shift === shift)?.target ?? null })),
      )
      const value = slots.reduce((a, s) => a + (s.value ?? 0), 0)
      const target = slots.every((s) => s.target !== null) ? slots.reduce((a, s) => a + s.target!, 0) : null
      return { date, dayType: view.dayType, slots, value, target }
    })
    return { rows, factors, wf, check }
  }, [stores.data, holidays.data, targets.data, events.data, sales.data, weather.data, days, now])

  if (weather.error) return <Card className="text-sm text-muted">🔮 {t('forecast.weatherError')}</Card>
  if (!result) return compact ? null : <Spinner />
  const short = (id: string) => storeName(stores.data?.find((s) => s.id === id), 'ja').replace('店', '')
  const storeRefs = (stores.data ?? []).map((s) => ({ id: s.id, code: s.code, label: short(s.id) }))
  const pct = (v: number | null, tg: number | null) => (v !== null && tg ? Math.round((v / tg) * 100) : null)
  const rows = compact ? result.rows.slice(0, 2) : result.rows
  const pctFactor = (f: number) => Math.round((f - 1) * 100)

  return (
    <Card className="flex flex-col gap-2">
      {explain && <ForecastExplain open={explain} setOpen={setExplain} stores={storeRefs} factors={result.factors} weatherFactors={result.wf} rainFrom={DATA_FROM} check={result.check} />}
      <h2 className="font-bold">🔮 {compact ? t('forecast.titleShort') : t('forecast.title')}</h2>
      <p className="text-xs text-muted">{t('forecast.tapHint')}</p>
      <ul className="flex flex-col gap-1.5">
        {rows.map((r) => {
          const rate = pct(r.value, r.target)
          const isOpen = compact || open === r.date
          const openDay = () => setExplain({ kind: 'day', date: r.date, dayType: r.dayType, slots: r.slots })
          return (
            <li key={r.date} className="rounded-xl border border-line">
              <div className="flex w-full items-center justify-between gap-2 px-3 py-2">
                <button
                  type="button"
                  disabled={compact}
                  onClick={() => setOpen(isOpen ? null : r.date)}
                  className="min-h-9 flex-1 text-left font-bold"
                >
                  {r.date === now ? t('forecast.today') : r.date === addDays(now, 1) ? t('forecast.tomorrow') : ''} {formatShortDate(r.date)}({t(`weekday.${weekdayOf(r.date)}`)})
                  <span className="ml-1 text-xs font-normal text-muted">{t(`chorei:target.${r.dayType}`)}</span>
                  {r.slots.some((s) => (s.rainMm ?? 0) >= RAINY_MM) && ' 🌧'}
                </button>
                <TapNum onOpen={openDay} className="text-right">
                  <b className="tabular-nums">{r.value.toLocaleString()}</b>
                  <span className="text-xs text-muted">
                    {t('forecast.bowls')}
                    {rate !== null && ` ・ ${t('forecast.vsTarget', { n: rate })}`}
                  </span>
                </TapNum>
              </div>
              {isOpen && (
                <table className="mb-2 w-full text-sm">
                  <tbody>
                    {r.slots.map((s) => {
                      const sr = pct(s.value, s.target)
                      return (
                        <tr key={`${s.store}${s.shift}`} className="border-t border-line">
                          <td className="px-3 py-1">
                            {short(s.store)} {t(`common:shift.${s.shift}`)}
                            {s.detail.weather.temp && <span className="ml-1 text-xs text-slate-500">{Math.round(s.detail.weather.temp.temp)}°</span>}
                            {(s.rainMm ?? 0) >= RAINY_MM && <span className="ml-1 text-xs text-sky-700">🌧{s.rainMm}mm</span>}
                            {s.events.length > 0 && <span className="block text-[11px] text-violet-700">{s.events.join('・')}</span>}
                          </td>
                          <td className="text-right font-bold tabular-nums">
                            <TapNum onOpen={() => setExplain({ kind: 'slot', slot: s, dayType: r.dayType })}>{s.value ?? '—'}</TapNum>
                          </td>
                          <td className="px-3 text-right text-xs tabular-nums">
                            {s.target ? `/${s.target}` : ''}
                            {sr !== null && <b className={cx('ml-1', sr < 90 ? 'text-amber-700' : sr >= 105 ? 'text-green-700' : 'text-slate-600')}>{sr < 90 && '⚠'}{sr}%</b>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-muted">
        {t('forecast.how', { m: t(`forecast.method.${result.check.chosen}`), w: t(`forecast.weatherMode.${result.check.weatherChosen}`) })}
        {result.check.error !== null && (
          <>
            {' '}
            <TapNum onOpen={() => setExplain({ kind: 'error' })} className="text-xs">
              {t('forecast.error', { n: result.check.error })}
            </TapNum>
          </>
        )}
        {!compact && (
          <>
            {' '}
            {result.check.weatherChosen === 'rainTemp' ? t('forecast.weatherHead') : t('forecast.rainHead')}
            {SHIFTS.map((sh) => (
              <TapNum key={sh} onOpen={() => setExplain({ kind: result.check.weatherChosen === 'rainTemp' ? 'weather' : 'rain', shift: sh })} className="text-xs">
                {t(`common:shift.${sh}`)}
                {result.check.weatherChosen === 'rain' && ` ${pctFactor(result.factors[sh].factor)}%`}
              </TapNum>
            ))}
          </>
        )}
      </p>
    </Card>
  )
}
