import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Sheet } from '../../../components/Sheet'
import {
  FORECAST_METHODS,
  LEVEL_CLAMP,
  LEVEL_MIN_DAYS,
  NEAR_MIN_DAYS,
  RAIN_CLAMP,
  RAIN_MIN_DAYS,
  RAIN_EDGES,
  RAINY_MM,
  TEMP_EDGES,
  WEATHER_MODES,
  WX_CLAMP,
  WX_MIN_SLOTS,
  YOY_CLAMP,
  YOY_MIN_PAIRS,
  type Backtest,
  type RainFactors,
  type WeatherFactors,
  type SlotForecast,
} from '../../../domain/forecast'
import { addDays, formatShortDate, weekdayOf } from '../../../domain/time'
import type { Shift } from '../../../domain/types'
import { cx } from '../../../lib/cx'
import { Formula, Sources, Table } from './explain'

// 管理 → 予測: every figure opens how it was calculated, from which data, and why (owner rule, 2026-10-16).

/** 販売日報 exist from this business date; earlier figures come from the Excel. */
const REPORTS_FROM = '2026-10-12'

export interface SlotRow extends SlotForecast {
  target: number | null
}

export interface StoreRef {
  id: string
  code: string
  label: string
}

export type ForecastOpen =
  | { kind: 'slot'; slot: SlotRow; dayType: string }
  | { kind: 'day'; date: string; dayType: string; slots: SlotRow[] }
  | { kind: 'rain'; shift: Shift }
  | { kind: 'weather'; shift: Shift }
  | { kind: 'error' }

const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString()
const x2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2)
const pctOf = (v: number | null, tg: number | null) => (v !== null && tg ? Math.round((v / tg) * 100) : null)

function useLabels() {
  const { t } = useTranslation('manager')
  const day = (d: string) => `${formatShortDate(d)}(${t(`weekday.${weekdayOf(d)}`)})`
  const shift = (s: Shift) => t(`common:shift.${s}`)
  return { t, day, shift }
}

function SalesLink({ date, store, shift, children }: { date: string; store: StoreRef | undefined; shift: Shift; children: ReactNode }) {
  if (date < REPORTS_FROM || !store) return <>{children}</>
  return (
    <Link to={`/sales?store=${store.code}&date=${date}&shift=${shift}`} className="font-bold text-brand underline">
      {children}
    </Link>
  )
}

