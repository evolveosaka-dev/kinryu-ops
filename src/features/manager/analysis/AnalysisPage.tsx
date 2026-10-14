import { useMutation } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../../../components/Sheet'
import { Button, Card, ErrorBox, PageTitle, Segmented, Spinner } from '../../../components/ui'
import {
  DATA_FROM,
  dayView,
  eventEffects,
  indexSales,
  monthDays,
  monthlyTrend,
  monthSummary,
  patrolBands,
  rateOf,
  typeTable,
  typeYears,
  weekly,
  weeklyTrend,
  type Ctx,
  type DayView,
} from '../../../domain/salesAnalysis'
import { addDays, formatShortDate, weekdayOf } from '../../../domain/time'
import { SHIFTS, type Shift } from '../../../domain/types'
import { cx } from '../../../lib/cx'
import { errorMessage, storeName } from '../../../lib/format'
import { useHolidays, useStores, useTargetEvents, useTargets } from '../../../lib/queries'
import { PeriodBar, Stat } from '../common'
import { exportXlsx, today, usePeriod } from '../data'
import { ManagerTabs } from '../ManagerTabs'
import { DailyChart, LineChart } from './charts'
import { useAnalysisPatrols, useDailySales, useMonthReports, type ReportFigures } from './data'
import { ChartDetail, TapChart, type ChartInfo, type ChartKind } from './ChartDetail'
import { SummaryDetail, type SummaryKind } from './SummaryDetail'

/** 朝礼・巡回 started on this day (改善の効果 compares before / after). */
const START = '2026-10-12'

const eventIcon = (name: string) => (name.includes('阪神') ? '⚾' : name.includes('ハロウィン') ? '🎃' : name.includes('クリスマス') ? '🎄' : name.includes('戎') ? '⛩️' : '🎉')
/** bowls with the unit: 1,250杯 */
const bw = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toLocaleString()}杯`)
const pct = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v}%`)
const rateCls = (r: number | null) => (r === null ? 'text-slate-500' : r >= 100 ? 'text-green-700' : r >= 90 ? 'text-amber-700' : 'text-red-700')
const rateBg = (r: number | null) => (r === null ? 'bg-slate-50' : r >= 100 ? 'bg-green-100' : r >= 90 ? 'bg-amber-100' : 'bg-red-100')

function Section({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="text-[17px] font-bold">{title}</h2>
      {help && <p className="text-xs text-muted">{help}</p>}
      {children}
    </Card>
  )
}

