import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
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
