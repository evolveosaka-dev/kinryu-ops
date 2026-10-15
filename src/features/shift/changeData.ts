import { useQuery } from '@tanstack/react-query'
import { useMe } from '../../app/auth'
import { useTranslation } from 'react-i18next'
import { formatMin } from '../../domain/schedule'
import type { AttendanceEvent } from '../../domain/attendance'
import { KIND_ICON, type ChangeKind, type ChangeReason, type CoverProblem, type ShiftChange, type ShiftOffer, type Recruit, type Visa, type VisaWindow } from '../../domain/shiftChange'
import { addDays, tokyoParts } from '../../domain/time'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { WINDOW_DAYS } from '../../domain/attendance'

export const today = () => tokyoParts(new Date()).date

export type ChangeWithOffers = ShiftChange & { offers: ShiftOffer[] }

const CHANGE_COLS = '*, offers:shift_offers(id, change_id, roster_name, give_date, give_shift, note, status, created_at)'

/** My reports (RLS: own rows) from 30 days ago on, newest shift first. */
export function useMyChanges(rosterName: string | null) {
  return useQuery({
    queryKey: ['shift_changes', 'mine', rosterName],
    enabled: Boolean(rosterName),
    queryFn: async () =>
      unwrap<ChangeWithOffers[]>(
        await supabase
          .from('shift_changes')
          .select(CHANGE_COLS)
          .eq('roster_name', rosterName!)
          .gte('business_date', addDays(today(), -30))
          .order('business_date', { ascending: false })
          .order('start_min', { ascending: false }),
      ),
  })
}

/** Managers: every report of a date range (by shift date). */
export function useChanges(from: string, to: string) {
  // a test account works on its own test reports (RLS already hides them from real managers)
  const tester = useMe().is_test_account
  return useQuery({
    queryKey: ['shift_changes', 'all', from, to, tester],
    refetchInterval: 60_000,
    queryFn: async () =>
      unwrap<ChangeWithOffers[]>(
        await supabase
          .from('shift_changes')
          .select(CHANGE_COLS)
          .in('is_test', tester ? [true, false] : [false])
          .gte('business_date', from)
          .lte('business_date', to)
          .order('business_date')
          .order('start_min'),
      ),
  })
}

/** 代わり募集 I could take, and the ones I offered on / was chosen for. */
export function useRecruits(enabled = true) {
  return useQuery({
    queryKey: ['shift_recruits'],
    enabled,
    staleTime: 30_000,
    refetchInterval: 2 * 60_000,
    queryFn: async () => unwrap<Recruit[]>(await supabase.rpc('shift_recruits')),
  })
}

/** 出勤評価 events of the last 90 days (staff: their own; managers: everyone). */
export function useAttendance(to = today()) {
  const from = addDays(to, -(WINDOW_DAYS - 1))
  return useQuery({
    queryKey: ['attendance', from, to],
    queryFn: async () => unwrap<AttendanceEvent[]>(await supabase.rpc('attendance_events', { p_from: from, p_to: to })),
  })
}

export const STATUS_STYLE: Record<ShiftChange['status'], string> = {
  open: 'bg-amber-100 text-amber-900',
  approved: 'bg-green-100 text-green-900',
  rejected: 'bg-red-100 text-red-900',
  cancelled: 'bg-slate-200 text-slate-700',
}

/** 休む 2時間 / 遅刻 20分 / 早退 20:00 */
export function useChangeLabel() {
  const { t } = useTranslation('shift')
  return (c: Pick<ShiftChange, 'kind' | 'late_min' | 'leave_min'>) =>
    `${KIND_ICON[c.kind]} ${t(`change.kind.${c.kind}`)}${c.kind === 'late' ? ` ${t('change.minutes', { n: c.late_min })}` : c.kind === 'early_leave' ? ` ${formatMin(c.leave_min!)}` : ''}`
}

export const noticeText = (t: (k: string, o?: Record<string, unknown>) => string, min: number) =>
  min < 0 ? t('change.noticeAfter') : min < 120 ? t('change.noticeMin', { n: min }) : t('change.noticeHours', { n: Math.floor(min / 60) })

export interface StaffLimit {
  roster_name: string
  visa: Visa | null
  weekly_limit_min: number | null
  note: string | null
}

/** Managers: 週の上限 and 留学 / 家族滞在 per shift-table name. */
export function useStaffLimits() {
  return useQuery({
    queryKey: ['admin', 'staff_limits'],
    queryFn: async () => unwrap<StaffLimit[]>(await supabase.from('staff_limits').select('roster_name, visa, weekly_limit_min, note')),
  })
}

/** Managers: 7-day windows of the people with a visa, from 6 days ago to 6 weeks ahead. */
export function useVisaWindows() {
  const d = today()
  return useQuery({
    queryKey: ['admin', 'visa_windows', d],
    queryFn: async () => unwrap<VisaWindow[]>(await supabase.rpc('visa_hour_windows', { p_from: addDays(d, -6), p_to: addDays(d, 42) })),
  })
}

/** 「キタさんは連続7日間で28時間を超えます（10/20〜10/26 最大34時間）」 */
export function useProblemText() {
  const { t } = useTranslation('shift')
  return (p: CoverProblem) =>
    t(`change.problem.${p.problem}`, {
      name: p.name,
      h: p.minutes ? Math.round((p.minutes / 60) * 10) / 10 : '',
      from: p.from ? p.from.slice(5).replace('-', '/') : '',
      to: p.to ? p.to.slice(5).replace('-', '/') : '',
    })
}

/** Reason label; the same for 休む / 遅れる / 早退 (交通の原因 for all three, owner 2026-10-15). */
export function useReasonLabel() {
  const { t } = useTranslation('shift')
  return (_kind: ChangeKind, r: ChangeReason) => t(`change.reason.${r}`)
}

export interface AvailableCover {
  roster_name: string
  choice: string
  until_1730: boolean
  problem: CoverProblem | null
}
