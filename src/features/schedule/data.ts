import { useQuery } from '@tanstack/react-query'
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
          .select('id, roster_name, business_date, shift, store_mark, start_min, end_min')
          .eq('roster_name', rosterName!)
          .gte('business_date', from)
          .order('business_date')
          .order('start_min'),
      ),
  })
}

export function useCoworkers(a: Pick<Assignment, 'business_date' | 'shift'>) {
  return useQuery({
    queryKey: ['shift_coworkers', a.business_date, a.shift],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => unwrap<Coworker[]>(await supabase.rpc('shift_coworkers', { p_date: a.business_date, p_shift: a.shift })),
  })
}