function SlotSheet({
  s,
  dayType,
  stores,
  factors,
  onRain,
  onWeather,
  onClose,
}: {
  s: SlotRow
  dayType: string
  stores: StoreRef[]
  factors: RainFactors
  onRain: () => void
  onWeather: () => void
  onClose: () => void
}) {
  const { t, day, shift } = useLabels()
  const store = stores.find((x) => x.id === s.store)
  const b = s.detail.baseline
  const parts = s.detail.parts
  const used = parts.used
  const lv = parts.level
  const near = parts.near
  const yoy = parts.yoy
  const rate = pctOf(s.value, s.target)
  const f = factors[s.shift]
  const rainy = s.rainMm !== null && s.rainMm >= RAINY_MM
  const where = `${store?.label ?? ''} ${shift(s.shift)}`
  const type = t(`chorei:target.${dayType}`)
  const withLevel = used === 'blend' || used === 'level'
  const withYoy = used === 'blend' || used === 'yoy'
  const adjusted = [...near.samples, ...yoy.pairs].find((x) => x.period !== null && x.uplift !== null)
  const rainLine =
    s.rainMm === null
      ? t('forecast.x.rainUnknown')
      : !rainy
        ? t('forecast.x.rainNo', { hours: t(`forecast.hours.${s.shift}`), mm: s.rainMm })
        : f.days < RAIN_MIN_DAYS
          ? t('forecast.x.rainFew', { hours: t(`forecast.hours.${s.shift}`), mm: s.rainMm, n: f.days, min: RAIN_MIN_DAYS })
          : t('forecast.x.rainYes', { hours: t(`forecast.hours.${s.shift}`), mm: s.rainMm, shift: shift(s.shift), f: x2(s.rainFactor) })
  const baseFormula = () => {
    const lvN = b.value === null ? 0 : b.value * lv.value
    const yyN = near.value !== null && yoy.value !== null ? near.value * yoy.value : 0
    if (used === 'blend') return t('forecast.x.blendFormula', { a: n1(b.value!), l: x2(lv.value), ly: n1(near.value!), r: x2(yoy.value!), k: n1(lvN), y: n1(yyN), base: n1(parts.value!) })
    if (used === 'level') return t('forecast.x.levelFormula', { a: n1(b.value!), l: x2(lv.value), base: n1(parts.value!) })
    if (used === 'yoy') return t('forecast.x.yoyFormula', { ly: n1(near.value!), r: x2(yoy.value!), base: n1(parts.value!) })
    return ''
  }

  return (
    <Sheet title={t('forecast.x.slotTitle', { date: day(s.date), where })} onClose={onClose}>
      {s.value === null ? (
        <p className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">{t('forecast.x.noBase', { type })}</p>
      ) : (
        <Formula
          text={
            (used !== 'recent' ? `${baseFormula()}\n` : '') +
            t('forecast.x.slotFormula', { base: n1(parts.value!), ev: x2(s.detail.eventFactor), rain: x2(s.rainFactor), value: s.value.toLocaleString() })
          }
        />
      )}
      <p className="rounded-lg bg-surface p-2 text-sm">
        <b>{t('forecast.x.usedMethod', { m: t(`forecast.method.${used}`) })}</b>
        {parts.fallback && <span className="block text-amber-800">{t(`forecast.x.fallback.${used}`)}</span>}
      </p>
      <ol className="flex flex-col gap-2 text-sm">
        <li>
          {t('forecast.x.base', {
            date: day(s.date),
            type,
            from: formatShortDate(b.from),
            to: formatShortDate(addDays(s.date, -1)),
            weeks: b.weeks,
            where,
            n: b.days,
            avg: b.value === null ? '—' : n1(b.value),
          })}
          {b.weeks === 12 && b.days > 0 && <span className="block text-amber-800">{t('forecast.x.baseWide')}</span>}
        </li>
        {withLevel && (
          <li>
            {lv.raw === null
              ? t('forecast.x.levelFew', { n: lv.rows.length, min: LEVEL_MIN_DAYS })
              : t('forecast.x.level', {
                  from: formatShortDate(lv.from),
                  to: formatShortDate(addDays(s.date, -1)),
                  n: lv.rows.length,
                  sum: lv.rows.reduce((a, x) => a + x.actual, 0).toLocaleString(),
                  exp: n1(lv.rows.reduce((a, x) => a + x.expected, 0)),
                  raw: x2(lv.raw),
                  lo: LEVEL_CLAMP[0],
                  hi: LEVEL_CLAMP[1],
                  f: x2(lv.value),
                })}
          </li>
        )}
        {withYoy && (
          <li>
            {t('forecast.x.near', { center: `${near.center.slice(0, 4)}/${day(near.center)}`, type, n: near.samples.length, avg: n1(near.value!) })}
            <span className="block">
              {t('forecast.x.yoy', {
                from: formatShortDate(yoy.from),
                to: formatShortDate(addDays(s.date, -1)),
                n: yoy.pairs.length,
                sum: yoy.pairs.reduce((a, x) => a + x.actual, 0).toLocaleString(),
                sumLy: n1(yoy.pairs.reduce((a, x) => a + x.lastYear, 0)),
                raw: x2(yoy.raw!),
                lo: YOY_CLAMP[0],
                hi: YOY_CLAMP[1],
                r: x2(yoy.value!),
              })}
            </span>
            {adjusted && <span className="block text-violet-800">{t('forecast.x.periodAdj', { name: adjusted.period, u: x2(adjusted.uplift!) })}</span>}
            {near.skipped.length > 0 && <span className="block text-muted">{t('forecast.x.nearSkipped', { list: near.skipped.map((x) => `${day(x.date)} ${x.why}`).join('・') })}</span>}
          </li>
        )}
        {used === 'level' && (
          <li className="text-muted">
            {t('forecast.x.nearMissing', { center: `${near.center.slice(0, 4)}/${day(near.center)}`, n: near.samples.length, min: NEAR_MIN_DAYS, pairs: yoy.pairs.length, minPairs: YOY_MIN_PAIRS })}
          </li>
        )}
        <li>{s.events.length ? t('forecast.x.events', { list: s.events.join('・'), f: x2(s.detail.eventFactor) }) : t('forecast.x.eventsNone')}</li>
        {s.detail.weather.mode === 'rainTemp' ? (
          <li>
            {s.detail.weather.temp
              ? t('forecast.x.tempLine', {
                  hours: t(`forecast.hours.${s.shift}`),
                  temp: n1(s.detail.weather.temp.temp),
                  mean: n1(s.detail.weather.temp.mean),
                  days: s.detail.weather.temp.days,
                  diff: `${s.detail.weather.temp.anomaly >= 0 ? '+' : ''}${n1(s.detail.weather.temp.anomaly)}`,
                  band: t(`forecast.tempBand.${s.detail.weather.temp.band}`),
                  f: x2(s.detail.weather.tempFactor),
                })
              : t('forecast.x.tempUnknown')}
            <span className="block">
              {s.detail.weather.mm === null
                ? t('forecast.x.rainUnknown')
                : s.detail.weather.rainBand === 0
                  ? t('forecast.x.rainNoShort', { mm: n1(s.detail.weather.mm) })
                  : t('forecast.x.rainBandLine', {
                      hours: t(`forecast.hours.${s.shift}`),
                      mm: n1(s.detail.weather.mm),
                      h: s.detail.weather.hours ?? '—',
                      band: t(`forecast.rainBand.${s.detail.weather.rainBand}`),
                      f: x2(s.detail.weather.rainFactor),
                    })}
            </span>
            <span className="block">{t('forecast.x.weatherTotal', { t: x2(s.detail.weather.tempFactor), r: x2(s.detail.weather.rainFactor), f: x2(s.detail.weather.factor) })}</span>
            <button type="button" onClick={onWeather} className="min-h-8 font-bold text-brand underline">
              {t('forecast.x.weatherOpen', { shift: shift(s.shift) })}
            </button>
          </li>
        ) : (
          <li>
            {rainLine}
            <button type="button" onClick={onRain} className="ml-1 min-h-8 font-bold text-brand underline">
              {t('forecast.x.rainOpen', { shift: shift(s.shift) })}
            </button>
          </li>
        )}
        <li>{s.target ? t('forecast.x.target', { target: s.target, type, rate }) : t('forecast.x.noTarget')}</li>
      </ol>
      <Sources keys={['sales', 'dayType', 'events', 'weather', 'target']} />
      <h3 className="text-sm font-bold">{t('forecast.x.baseTable', { n: b.days })}</h3>
      <Table
        head={[t('forecast.x.colDate'), t('forecast.x.colBowls')]}
        rows={b.samples.map((x) => ({
          key: x.date,
          cells: [
            <SalesLink date={x.date} store={store} shift={s.shift}>
              {day(x.date)}
            </SalesLink>,
            x.bowls.toLocaleString(),
          ],
        }))}
        foot={b.value === null ? undefined : [t('forecast.x.avg'), n1(b.value)]}
      />
      {withLevel && lv.rows.length > 0 && (
        <>
          <h3 className="text-sm font-bold">{t('forecast.x.levelTable', { n: lv.rows.length })}</h3>
          <Table
            head={[t('forecast.x.colDate'), t('forecast.x.colActual'), t('forecast.x.colExpected')]}
            rows={lv.rows.map((x) => ({
              key: x.date,
              cells: [
                <SalesLink date={x.date} store={store} shift={s.shift}>
                  {day(x.date)}
                </SalesLink>,
                x.actual.toLocaleString(),
                <span>
                  {n1(x.expected)}
                  <span className="block text-[11px] text-slate-500">
                    {n1(x.avg)} × {x2(x.known)}
                  </span>
                </span>,
              ],
            }))}
            foot={[t('analysis.total'), lv.rows.reduce((a, x) => a + x.actual, 0).toLocaleString(), n1(lv.rows.reduce((a, x) => a + x.expected, 0))]}
          />
        </>
      )}
      {withYoy && (
        <>
          <h3 className="text-sm font-bold">{t('forecast.x.nearTable', { n: near.samples.length })}</h3>
          <Table
            head={[t('forecast.x.colDate'), t('forecast.x.colBowls'), t('forecast.x.colAdjusted')]}
            rows={near.samples.map((x) => ({ key: x.date, cells: [day(x.date), x.bowls.toLocaleString(), x.period ? `${n1(x.value)}（÷${x2(x.uplift!)}）` : n1(x.value)] }))}
            foot={[t('forecast.x.avg'), '', n1(near.value!)]}
          />
          <h3 className="text-sm font-bold">{t('forecast.x.yoyTable', { n: yoy.pairs.length })}</h3>
          <Table
            head={[t('forecast.x.colDate'), t('forecast.x.colActual'), t('forecast.x.colLastYear')]}
            rows={yoy.pairs.map((x) => ({
              key: x.date,
              cells: [
                <SalesLink date={x.date} store={store} shift={s.shift}>
                  {day(x.date)}
                </SalesLink>,
                x.actual.toLocaleString(),
                <span>
                  {x.period ? `${n1(x.lastYear)}（${x.lastYearRaw}÷${x2(x.uplift!)}）` : x.lastYear.toLocaleString()}
                  <span className="block text-[11px] text-slate-500">{formatShortDate(addDays(x.date, -364))}</span>
                </span>,
              ],
            }))}
            foot={[t('analysis.total'), yoy.pairs.reduce((a, x) => a + x.actual, 0).toLocaleString(), n1(yoy.pairs.reduce((a, x) => a + x.lastYear, 0))]}
          />
        </>
      )}
      <p className="text-xs text-muted">{t('forecast.x.linkNote', { date: formatShortDate(REPORTS_FROM) })}</p>
    </Sheet>
  )
}

