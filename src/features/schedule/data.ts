import { useQuery } from '@tanstack/react-query'
import type { Duty } from '../../domain/duty'
import type { Assignment } from '../../domain/schedule'
import { addDays, tokyoParts } from '../../domain/time'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'

export interface AssignmentRow extends Assignment {
  id: string
  roster_name: string
}

export interface Coworker {
  roster_name: string
  start_min: number
  end_min: number
  store_mark: string
}

/** My assignments from the start of last month onwards (RLS: own rows only, managers all → filter by name). */
export function useMySchedule(rosterName: string | null) {
  const from = `${addDays(`${tokyoParts(new Date()).date.slice(0, 7)}-01`, -1).slice(0, 7)}-01`
  return useQuery({
    queryKey: ['shift_assignments', rosterName, from],
    enabled: Boolean(rosterName),
    staleTime: 5 * 60 * 1000,
    queryFn: async () =>
      unwrap<AssignmentRow[]>(
        await supabase
          .from('shift_assignments')
          .select('id, roster_name, business_date, shift, store_mark, start_min, end_min, original_end_min')
          .eq('roster_name', rosterName!)
          .gte('business_date', from)
          .order('business_date')
          .order('start_min'),
      ),
  })
}

/** My 朝礼・巡回 duties from yesterday (遅番 runs past midnight) to a week ahead, with done flags. */
export function useMyDuties(rosterName: string | null) {
  const today = tokyoParts(new Date()).date
  return useQuery({
    queryKey: ['my_duties', rosterName, today],
    enabled: Boolean(rosterName),
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => unwrap<Duty[]>(await supabase.rpc('my_duties', { p_from: addDays(today, -1), p_to: addDays(today, 7) })),
  })
}

export function useCoworkers(a: Pick<Assignment, 'business_date' | 'shift'>) {
  return useQuery({
    queryKey: ['shift_coworkers', a.business_date, a.shift],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => unwrap<Coworker[]>(await supabase.rpc('shift_coworkers', { p_date: a.business_date, p_shift: a.shift })),
  })
}
