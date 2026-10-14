import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Scheduled } from '../domain/participants'
import type { RosterEntry, StaffEntry, Store, TargetBowls } from './types'

/** Throw the PostgREST error so react-query / callers see it. */
export function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

export function useStores() {
  return useQuery({
    queryKey: ['stores'],
    staleTime: Infinity,
    queryFn: async () =>
      unwrap<Store[]>(await supabase.from('stores').select('*').eq('active', true).order('sort_order')),
  })
}

export function useHolidays() {
  return useQuery({
    queryKey: ['holidays'],
    staleTime: Infinity,
    queryFn: async () => {
      const rows = unwrap<{ date: string }[]>(await supabase.from('holidays').select('date'))
      return new Set(rows.map((r) => r.date))
    },
  })
}

export function useTargets() {
  return useQuery({
    queryKey: ['target_bowls'],
    staleTime: 60 * 60 * 1000,
    queryFn: async () => unwrap<TargetBowls[]>(await supabase.from('target_bowls').select('*')),
  })
}

/** People in the shift table for one store / date / shift, with their times (minutes from 00:00 of the business date). */
export function useSlotSchedule(storeId: string, date: string | undefined, shift: string | undefined) {
  return useQuery({
    queryKey: ['slot_staff', storeId, date, shift],
    enabled: Boolean(storeId && date && shift),
    staleTime: 10 * 60 * 1000,
    queryFn: async () =>
      unwrap<Scheduled[]>(await supabase.rpc('slot_staff', { p_store: storeId, p_date: date, p_shift: shift })),
  })
}

/** Names scheduled for one 朝礼 slot (store, date, shift), from the imported shift table. */
export function useSlotStaff(storeId: string, date: string | undefined, shift: string | undefined) {
  const q = useSlotSchedule(storeId, date, shift)
  return { ...q, data: q.data?.map((r) => r.roster_name) }
}

/** Active staff names from the shift table (for the per-person pickers). */
export function useRoster() {
  return useQuery({
    queryKey: ['staff_roster', 'active'],
    staleTime: 10 * 60 * 1000,
    queryFn: async () =>
      unwrap<RosterEntry[]>(await supabase.from('staff_roster').select('id, name, home_store_id, active').eq('active', true).order('name')),
  })
}

export function useStaffDirectory() {
  return useQuery({
    queryKey: ['staff_directory'],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => unwrap<StaffEntry[]>(await supabase.rpc('staff_directory')),
  })
}