function DaySheet({ date, dayType, slots, stores, onSlot, onClose }: { date: string; dayType: string; slots: SlotRow[]; stores: StoreRef[]; onSlot: (s: SlotRow) => void; onClose: () => void }) {
  const { t, day, shift } = useLabels()
  const total = slots.reduce((a, s) => a + (s.value ?? 0), 0)
  const target = slots.every((s) => s.target !== null) ? slots.reduce((a, s) => a + s.target!, 0) : null
  const label = (s: SlotRow) => `${stores.find((x) => x.id === s.store)?.label ?? ''} ${shift(s.shift)}`
  return (
    <Sheet title={t('forecast.x.dayTitle', { date: day(date), type: t(`chorei:target.${dayType}`) })} onClose={onClose}>
      <Formula text={t('forecast.x.dayFormula', { parts: slots.map((s) => s.value ?? 0).join(' + '), total: total.toLocaleString() })} />
      <p className="text-xs text-muted">{t('forecast.x.dayNote')}</p>
      <Table
        head={[t('analysis.slot'), t('forecast.x.colForecast'), t('analysis.target'), t('analysis.rate')]}
        rows={slots.map((s) => {
          const r = pctOf(s.value, s.target)
          return {
            key: `${s.store}${s.shift}`,
            cells: [
              <button type="button" onClick={() => onSlot(s)} className="min-h-9 text-left font-bold text-brand underline">
                {label(s)}
              </button>,
              s.value ?? '—',
              s.target ?? '—',
              r === null ? '—' : `${r}%`,
            ],
          }
        })}
        foot={[t('analysis.total'), total.toLocaleString(), target ?? '—', pctOf(total, target) === null ? '—' : `${pctOf(total, target)}%`]}
      />
      {target === null && <p className="text-xs text-muted">{t('forecast.x.dayNoTarget')}</p>}
      <Sources keys={['sales', 'dayType', 'events', 'weather', 'target']} />
    </Sheet>
  )
}

