import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../../../components/Sheet'
import { Formula, Table } from './SummaryDetail'

export type ChartKind = 'daily' | 'monthly' | 'weekly' | 'yoyWeekly' | 'patrol'

export interface ChartInfo {
  kind: ChartKind
  title: string
  head: string[]
  rows: { key: string; cells: ReactNode[]; muted?: boolean }[]
}

/** How a chart of 管理 → 分析 is calculated, with the numbers it draws. */
export function ChartDetail({ info, onClose }: { info: ChartInfo; onClose: () => void }) {
  const { t } = useTranslation('manager')
  return (
    <Sheet title={info.title} onClose={onClose}>
      <Formula>{t(`analysis.chartHow.${info.kind}.formula`)}</Formula>
      <p className="text-xs whitespace-pre-line text-muted">{t(`analysis.chartHow.${info.kind}.note`)}</p>
      {info.rows.length === 0 ? <p className="text-sm text-muted">{t('stats.noData')}</p> : <Table head={info.head} rows={info.rows} />}
    </Sheet>
  )
}

/** A chart that opens its explanation when tapped. */
export function TapChart({ label, onOpen, children }: { label: string; onOpen: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onOpen} aria-label={label} className="relative w-full rounded-xl text-left active:bg-slate-50">
      {children}
      <span className="absolute top-0 right-1 text-xs font-bold text-brand">ⓘ</span>
    </button>
  )
}
