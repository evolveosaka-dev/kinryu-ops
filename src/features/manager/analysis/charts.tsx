import type { DayView } from '../../../domain/salesAnalysis'

// Small SVG charts (no chart library: the page stays light on phones).

export const RATE_FILL = (rate: number | null) => (rate === null ? '#cbd5e1' : rate >= 100 ? '#16a34a' : rate >= 90 ? '#f59e0b' : '#dc2626')

const niceMax = (v: number) => {
  if (v <= 0) return 10
  const p = 10 ** Math.floor(Math.log10(v))
  return Math.ceil(v / p) * p
}

/** Bars = actual (colour = 達成率), dashed blue = target, grey = same weekday last year. */
export function DailyChart({ days }: { days: DayView[] }) {
  const W = 30 + days.length * 12
  const H = 170
  const top = 10, bottom = 150, left = 30
  const max = niceMax(Math.max(1, ...days.flatMap((d) => [d.actual ?? 0, d.target ?? d.targetAll ?? 0, d.lastYear ?? 0])) * 1.05)
  const y = (v: number) => bottom - (v / max) * (bottom - top)
  const x = (i: number) => left + i * 12 + 6
  const line = (vals: (number | null)[]) =>
    vals
      .map((v, i) => (v === null ? null : `${x(i)},${y(v)}`))
      .reduce<string[][]>((acc, p) => {
        if (p === null) acc.push([])
        else acc[acc.length - 1]!.push(p)
        return acc
      }, [[]])
      .filter((seg) => seg.length > 1)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line x1={left} x2={W} y1={y(max * f)} y2={y(max * f)} stroke="#e2e8f0" strokeWidth="0.6" />
          <text x={left - 3} y={y(max * f) + 3} fontSize="7" textAnchor="end" fill="#64748b">
            {Math.round(max * f)}
          </text>
        </g>
      ))}
      {days.map((d, i) =>
        d.actual === null ? null : (
          <rect key={d.date} x={x(i) - 4.5} y={y(d.actual)} width="9" height={bottom - y(d.actual)} rx="1.5" fill={RATE_FILL(d.target ? (d.actual / d.target) * 100 : null)} opacity="0.85" />
        ),
      )}
      {line(days.map((d) => d.lastYear)).map((seg, k) => (
        <polyline key={`ly${k}`} points={seg.join(' ')} fill="none" stroke="#94a3b8" strokeWidth="1.2" />
      ))}
      {line(days.map((d) => d.target ?? d.targetAll)).map((seg, k) => (
        <polyline key={`t${k}`} points={seg.join(' ')} fill="none" stroke="#1d4ed8" strokeWidth="1.3" strokeDasharray="3 2" />
      ))}
      {days.map((d, i) =>
        Number(d.date.slice(8)) % 5 === 1 || i === days.length - 1 ? (
          <text key={`l${d.date}`} x={x(i)} y={H - 6} fontSize="7" textAnchor="middle" fill="#334155">
            {Number(d.date.slice(8))}
          </text>
        ) : null,
      )}
    </svg>
  )
}

export interface Series {
  label: string
  color: string
  values: (number | null)[]
  dashed?: boolean
}

/** Simple multi-line chart; `marker` = index of a vertical line (e.g. the start of 朝礼・巡回). */
export function LineChart({ series, labels, marker, zero, unit = '' }: { series: Series[]; labels: string[]; marker?: number; zero?: boolean; unit?: string }) {
  const n = labels.length
  const W = 320, H = 170, top = 12, bottom = 145, left = 34, right = 16
  const vals = series.flatMap((s) => s.values.filter((v): v is number => v !== null))
  let lo = Math.min(...vals, zero ? 0 : Infinity)
  let hi = Math.max(...vals, zero ? 0 : -Infinity)
  if (!vals.length) {
    lo = 0
    hi = 1
  }
  if (!zero) lo = Math.max(0, lo - (hi - lo) * 0.15)
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.1
  lo -= zero ? pad : 0
  hi += pad
  const x = (i: number) => left + (n <= 1 ? 0 : (i / (n - 1)) * (W - left - right))
  const y = (v: number) => bottom - ((v - lo) / (hi - lo)) * (bottom - top)
  const ticks = [0, 0.5, 1].map((f) => lo + (hi - lo) * f)
  const step = Math.max(1, Math.ceil(n / 8))
  return (
    <div className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={left} x2={W - right} y1={y(v)} y2={y(v)} stroke="#e2e8f0" strokeWidth="0.6" />
            <text x={left - 3} y={y(v) + 3} fontSize="8" textAnchor="end" fill="#64748b">
              {hi - lo < 10 ? v.toFixed(1) : Math.round(v)}
              {unit}
            </text>
          </g>
        ))}
        {zero && <line x1={left} x2={W - right} y1={y(0)} y2={y(0)} stroke="#475569" strokeWidth="0.8" />}
        {marker !== undefined && marker >= 0 && <line x1={x(marker)} x2={x(marker)} y1={top} y2={bottom} stroke="#dc2626" strokeWidth="1" strokeDasharray="3 2" />}
        {series.map((s) => (
          <g key={s.label}>
            {/* a gap (no data) breaks the line */}
            {s.values
              .reduce<string[][]>((acc, v, i) => {
                if (v === null) acc.push([])
                else acc[acc.length - 1]!.push(`${x(i)},${y(v)}`)
                return acc
              }, [[]])
              .filter((seg) => seg.length > 1)
              .map((seg, k) => (
                <polyline key={k} points={seg.join(' ')} fill="none" stroke={s.color} strokeWidth="1.8" strokeDasharray={s.dashed ? '4 3' : undefined} />
              ))}
            {s.values.map((v, i) => (v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r="2" fill={s.color} />))}
          </g>
        ))}
        {labels.map((l, i) =>
          i % step === 0 || i === n - 1 ? (
            <text key={i} x={x(i)} y={H - 8} fontSize="8" textAnchor="middle" fill="#334155">
              {l}
            </text>
          ) : null,
        )}
      </svg>
      <p className="flex flex-wrap gap-3 text-xs">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-4" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </p>
    </div>
  )
}