function RainSheet({ shift: sh, factors, from, stores, onClose }: { shift: Shift; factors: RainFactors; from: string; stores: StoreRef[]; onClose: () => void }) {
  const { t, day, shift } = useLabels()
  const f = factors[sh]
  const label = (id: string) => stores.find((x) => x.id === id)?.label ?? ''
  const result =
    f.days < RAIN_MIN_DAYS ? t('forecast.x.rainResultFew', { n: f.days, min: RAIN_MIN_DAYS }) : t('forecast.x.rainResult', { m: f.median === null ? '—' : x2(f.median), f: x2(f.factor) })
  return (
    <Sheet title={t('forecast.x.rainTitle', { shift: shift(sh) })} onClose={onClose}>
      <Formula text={`${t('forecast.x.rainFormula')}\n${result}`} />
      <p className="text-xs whitespace-pre-line text-muted">
        {t('forecast.x.rainNote', { from: formatShortDate(from), hours: t(`forecast.hours.${sh}`), min: RAIN_MIN_DAYS, lo: RAIN_CLAMP[0], hi: RAIN_CLAMP[1], days: f.days, n: f.samples.length })}
      </p>
      <Sources keys={['sales', 'dayType', 'events', 'weather']} />
      <Table
        head={[t('forecast.x.colDate'), t('analysis.slot'), 'mm', t('forecast.x.colActual'), t('forecast.x.colExpected'), t('forecast.x.colRatio')]}
        rows={[...f.samples].reverse().map((x) => ({
          key: `${x.date}${x.store}`,
          cells: [
            <SalesLink date={x.date} store={stores.find((s) => s.id === x.store)} shift={sh}>
              {day(x.date)}
            </SalesLink>,
            label(x.store),
            x.mm,
            x.actual,
            n1(x.expected),
            <b className={cx(x.ratio < 1 ? 'text-amber-800' : 'text-green-700')}>{x2(x.ratio)}</b>,
          ],
        }))}
      />
    </Sheet>
  )
}

