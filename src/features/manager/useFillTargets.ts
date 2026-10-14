import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth, useMe } from '../../app/auth'
import { findTarget } from '../../domain/targets'
import type { Shift } from '../../domain/types'
import { unwrap, useHolidays, useTargetEvents, useTargets } from '../../lib/queries'
import { supabase } from '../../lib/supabase'

interface NoTarget {
  id: string
  store_id: string
  business_date: string
  shift: Shift
}

/**
 * 朝礼 records sent without 目標杯数 get the target of 管理 → 設定 → 目標杯数 (day type + events, the same
 * calculation as the 朝礼 form). Runs whenever a manager opens 管理 and again after the targets change;
 * records whose month has no target yet stay empty until one is set. No mail (fill_chorei_targets).
 */
export function useFillTargets() {
  const { isManager } = useAuth()
  const me = useMe()
  const queryClient = useQueryClient()
  const targets = useTargets()
  const events = useTargetEvents()
  const holidays = useHolidays()
  const ready = isManager && !me.is_test_account && Boolean(targets.data && events.data && holidays.data)
  return useQuery({
    queryKey: ['fill_targets', targets.dataUpdatedAt, events.dataUpdatedAt],
    enabled: ready,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const rows = unwrap<NoTarget[]>(
        await supabase.from('chorei_records').select('id, store_id, business_date, shift').is('target_bowls', null).neq('status', 'draft').eq('by_test_account', false),
      )
      const found = rows.flatMap((r) => {
        const t = findTarget(targets.data!, events.data!, r.store_id, r.business_date, r.shift, holidays.data!)
        return t ? [{ id: r.id, bowls: t.bowls }] : []
      })
      if (!found.length) return 0
      const n = unwrap<number>(await supabase.rpc('fill_chorei_targets', { p_rows: found }))
      if (n) void queryClient.invalidateQueries({ queryKey: ['admin'] })
      return n
    },
  })
}
