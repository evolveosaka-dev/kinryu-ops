import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../../../components/Sheet'
import { cx } from '../../../lib/cx'

// 管理 → 分析: how a figure is calculated. Formula text: one formula per line ("\n"),
// a line starting with "=" continues the one above, [[numerator || denominator]] is drawn as a fraction.

const FRACTION = /\[\[(.+?)\|\|(.+?)\]\]/g

function Frac({ num, den }: { num: string; den: string }) {
  return (
    <span className="inline-flex flex-col items-center px-0.5 text-center leading-tight">
      <span className="px-1 pb-0.5">{num}</span>
      <span className="w-full border-t-2 border-sky-900 px-1 pt-0.5">{den}</span>
    </span>
  )
}

function Line({ text }: { text: string }) {
  const parts: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(FRACTION)) {
    parts.push(text.slice(last, m.index))
    parts.push(<Frac key={m.index} num={m[1]!.trim()} den={m[2]!.trim()} />)
    last = m.index + m[0].length
  }
  parts.push(text.slice(last))
  return <div className={cx('flex flex-wrap items-center gap-x-1 gap-y-1', text.trimStart().startsWith('=') && 'pl-4')}>{parts}</div>
}

export function Formula({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl bg-sky-50 p-3 text-sm font-bold text-sky-900">
      {text
        .split('\n')
        .filter((l) => l.trim())
        .map((l, i) => (
          <Line key={i} text={l} />
        ))}
    </div>
  )
}

export type SourceKey = 'sales' | 'target' | 'events' | 'lastYear' | 'dayType' | 'patrol' | 'reports'

/** 📂 データ元: where the numbers come from. */
export function Sources({ keys }: { keys: SourceKey[] }) {
  const { t } = useTranslation('manager')
  return (
    <div className="rounded-xl border border-line p-2 text-xs text-slate-700">
      <b className="block pb-1">📂 {t('analysis.src.title')}</b>
      <ul className="flex flex-col gap-1">
        {keys.map((k) => (
          <li key={k}>・{t(`analysis.src.${k}`)}</li>
        ))}
      </ul>
      <span className="block pt-1 text-muted">{t('analysis.src.dataFrom')}</span>
    </div>
  )
}

export interface TableRow {
  key: string
  cells: ReactNode[]
  muted?: boolean
}

export function Table({ head, rows, foot }: { head: string[]; rows: TableRow[]; foot?: ReactNode[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-slate-600">
        <tr>
          {head.map((h, i) => (
            <th key={`${h}${i}`} className={i === 0 ? 'text-left' : 'text-right'}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className={cx('border-t border-line', r.muted && 'text-slate-400')}>
            {r.cells.map((c, i) => (
              <td key={i} className={cx('py-1 tabular-nums', i === 0 ? 'text-left' : 'text-right')}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {foot && (
        <tfoot>
          <tr className="border-t-2 border-line font-bold">
            {foot.map((c, i) => (
              <td key={i} className={cx('py-1.5 tabular-nums', i === 0 ? 'text-left' : 'text-right')}>
                {c}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  )
}

export interface InfoProps {
  title: string
  formula: string
  note?: string
  sources: SourceKey[]
  head?: string[]
  rows?: TableRow[]
  foot?: ReactNode[]
}

/** Formula, note, data sources and the numbers used. */
export function InfoSheet({ info, onClose }: { info: InfoProps; onClose: () => void }) {
  const { t } = useTranslation('manager')
  return (
    <Sheet title={info.title} onClose={onClose}>
      <Formula text={info.formula} />
      {info.note && <p className="text-xs whitespace-pre-line text-muted">{info.note}</p>}
      <Sources keys={info.sources} />
      {info.head && (info.rows?.length ? <Table head={info.head} rows={info.rows} foot={info.foot} /> : <p className="text-sm text-muted">{t('stats.noData')}</p>)}
    </Sheet>
  )
}