function DaySheet({ day, reports, storeLabel, onClose }: { day: DayView; reports: ReportFigures[]; storeLabel: (id: string) => string; onClose: () => void }) {
  const { t } = useTranslation('manager')
  return (
    <Sheet title={`${formatShortDate(day.date)}(${t(`weekday.${weekdayOf(day.date)}`)}) ${t(`chorei:target.${day.dayType}`)}`} onClose={onClose}>
      {day.events.length > 0 && <p className="rounded-lg bg-sky-50 p-2 text-sm font-bold">{day.events.map((e) => `${eventIcon(e)} ${e}`).join('　')}</p>}
      <table className="w-full text-sm">
        <thead className="text-xs text-slate-600">
          <tr>
            <th className="text-left">{t('analysis.slot')}</th>
            <th className="text-right">{t('analysis.actual')}</th>
            <th className="text-right">{t('analysis.target')}</th>
            <th className="text-right">{t('analysis.rate')}</th>
            <th className="text-right">{t('analysis.lastYear')}</th>
          </tr>
        </thead>
        <tbody>
          {day.slots.map((s) => {
            const r = rateOf(s.actual, s.target)
            return (
              <tr key={`${s.store}${s.shift}`} className="border-t border-line">
                <td className="py-1.5">
                  {storeLabel(s.store)} {t(`common:shift.${s.shift}`)}
                  {s.events.length > 0 && <span className="block text-[11px] text-slate-600">{s.events.map((e) => `${e.name} ${pct(e.pct)}`).join('・')}</span>}
                </td>
                <td className="text-right font-bold tabular-nums">{bw(s.actual)}</td>
                <td className="text-right tabular-nums">{bw(s.target)}</td>
                <td className={cx('text-right font-bold tabular-nums', rateCls(r))}>{r === null ? '—' : `${r}%`}</td>
                <td className="text-right text-slate-600 tabular-nums">{bw(s.lastYear)}</td>
              </tr>
            )
          })}
          <tr className="border-t-2 border-line font-bold">
            <td className="py-1.5">{t('analysis.total')}</td>
            <td className="text-right tabular-nums">{bw(day.actual)}</td>
            <td className="text-right tabular-nums">{bw(day.target ?? day.targetAll)}</td>
            <td className={cx('text-right tabular-nums', rateCls(rateOf(day.actual, day.target)))}>{rateOf(day.actual, day.target) ?? '—'}%</td>
            <td className="text-right text-slate-600 tabular-nums">{bw(day.lastYear)}</td>
          </tr>
        </tbody>
      </table>
      {reports.length > 0 && (
        <div className="flex flex-col gap-1 text-sm">
          <h3 className="font-bold">🧾 {t('analysis.reports')}</h3>
          {reports.map((r) => (
            <p key={`${r.store_id}${r.shift}`} className={cx(r.noodle_diff || r.cash_diff ? 'font-bold text-red-700' : '')}>
              {storeLabel(r.store_id)} {t(`common:shift.${r.shift}`)}: {t('analysis.noodleDiff')} {r.noodle_diff ?? '—'}・{t('analysis.cashDiff')} {r.cash_diff ?? '—'}円・{t('analysis.coupons')} {r.tickets?.coupon ?? 0}
              {r.status !== 'submitted' && `（${t('analysis.draft')}）`}
            </p>
          ))}
        </div>
      )}
    </Sheet>
  )
}