const pctLabel = (f: number) => `×${x2(f)}`

/** 天気の影響 (rain × temperature model) of one shift: every band with its slots, median and factor. */
function WeatherSheet({ shift: sh, wf, onClose }: { shift: Shift; wf: WeatherFactors; onClose: () => void }) {
  const { t, shift } = useLabels()
  const f = wf[sh]
  return (
    <Sheet title={t('forecast.x.weatherTitle', { shift: shift(sh) })} onClose={onClose}>
      <Formula text={t('forecast.x.weatherFormula')} />
      <p className="text-xs whitespace-pre-line text-muted">
        {t('forecast.x.weatherNote', {
          from: formatShortDate(wf.from),
          to: formatShortDate(wf.to),
          hours: t(`forecast.hours.${sh}`),
          min: WX_MIN_SLOTS,
          lo: WX_CLAMP[0],
          hi: WX_CLAMP[1],
          edges: TEMP_EDGES.join(' / '),
          rain: RAIN_EDGES.join(' / '),
        })}
      </p>
      <Sources keys={['sales', 'dayType', 'events', 'weather']} />
      <h3 className="text-sm font-bold">🌡 {t('forecast.x.tempTable')}</h3>
      <Table
        head={[t('forecast.x.colBand'), t('forecast.x.colSlots'), t('forecast.x.colMedian'), t('forecast.x.colFactor')]}
        rows={f.temp.map((b) => ({
          key: `t${b.band}`,
          cells: [t(`forecast.tempBand.${b.band}`), b.slots, b.median === null ? '—' : x2(b.median), <b>{pctLabel(b.factor)}</b>],
        }))}
      />
      <h3 className="text-sm font-bold">🌧 {t('forecast.x.rainTable')}</h3>
      <Table
        head={[t('forecast.x.colBand'), t('forecast.x.colSlots'), t('forecast.x.colMedian'), t('forecast.x.colFactor')]}
        rows={f.rain.map((b) => ({
          key: `r${b.band}`,
          cells: [t(`forecast.rainBand.${b.band}`), b.slots, b.median === null ? '—' : x2(b.median), <b>{pctLabel(b.factor)}</b>],
        }))}
      />
    </Sheet>
  )
}

