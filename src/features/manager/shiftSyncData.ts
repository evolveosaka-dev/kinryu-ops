import { useQuery } from '@tanstack/react-query'
import { tokyoParts } from '../../domain/time'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'

// シフト表の取り込み (Office 365 / app): the list of changes of each import and the last automatic run.

export interface ShiftChange {
  date: string
  shift: 'early' | 'middle' | 'late'
  name: string
  kind: 'added' | 'removed' | 'changed'
  before: string | null
  after: string | null
}
export interface ShiftImportLog {
  id: number
  month: string
  source: 'app' | 'office365'
  imported_at: string
  n_changes: number
  changes: ShiftChange[]
}
export interface SyncStatus {
  at: string
  ok: boolean
  month?: string
  rows?: number
  changes?: number
  error?: string
}

/** Imports with changes; `days` = only the last N days. */
export function useShiftImportLog(days?: number) {
  return useQuery({
    queryKey: ['admin', 'shift_import_log', days ?? 'all'],
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabase.from('shift_import_log').select('id, month, source, imported_at, n_changes, changes').gt('n_changes', 0).order('imported_at', { ascending: false }).limit(30)
      if (days) q = q.gte('imported_at', new Date(Date.now() - days * 86400_000).toISOString())
      return unwrap<ShiftImportLog[]>(await q)
    },
  })
}

export function useShiftSyncStatus() {
  return useQuery({
    queryKey: ['admin', 'shift_sync_status'],
    staleTime: 60_000,
    queryFn: async () => {
      const rows = unwrap<{ key: string; value: string }[]>(await supabase.from('app_kv').select('key, value').in('key', ['shift_workbook_url', 'shift_sync_status']))
      const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null
      const raw = get('shift_sync_status')
      return { url: get('shift_workbook_url'), status: raw ? (JSON.parse(raw) as SyncStatus) : null }
    },
  })
}

/** The business date of the import (Tokyo): changes before it are corrections of past days. */
export const importDay = (log: ShiftImportLog) => tokyoParts(new Date(log.imported_at)).date

export function pastChanges(log: ShiftImportLog) {
  const day = importDay(log)
  return log.changes.filter((c) => c.date < day)
}