/** 管理 → 分析: sales (daily_sales) against the targets, last year, the patrols and the events. */
export function AnalysisPage() {
  const { t } = useTranslation('manager')
  const period = usePeriod('month')
  const month = period.range.from
  const stores = useStores()
  const holidays = useHolidays()
  const targets = useTargets()
  const events = useTargetEvents()
  const sales = useDailySales()
  const patrols = useAnalysisPatrols()
  const reports = useMonthReports(period.range.from, period.range.to)
  const [store, setStore] = useState('all')
  const [shift, setShift] = useState<'all' | Shift>('all')
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [openStat, setOpenStat] = useState<SummaryKind | null>(null)
  const [openChart, setOpenChart] = useState<ChartKind | null>(null)

  const storeLabel = (id: string) => storeName(stores.data?.find((s) => s.id === id), 'ja').replace('店', '')
  const ready = stores.data && holidays.data && targets.data && events.data && sales.data
  const ctx: Ctx | null = ready
    ? {
        sales: indexSales(sales.data!),
        targets: targets.data!,
        events: events.data!,
        holidays: holidays.data!,
        storeIds: store === 'all' ? stores.data!.map((s) => s.id) : [store],
        shifts: shift === 'all' ? [...SHIFTS] : [shift],
      }
    : null

  const download = useMutation({
    mutationFn: async () => {
      if (!ctx) return
      const days = monthDays(month).map((d) => dayView(ctx, d))
      const trend = monthlyTrend(ctx, DATA_FROM, `${today().slice(0, 7)}-01`)
      const weeks = weekly(ctx, '2026-08-03', today(), patrols.data ?? [])
      await exportXlsx(`分析_${month.slice(0, 7)}.xlsx`, [
        { name: '日別', rows: [['日付', '日の種類', '実績（杯）', '目標', '達成率%', '前年同曜日', 'イベント'], ...days.map((d) => [d.date, t(`chorei:target.${d.dayType}`, { lng: 'ja' }), d.actual, d.target ?? d.targetAll, rateOf(d.actual, d.target), d.lastYear, d.events.join('・')])] },
        { name: 'シフト×日の種類', rows: [['日の種類', '日数', ...SHIFTS.flatMap((s) => [`${s} 実績`, `${s} 目標`, `${s} 達成率%`])], ...typeTable(ctx, month).map((r) => [t(`chorei:target.${r.dayType}`, { lng: 'ja' }), r.days, ...SHIFTS.flatMap((s) => [r.cells[s].actual, r.cells[s].target, r.cells[s].rate])])] },
        { name: '月別推移', rows: [['月', '1日平均（杯）', '日数'], ...trend.map((m) => [m.month.slice(0, 7), m.avg, m.days])] },
        { name: '週別推移', rows: [['年', '週', '週（月曜）', '1日平均（杯）', '日数'], ...weeklyTrend(ctx, DATA_FROM, today()).map((w) => [w.year, w.week, w.monday, w.avg, w.days])] },
        (() => {
          const ty = typeYears(ctx, month)
          return { name: '日の種類×年', rows: [[`${Number(month.slice(5, 7))}月 日の種類`, ...ty.years.flatMap((y) => [`${y} 1日平均`, `${y} 日数`])], ...ty.rows.map((r) => [t(`chorei:target.${r.dayType}`, { lng: 'ja' }), ...ty.years.flatMap((y) => [r.cells[y]!.avg, r.cells[y]!.days])])] }
        })(),
        { name: '週別（改善の効果）', rows: [['週（月曜）', '1日平均', '前年同週 1日平均', '前年比%', '巡回平均点（25点）', '巡回数'], ...weeks.map((w) => [w.monday, w.avg, w.lyAvg, w.yoy, w.patrol, w.patrols])] },
        { name: 'イベント効果', rows: [['イベント', '店舗', '開始', '終了', 'ON', ...SHIFTS.flatMap((s) => [`${s} 設定%`, `${s} 実際%`])], ...eventEffects(ctx, events.data ?? []).map((e) => [e.name, e.storeId ? storeLabel(e.storeId) : '両店舗', e.from, e.to, e.active ? 'ON' : 'OFF', ...e.shifts.flatMap((s) => [s.set, s.measured])])] },
        { name: '注記', rows: [['杯数 = ラーメン + チャーシューメン（クーポンは含みません）。前年 = 364日前（同じ曜日）。']] },
      ])
    },
  })

  if (!ready || !ctx) {
    const err = sales.error ?? targets.error ?? events.error
    return (
      <div className="flex flex-col gap-3">
        <ManagerTabs />
        {err ? <ErrorBox message={errorMessage(err)} /> : <Spinner />}
      </div>
    )
  }

  const now = today()
  const days = monthDays(month).map((d) => dayView(ctx, d))
  const summary = monthSummary(ctx, month, now)
  const types = typeTable(ctx, month)
  const trend = monthlyTrend(ctx, DATA_FROM, `${now.slice(0, 7)}-01`)
  const years = [...new Set(trend.map((m) => m.month.slice(0, 4)))]
  // newest year blue, the year before orange, older years grey
  const yearColor = (i: number, n = years.length) => ['#1d4ed8', '#f59e0b', '#94a3b8', '#cbd5e1'][n - 1 - i] ?? '#cbd5e1'
  const wtrend = weeklyTrend(ctx, DATA_FROM, now)
  const wYears = [...new Set(wtrend.map((w) => w.year))].filter((y) => y >= DATA_FROM.slice(0, 4))
  const ty = typeYears(ctx, month)
  const [tyLast, tyPrev] = [ty.years.at(-1), ty.years.at(-2)]
  const weekFrom = '2026-08-03'
  const weeks = weekly(ctx, weekFrom, now, patrols.data ?? [])
  const startIdx = weeks.findIndex((w) => w.monday <= START && START < addDays(w.monday, 7))
  const bands = patrolBands(ctx, patrols.data ?? [])
  const effects = eventEffects(ctx, (events.data ?? []).filter((e) => e.event_date <= now))
  const first = monthDays(month)[0]!
  const lead = (weekdayOf(first) + 6) % 7
  const dayOpen = openDay ? days.find((d) => d.date === openDay) ?? null : null
  const small = (s: ReactNode) => <span className="block text-[11px] text-slate-500">{s}</span>
  const wk = (mon: string) => `${Number(mon.slice(5, 7))}/${Number(mon.slice(8))}〜`
  const chartInfo = (kind: ChartKind): ChartInfo => {
    if (kind === 'daily')
      return {
        kind,
        title: t('analysis.daily'),
        head: [t('analysis.how.day'), t('analysis.actual'), t('analysis.target'), t('analysis.rate'), t('analysis.lastYear')],
        rows: days
          .filter((d) => d.actual !== null)
          .map((d) => ({ key: d.date, cells: [`${formatShortDate(d.date)}(${t(`weekday.${weekdayOf(d.date)}`)})`, bw(d.actual), bw(d.target), `${rateOf(d.actual, d.target) ?? '—'}%`, bw(d.lastYear)] })),
      }
    if (kind === 'monthly')
      return {
        kind,
        title: t('analysis.trend'),
        head: [t('analysis.monthCol'), ...years.map((y) => t('analysis.yearCol', { year: y }))],
        rows: Array.from({ length: 12 }, (_, m) => ({
          key: String(m),
          cells: [
            `${m + 1}月`,
            ...years.map((y) => {
              const r = trend.find((x) => x.month === `${y}-${String(m + 1).padStart(2, '0')}-01`)
              return r && r.days >= 5 ? <>{bw(r.avg)}{small(t('analysis.days', { n: r.days }))}</> : '—'
            }),
          ],
        })),
      }
    if (kind === 'weekly')
      return {
        kind,
        title: t('analysis.weekTrend'),
        head: [t('analysis.weekCol'), ...wYears.map((y) => t('analysis.yearCol', { year: y }))],
        rows: Array.from({ length: 53 }, (_, k) => k + 1)
          .map((n) => ({ n, cells: wYears.map((y) => wtrend.find((x) => x.year === y && x.week === n)) }))
          .filter((r) => r.cells.some((c) => c && c.days >= 4))
          .map((r) => ({
            key: String(r.n),
            cells: [`${r.n}週`, ...r.cells.map((c) => (c && c.days >= 4 ? <>{bw(c.avg)}{small(`${wk(c.monday)}・${t('analysis.days', { n: c.days })}`)}</> : '—'))],
          })),
      }
    if (kind === 'yoyWeekly')
      return {
        kind,
        title: t('analysis.weeklyYoy'),
        head: [t('analysis.weekCol'), t('analysis.how.thisYear'), t('analysis.lastYear'), t('analysis.yoyCol')],
        rows: weeks.map((w) => ({ key: w.monday, muted: w.yoy === null, cells: [wk(w.monday), bw(w.avg), bw(w.lyAvg), pct(w.yoy)] })),
      }
    return {
      kind,
      title: t('analysis.patrolAvg'),
      head: [t('analysis.weekCol'), t('analysis.patrolAvg'), t('analysis.patrolCount')],
      rows: weeks.map((w) => ({ key: w.monday, muted: w.patrol === null, cells: [wk(w.monday), w.patrol === null ? '—' : `${w.patrol}/25`, w.patrols] })),
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ManagerTabs />
      <PageTitle title={t('analysis.title')} subtitle={t('analysis.note')} />
      <PeriodBar period={period} allowModes={false} />
      <Segmented label="" value={store} onChange={setStore} options={[{ value: 'all', label: t('analysis.bothStores') }, ...(stores.data ?? []).map((s) => ({ value: s.id, label: storeName(s, 'ja') }))]} />
      <Segmented label="" value={shift} onChange={setShift} options={[{ value: 'all' as const, label: t('analysis.allShifts') }, ...SHIFTS.map((s) => ({ value: s, label: t(`common:shift.${s}`) }))]} />

      {/* ① summary: each figure opens how it is calculated */}
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ['achievement', <Stat label={t('analysis.achievement')} value={summary.rate === null ? '—' : `${summary.rate}%`} sub={summary.target ? `${bw(summary.actual)} / ${bw(summary.target)}` : t('analysis.noTarget')} tone={summary.rate === null ? undefined : summary.rate >= 100 ? 'good' : summary.rate >= 90 ? 'warn' : 'bad'} />],
            ['yoy', <Stat label={t('analysis.yoy')} value={pct(summary.yoy)} sub={t('analysis.yoySub')} tone={summary.yoy === null ? undefined : summary.yoy >= 0 ? 'good' : 'warn'} />],
            ['forecast', <Stat label={t('analysis.forecast')} value={bw(summary.forecast)} sub={t('analysis.forecastSub')} />],
            [
              'best',
              <Stat
                label={t('analysis.bestWorst')}
                value={summary.best ? <span className="text-lg whitespace-nowrap">{formatShortDate(summary.best.date)} {bw(summary.best.actual)}</span> : '—'}
                sub={summary.worst ? `${t('analysis.lowest')} ${formatShortDate(summary.worst.date)} ${bw(summary.worst.actual)}` : undefined}
              />,
            ],
          ] as [SummaryKind, ReactNode][]
        ).map(([k, stat]) => (
          <button key={k} type="button" onClick={() => setOpenStat(k)} className="relative text-left" aria-label={t('analysis.how.open')}>
            {stat}
            <span className="absolute top-2 right-3 text-xs font-bold text-brand">ⓘ</span>
          </button>
        ))}
      </div>
      <p className="-mt-1 text-xs text-muted">{t('analysis.how.tap')}</p>

      {/* ② calendar */}
      <Section title={`② ${t('analysis.calendar')}`} help={t('analysis.calendarHelp')}>
        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {[1, 2, 3, 4, 5, 6, 0].map((w) => (
            <span key={w} className={cx('font-bold', w === 0 && 'text-red-700', w === 6 && 'text-blue-700')}>
              {t(`weekday.${w}`)}
            </span>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <span key={`b${i}`} />
          ))}
          {days.map((d) => {
            const r = rateOf(d.actual, d.target)
            return (
              <button key={d.date} type="button" onClick={() => setOpenDay(d.date)} className={cx('flex min-h-14 flex-col items-center justify-center rounded-lg leading-tight', rateBg(r), d.date === now && 'ring-2 ring-brand')}>
                <span className={cx('text-[11px]', ctx.holidays.has(d.date) && 'text-red-700')}>
                  {Number(d.date.slice(8))}
                  {d.events.length > 0 && eventIcon(d.events[0]!)}
                </span>
                <b className={cx('text-sm', rateCls(r))}>{r === null ? (d.date >= now ? '' : '—') : `${Math.round(r)}%`}</b>
                <span className="text-[10px] text-slate-600">{(d.actual ?? d.targetAll) === null ? '' : bw(d.actual ?? d.targetAll)}</span>
              </button>
            )
          })}
        </div>
      </Section>

      {/* ③ daily chart */}
      <Section title={`③ ${t('analysis.daily')}`} help={t('analysis.dailyHelp')}>
        <TapChart label={t('analysis.how.open')} onOpen={() => setOpenChart('daily')}>
          <DailyChart days={days} />
        </TapChart>
      </Section>

      {/* ④ shift × day type */}
      <Section title={`④ ${t('analysis.types')}`} help={t('analysis.typesHelp')}>
        <div className="-mx-2 overflow-x-auto px-2">
          <table className="w-full min-w-[20rem] text-center text-xs">
            <thead className="text-slate-600">
              <tr>
                <th className="text-left">{t('analysis.dayType')}</th>
                {SHIFTS.map((s) => (
                  <th key={s}>{t(`common:shift.${s}`)}</th>
                ))}
                <th>{t('analysis.total')}</th>
              </tr>
            </thead>
            <tbody>
              {types.map((r) => (
                <tr key={r.dayType} className="border-t border-line">
                  <th className="py-1 text-left font-normal">
                    {t(`chorei:target.${r.dayType}`)}
                    <span className="block text-[10px] text-muted">{t('analysis.days', { n: r.days })}</span>
                  </th>
                  {[...SHIFTS.map((s) => r.cells[s]), r.total].map((c, i) => (
                    <td key={i} className={cx('p-0.5', rateBg(c.rate))}>
                      <b className={rateCls(c.rate)}>{c.rate === null ? '—' : `${Math.round(c.rate)}%`}</b>
                      <span className="block text-[10px] text-slate-600 tabular-nums">{c.actual === null ? '' : `${c.actual}/${c.target}杯`}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ⑤ monthly trend */}
      <Section title={`⑤ ${t('analysis.trend')}`} help={t('analysis.trendHelp')}>
        <TapChart label={t('analysis.how.open')} onOpen={() => setOpenChart('monthly')}>
          <LineChart
            unit="杯"
            labels={Array.from({ length: 12 }, (_, i) => `${i + 1}月`)}
            series={years.map((y, i) => ({
              label: y,
              color: yearColor(i),
              // a month with fewer than 5 complete days is left out (too few to compare)
              values: Array.from({ length: 12 }, (_, m) => {
                const r = trend.find((x) => x.month === `${y}-${String(m + 1).padStart(2, '0')}-01`)
                return r && r.days >= 5 ? r.avg : null
              }),
            }))}
          />
        </TapChart>
      </Section>

      {/* ⑥ weekly trend */}
      <Section title={`⑥ ${t('analysis.weekTrend')}`} help={t('analysis.weekTrendHelp')}>
        <TapChart label={t('analysis.how.open')} onOpen={() => setOpenChart('weekly')}>
          <LineChart
            unit="杯"
            labels={Array.from({ length: 53 }, (_, i) => `${i + 1}週`)}
            series={wYears.map((y, i) => ({
              label: y,
              color: yearColor(i, wYears.length),
              // a week with fewer than 4 complete days is left out
              values: Array.from({ length: 53 }, (_, k) => {
                const r = wtrend.find((x) => x.year === y && x.week === k + 1)
                return r && r.days >= 4 ? r.avg : null
              }),
            }))}
          />
        </TapChart>
      </Section>

      {/* ⑦ day types vs the same month of the years before */}
      <Section title={`⑦ ${t('analysis.typeYears', { month: Number(month.slice(5, 7)) })}`} help={t('analysis.typeYearsHelp')}>
        {ty.years.length === 0 ? (
          <p className="text-sm text-muted">{t('stats.noData')}</p>
        ) : (
          <div className="-mx-2 overflow-x-auto px-2">
            <table className="w-full min-w-[18rem] text-center text-xs">
              <thead className="text-slate-600">
                <tr>
                  <th className="text-left">{t('analysis.dayType')}</th>
                  {ty.years.map((y) => (
                    <th key={y}>{t('analysis.yearCol', { year: y })}</th>
                  ))}
                  {tyPrev && <th>{t('analysis.yoyCol')}</th>}
                </tr>
              </thead>
              <tbody>
                {ty.rows.map((r) => {
                  const a = tyLast ? r.cells[tyLast]!.avg : null
                  const b = tyPrev ? r.cells[tyPrev]!.avg : null
                  const diff = a !== null && b ? Math.round((a / b - 1) * 1000) / 10 : null
                  return (
                    <tr key={r.dayType} className="border-t border-line">
                      <th className="py-1.5 text-left font-normal">{t(`chorei:target.${r.dayType}`)}</th>
                      {ty.years.map((y) => (
                        <td key={y} className="tabular-nums">
                          <b>{bw(r.cells[y]!.avg)}</b>
                          <span className="block text-[10px] text-muted">{r.cells[y]!.days ? t('analysis.days', { n: r.cells[y]!.days }) : ''}</span>
                        </td>
                      ))}
                      {tyPrev && <td className={cx('font-bold tabular-nums', diff === null ? 'text-slate-500' : diff >= 0 ? 'text-green-700' : 'text-red-700')}>{pct(diff)}</td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ⑧ improvement */}
      <Section title={`⑧ ${t('analysis.improvement')}`} help={t('analysis.improvementHelp')}>
        <TapChart label={t('analysis.how.open')} onOpen={() => setOpenChart('yoyWeekly')}>
          <LineChart
            labels={weeks.map((w) => `${Number(w.monday.slice(5, 7))}/${Number(w.monday.slice(8))}`)}
            marker={startIdx}
            zero
            unit="%"
            series={[{ label: t('analysis.weeklyYoy'), color: '#1d4ed8', values: weeks.map((w) => w.yoy) }]}
          />
        </TapChart>
        <TapChart label={t('analysis.how.open')} onOpen={() => setOpenChart('patrol')}>
          <LineChart
            labels={weeks.map((w) => `${Number(w.monday.slice(5, 7))}/${Number(w.monday.slice(8))}`)}
            marker={startIdx}
            series={[{ label: t('analysis.patrolAvg'), color: '#16a34a', values: weeks.map((w) => w.patrol) }]}
          />
        </TapChart>
        <h3 className="mt-1 text-sm font-bold">{t('analysis.bands')}</h3>
        <ul className="grid grid-cols-3 gap-2 text-center text-xs">
          {bands.map((b) => (
            <li key={b.key} className={cx('rounded-xl p-2', rateBg(b.rate))}>
              <span className="block font-bold">{t(`analysis.band.${b.key}`)}</span>
              <b className={cx('text-lg', rateCls(b.rate))}>{b.rate === null ? '—' : `${b.rate}%`}</b>
              <span className="block text-slate-600">{t('analysis.slots', { n: b.slots })}</span>
            </li>
          ))}
        </ul>
      </Section>

      {/* ⑨ events */}
      <Section title={`⑨ ${t('analysis.events')}`} help={t('analysis.eventsHelp')}>
        {effects.length === 0 ? (
          <p className="text-sm text-muted">{t('analysis.noEvents')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line text-sm">
            {effects.map((e) => (
              <li key={`${e.name}${e.storeId}${e.from}`} className={cx('py-2', !e.active && 'opacity-60')}>
                <b>
                  {eventIcon(e.name)} {e.name}
                </b>
                <span className="text-xs text-slate-600">
                  {'　'}
                  {e.storeId ? storeLabel(e.storeId) : t('analysis.bothStores')}・{formatShortDate(e.from)}
                  {e.to !== e.from && `〜${formatShortDate(e.to)}`}
                  {!e.active && '（OFF）'}
                </span>
                <span className="mt-1 grid grid-cols-3 gap-1 text-center text-xs">
                  {e.shifts.map((s) => (
                    <span key={s.shift} className="rounded-lg bg-slate-50 p-1">
                      {t(`common:shift.${s.shift}`)}
                      <span className="block">
                        {t('analysis.set')} {pct(s.set)} → <b className={s.measured === null ? '' : s.measured >= 0 ? 'text-green-700' : 'text-red-700'}>{pct(s.measured)}</b>
                      </span>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Excel */}
      <Button onClick={() => download.mutate()} disabled={download.isPending}>
        📥 {t('analysis.export')}
      </Button>
      {download.error && <ErrorBox message={errorMessage(download.error)} />}
      <p className="text-xs text-muted">{t('analysis.note')}</p>

      {openChart && <ChartDetail info={chartInfo(openChart)} onClose={() => setOpenChart(null)} />}
      {openStat && <SummaryDetail kind={openStat} days={days} summary={summary} today={now} onClose={() => setOpenStat(null)} />}
      {dayOpen && (
        <DaySheet
          day={dayOpen}
          reports={(reports.data ?? []).filter((r) => r.business_date === dayOpen.date && ctx.storeIds.includes(r.store_id) && ctx.shifts.includes(r.shift))}
          storeLabel={storeLabel}
          onClose={() => setOpenDay(null)}
        />
      )}
    </div>
  )
}