const signed = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v}%`)

function ErrorSheet({ check, stores, onClose }: { check: Backtest; stores: StoreRef[]; onClose: () => void }) {
  const { t, day, shift } = useLabels()
  const label = (id: string) => stores.find((x) => x.id === id)?.label ?? ''
  return (
    <Sheet title={t('forecast.x.errorTitle')} onClose={onClose}>
      <Formula text={t('forecast.x.errorFormula', { n: check.slots, err: check.error ?? '—', bias: signed(check.bias) })} />
      <p className="text-xs whitespace-pre-line text-muted">{t('forecast.x.errorNote', { from: formatShortDate(check.from) })}</p>
      <h3 className="text-sm font-bold">{t('forecast.x.methodsTitle', { n: check.methods.blend.slots })}</h3>
      <Table
        head={[t('forecast.x.colMethod'), t('forecast.x.colError'), t('forecast.x.colBias')]}
        rows={FORECAST_METHODS.map((m) => ({
          key: m,
          cells: [
            <span className={cx(m === check.chosen && 'font-bold')}>
              {t(`forecast.method.${m}`)}
              {m === check.chosen && ` ✅ ${t('forecast.x.chosen')}`}
            </span>,
            check.methods[m].error === null ? '—' : `±${check.methods[m].error}%`,
            signed(check.methods[m].bias),
          ],
        }))}
      />
      <p className="text-xs whitespace-pre-line text-muted">{t('forecast.x.methodsNote')}</p>
      <h3 className="text-sm font-bold">{t('forecast.x.weatherModesTitle', { m: t(`forecast.method.${check.chosen}`) })}</h3>
      <Table
        head={[t('forecast.x.colMethod'), t('forecast.x.colError')]}
        rows={WEATHER_MODES.map((m) => ({
          key: m,
          cells: [
            <span className={cx(m === check.weatherChosen && 'font-bold')}>
              {t(`forecast.weatherMode.${m}`)}
              {m === check.weatherChosen && ` ✅ ${t('forecast.x.chosen')}`}
            </span>,
            check.weather[m].error === null ? '—' : `±${check.weather[m].error}%`,
          ],
        }))}
      />
      <p className="text-xs whitespace-pre-line text-muted">{t('forecast.x.weatherModesNote')}</p>
      <Sources keys={['sales', 'dayType', 'events', 'weather']} />
      <h3 className="text-sm font-bold">{t('forecast.x.rowsTitle', { m: t(`forecast.method.${check.chosen}`) })}</h3>
      <Table
        head={[t('forecast.x.colDate'), t('analysis.slot'), t('forecast.x.colActual'), ...FORECAST_METHODS.map((m) => t(`forecast.methodShort.${m}`))]}
        rows={[...check.rows].reverse().map((r) => ({
          key: `${r.date}${r.store}${r.shift}`,
          cells: [
            <SalesLink date={r.date} store={stores.find((s) => s.id === r.store)} shift={r.shift}>
              {day(r.date)}
            </SalesLink>,
            `${label(r.store)} ${shift(r.shift)}`,
            r.actual,
            ...FORECAST_METHODS.map((m) => {
              const f = m === check.chosen ? r.forecast : r.by[m]
              if (f === null) return '—'
              const e = Math.round(((f - r.actual) / r.actual) * 100)
              return (
                <span className={cx(m === check.chosen && 'font-bold')}>
                  {f}
                  <span className={cx('block text-[11px]', Math.abs(e) >= 20 ? 'text-red-700' : Math.abs(e) >= 10 ? 'text-amber-800' : 'text-slate-500')}>
                    {e > 0 ? '+' : ''}
                    {e}%
                  </span>
                </span>
              )
            }),
          ],
        }))}
      />
    </Sheet>
  )
}

/** The sheet for whatever was tapped on the forecast card. */
export function ForecastExplain({
  open,
  setOpen,
  stores,
  factors,
  weatherFactors: wf,
  rainFrom,
  check,
}: {
  open: ForecastOpen
  setOpen: (o: ForecastOpen | null) => void
  stores: StoreRef[]
  factors: RainFactors
  weatherFactors: WeatherFactors
  rainFrom: string
  check: Backtest
}) {
  const close = () => setOpen(null)
  if (open.kind === 'slot')
    return (
      <SlotSheet
        s={open.slot}
        dayType={open.dayType}
        stores={stores}
        factors={factors}
        onRain={() => setOpen({ kind: 'rain', shift: open.slot.shift })}
        onWeather={() => setOpen({ kind: 'weather', shift: open.slot.shift })}
        onClose={close}
      />
    )
  if (open.kind === 'day')
    return <DaySheet date={open.date} dayType={open.dayType} slots={open.slots} stores={stores} onSlot={(slot) => setOpen({ kind: 'slot', slot, dayType: open.dayType })} onClose={close} />
  if (open.kind === 'weather') return <WeatherSheet shift={open.shift} wf={wf} onClose={close} />
  if (open.kind === 'rain') return <RainSheet shift={open.shift} factors={factors} from={rainFrom} stores={stores} onClose={close} />
  return <ErrorSheet check={check} stores={stores} onClose={close} />
}
