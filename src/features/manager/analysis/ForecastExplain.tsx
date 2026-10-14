import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Sheet } from '../../../components/Sheet'
import { RAIN_CLAMP, RAIN_MIN_DAYS, RAINY_MM, type BacktestRow, type RainFactors, type SlotForecast } from '../../../domain/forecast'
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

function SlotSheet({ s, dayType, stores, factors, onRain, onClose }: { s: SlotRow; dayType: string; stores: StoreRef[]; factors: RainFactors; onRain: () => void; onClose: () => void }) {
  const { t, day, shift } = useLabels()
  const store = stores.find((x) => x.id === s.store)
  const b = s.detail.baseline
  const rate = pctOf(s.value, s.target)
  const f = factors[s.shift]
  const rainy = s.rainMm !== null && s.rainMm >= RAINY_MM
  const where = `${store?.label ?? ''} ${shift(s.shift)}`
  const rainLine =
    s.rainMm === null
      ? t('forecast.x.rainUnknown')
      : !rainy
        ? t('forecast.x.rainNo', { hours: t(`forecast.hours.${s.shift}`), mm: s.rainMm })
        : f.days < RAIN_MIN_DAYS
          ? t('forecast.x.rainFew', { hours: t(`forecast.hours.${s.shift}`), mm: s.rainMm, n: f.days, min: RAIN_MIN_DAYS })
          : t('forecast.x.rainYes', { hours: t(`forecast.hours.${s.shift}`), mm: s.rainMm, shift: shift(s.shift), f: x2(s.rainFactor) })

  return (
    <Sheet title={t('forecast.x.slotTitle', { date: day(s.date), where })} onClose={onClose}>
      {s.value === null ? (
        <p className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">{t('forecast.x.noBase', { type: t(`chorei:target.${dayType}`) })}</p>
      ) : (
        <Formula
          text={t('forecast.x.slotFormula', { base: n1(b.value!), ev: x2(s.detail.eventFactor), rain: x2(s.rainFactor), value: s.value.toLocaleString() })}
        />
      )}
      <ol className="flex flex-col gap-2 text-sm">
        <li>
          {t('forecast.x.base', {
            date: day(s.date),
            type: t(`chorei:target.${dayType}`),
            from: formatShortDate(b.from),
            to: formatShortDate(addDays(s.date, -1)),
            weeks: b.weeks,
            where,
            n: b.days,
            avg: b.value === null ? '—' : n1(b.value),
          })}
          {b.weeks === 12 && b.days > 0 && <span className="block text-amber-800">{t('forecast.x.baseWide')}</span>}
        </li>
        <li>{s.events.length ? t('forecast.x.events', { list: s.events.join('・'), f: x2(s.detail.eventFactor) }) : t('forecast.x.eventsNone')}</li>
        <li>
          {rainLine}
          <button type="button" onClick={onRain} className="ml-1 min-h-8 font-bold text-brand underline">
            {t('forecast.x.rainOpen', { shift: shift(s.shift) })}
          </button>
        </li>
        <li>{s.target ? t('forecast.x.target', { target: s.target, type: t(`chorei:target.${dayType}`), rate }) : t('forecast.x.noTarget')}</li>
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

function ErrorSheet({ check, stores, onClose }: { check: { error: number | null; slots: number; rows: BacktestRow[]; from: string }; stores: StoreRef[]; onClose: () => void }) {
  const { t, day, shift } = useLabels()
  const label = (id: string) => stores.find((x) => x.id === id)?.label ?? ''
  return (
    <Sheet title={t('forecast.x.errorTitle')} onClose={onClose}>
      <Formula text={t('forecast.x.errorFormula', { n: check.slots, err: check.error ?? '—' })} />
      <p className="text-xs whitespace-pre-line text-muted">{t('forecast.x.errorNote', { from: formatShortDate(check.from) })}</p>
      <Sources keys={['sales', 'dayType', 'events', 'weather']} />
      <Table
        head={[t('forecast.x.colDate'), t('analysis.slot'), t('forecast.x.colForecast'), t('forecast.x.colActual'), t('forecast.x.colError')]}
        rows={[...check.rows].reverse().map((r) => ({
          key: `${r.date}${r.store}${r.shift}`,
          cells: [
            <SalesLink date={r.date} store={stores.find((s) => s.id === r.store)} shift={r.shift}>
              {day(r.date)}
            </SalesLink>,
            `${label(r.store)} ${shift(r.shift)}`,
            r.forecast,
            r.actual,
            <b className={cx(r.errorPct >= 20 ? 'text-red-700' : r.errorPct >= 10 ? 'text-amber-800' : 'text-slate-700')}>{r.errorPct}%</b>,
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
  rainFrom,
  check,
}: {
  open: ForecastOpen
  setOpen: (o: ForecastOpen | null) => void
  stores: StoreRef[]
  factors: RainFactors
  rainFrom: string
  check: { error: number | null; slots: number; rows: BacktestRow[]; from: string }
}) {
  const close = () => setOpen(null)
  if (open.kind === 'slot')
    return <SlotSheet s={open.slot} dayType={open.dayType} stores={stores} factors={factors} onRain={() => setOpen({ kind: 'rain', shift: open.slot.shift })} onClose={close} />
  if (open.kind === 'day')
    return <DaySheet date={open.date} dayType={open.dayType} slots={open.slots} stores={stores} onSlot={(slot) => setOpen({ kind: 'slot', slot, dayType: open.dayType })} onClose={close} />
  if (open.kind === 'rain') return <RainSheet shift={open.shift} factors={factors} from={rainFrom} stores={stores} onClose={close} />
  return <ErrorSheet check={check} stores={stores} onClose={close} />
}
