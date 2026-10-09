import { useTranslation } from 'react-i18next'
import { formatShortDate, weekdayOf } from '../../domain/time'
import type { Shift } from '../../domain/types'

export const SHIFT_STYLE: Record<Shift, { chip: string; soft: string }> = {
  early: { chip: 'bg-amber-500 text-white', soft: 'bg-amber-50 border-amber-200' },
  middle: { chip: 'bg-violet-600 text-white', soft: 'bg-violet-50 border-violet-200' },
  late: { chip: 'bg-slate-800 text-white', soft: 'bg-slate-100 border-slate-300' },
}

export const STORE_DOT: Record<string, string> = { '①': 'bg-blue-600', '⑤': 'bg-orange-500' }

/** 10/12(月) */
export function useDayLabel() {
  const { t } = useTranslation()
  return (date: string) => `${formatShortDate(date)}(${t(`wd.${weekdayOf(date)}`)})`
}

/** minutes → hours with at most one decimal (510 → "8.5") */
export const hours = (min: number) => String(Math.round((min / 60) * 10) / 10)
