import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { InfoSheet, type SourceKey, type TableRow } from './explain'

export type ChartKind = 'daily' | 'monthly' | 'weekly' | 'yoyWeekly' | 'patrol'

export interface ChartInfo {
  kind: ChartKind
  title: string
  head: string[]
  rows: TableRow[]
}

const SOURCES: Record<ChartKind, SourceKey[]> = {
  daily: ['sales', 'target', 'events', 'lastYear'],
  monthly: ['sales'],
  weekly: ['sales'],
  yoyWeekly: ['sales', 'lastYear'],
  patrol: ['patrol'],
}

/** How a chart of 管理 → 分析 is calculated, with the numbers it draws. */
export function ChartDetail({ info, onClose }: { info: ChartInfo; onClose: () => void }) {
  const { t } = useTranslation('manager')
  return (
    <InfoSheet
      info={{ title: info.title, formula: t(`analysis.chartHow.${info.kind}.formula`), note: t(`analysis.chartHow.${info.kind}.note`), sources: SOURCES[info.kind], head: info.head, rows: info.rows }}
      onClose={onClose}
    />
  )
}

/** A chart (or any figure) that opens its explanation when tapped. */
export function TapChart({ label, onOpen, children }: { label: string; onOpen: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onOpen} aria-label={label} className="relative w-full rounded-xl text-left active:bg-slate-50">
      {children}
      <span className="absolute top-0 right-1 text-xs font-bold text-brand">ⓘ</span>
    </button>
  )
}
