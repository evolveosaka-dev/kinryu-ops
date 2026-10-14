import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { StatChorei, StatMiss, StatPatrol } from '../../domain/stats'
import type { SystemStatus } from '../../domain/systemStatus'
import type { Incident } from '../../domain/incident'
import type { AiReport } from '../../domain/report'
import { addDays, tokyoParts } from '../../domain/time'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import type { AttachmentSummary } from '../../lib/types'
import type { IssueStatus, IssueTag } from '../../domain/issues'
import type { RecordComment } from '../comments/Comments'

export type AdminPatrol = StatPatrol & {
  /** recorded afterwards by a manager (巡回を後から記録) */
  entered_by_manager: boolean
  manager_note: string | null
  good_points: string | null
  improvements: string | null
  remarks: string | null
  customer_none: boolean
  customer_satisfied: boolean | null
  customer_reason: string | null
  issue_tags: IssueTag[] | null
  staff_on_shift: string
  follow_up_note: string | null
  void_reason: string | null
  submitted_at: string | null
  original_texts: Record<string, string> | null
  source_lang: string | null
  attachments: AttachmentSummary[]
  comments: RecordComment[]
}

export type AdminChorei = StatChorei & {
  participants: string[]
  stock_none: boolean
  /** recorded afterwards by a manager (✗ → ✓), sent at the meeting time */
  entered_by_manager: boolean
  manager_note: string | null
  stock_text: string | null
  target_bowls: number | null
  caution_text: string | null
  submitted_at: string
  void_reason: string | null
  original_texts: Record<string, string> | null
  attachments: AttachmentSummary[]
  notes: { body: string; created_at: string }[]
  comments: RecordComment[]
}

export interface Person {
  id: string
  display_name: string
  full_name: string | null
  roster_name: string | null
  status: string
}

export interface Range {
  from: string
  to: string
}

const ATT = 'attachments(id, kind, status, drive_url, owner_id, created_at)'

/** 朝礼 and 巡回 of a date range (managers read everything through RLS). */
export function useRecords(range: Range) {
  const chorei = useQuery({
    queryKey: ['admin', 'chorei', range.from, range.to],
    queryFn: async () =>
      unwrap<AdminChorei[]>(
        await supabase
          .from('chorei_records')
          .select(`*, ${ATT}, notes:chorei_notes(body, created_at), comments:chorei_comments(id, body, author_id, author_name, created_at, read_at)`)
          .eq('is_test', false)
          .gte('business_date', range.from)
          .lte('business_date', range.to)
          .order('business_date', { ascending: false })
          .order('created_at', { referencedTable: 'comments' }),
      ),
  })
  const patrols = useQuery({
    queryKey: ['admin', 'patrols', range.from, range.to],
    queryFn: async () =>
      unwrap<AdminPatrol[]>(
        await supabase
          .from('patrol_checks')
          .select(`*, ${ATT}, comments:patrol_comments(id, body, author_id, author_name, created_at, read_at)`)
          .eq('is_test', false)
          .gte('business_date', range.from)
          .lte('business_date', range.to)
          .order('started_at', { ascending: false })
          .order('created_at', { referencedTable: 'comments' }),
      ),
  })
  // 朝礼できなかった reports and managers' ✓ (test accounts' reports left out)
  const misses = useQuery({
    queryKey: ['admin', 'misses', range.from, range.to],
    queryFn: async () =>
      unwrap<StatMiss[]>(
        await supabase
          .from('chorei_misses')
          .select('id, store_id, business_date, shift, kind, reason, note, original_texts, reporter_id, by_manager, updated_at, attachments(id, kind, status, drive_url)')
          .eq('by_test_account', false)
          .gte('business_date', range.from)
          .lte('business_date', range.to),
      ),
  })
  return {
    chorei,
    patrols,
    misses,
    isLoading: chorei.isLoading || patrols.isLoading || misses.isLoading,
    error: chorei.error ?? patrols.error ?? misses.error,
  }
}

/** Everyone with an account; `name(id)` prefers the full name used for reports. */
/** 面談指導 status per person × kind (all people, or one). */
export function useIssueStatus(staff?: string) {
  return useQuery({
    queryKey: ['staff', 'status', staff ?? ''],
    queryFn: async () => unwrap<IssueStatus[]>(await supabase.rpc('staff_issue_status', staff ? { p_staff: staff } : {})),
  })
}

export function usePeople() {
  const q = useQuery({
    queryKey: ['admin', 'people'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => unwrap<Person[]>(await supabase.from('profiles').select('id, display_name, full_name, roster_name, status')),
  })
  const byId = new Map((q.data ?? []).map((p) => [p.id, p]))
  const name = (id: string) => {
    const p = byId.get(id)
    return p ? p.full_name || p.display_name || '?' : '?'
  }
  return { ...q, name }
}

// ---- periods (Tokyo dates)

export const today = () => tokyoParts(new Date()).date

export function weekOf(date: string): Range {
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay()
  const from = addDays(date, wd === 0 ? -6 : 1 - wd)
  return { from, to: addDays(from, 6) }
}

export function monthOf(month: string /* YYYY-MM */): Range {
  const from = `${month}-01`
  const next = new Date(`${from}T00:00:00Z`)
  next.setUTCMonth(next.getUTCMonth() + 1)
  return { from, to: addDays(next.toISOString().slice(0, 10), -1) }
}

export const shiftMonth = (month: string, by: number) => {
  const d = new Date(`${month}-01T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + by)
  return d.toISOString().slice(0, 7)
}

// ---- Tokyo date-time <-> <input type="datetime-local">

export const toLocalInput = (iso: string | null) =>
  iso ? new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 16) : ''
export const fromLocalInput = (value: string) => new Date(`${value}:00+09:00`).toISOString()
export const jstDateTime = (iso: string | null) => (iso ? toLocalInput(iso).replace('T', ' ') : '')

// ---- export

export interface ExportSheet {
  name: string
  rows: (string | number | null)[][]
}

/** .xlsx download; the library is loaded only when a manager exports. */
export async function exportXlsx(fileName: string, sheets: ExportSheet[]) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  await writeXlsxFile(
    sheets.map((s) => ({
      sheet: s.name.slice(0, 31),
      data: s.rows.map((r, i) => r.map((v) => (i === 0 ? { value: v ?? '', fontWeight: 'bold' as const } : v))),
    })),
  ).toFile(fileName)
}

/** CSV with BOM so Excel opens Japanese correctly. */
export function exportCsv(fileName: string, rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v === null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const blob = new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = fileName
  a.click()
  URL.revokeObjectURL(a.href)
}

// ---- period navigation (week / month)

export type PeriodMode = 'week' | 'month'

/** Week / month navigator (◀ ▶). */
export function usePeriod(initial: PeriodMode = 'week') {
  const [mode, setMode] = useState<PeriodMode>(initial)
  const [anchor, setAnchor] = useState(today())
  const range: Range = mode === 'week' ? weekOf(anchor) : monthOf(anchor.slice(0, 7))
  const move = (by: number) =>
    setAnchor((a) => (mode === 'week' ? addDays(a, 7 * by) : `${shiftMonth(a.slice(0, 7), by)}-01`))
  return { mode, setMode, range, move }
}

export const JUDGE_STYLE: Record<string, string> = {
  good: 'bg-green-100 text-green-900',
  improve: 'bg-amber-100 text-amber-900',
  coaching: 'bg-red-100 text-red-900',
}

/** 管理 → 設定 → システム状態 (also the ダッシュボード warning). */
export function useSystemStatus() {
  return useQuery({
    queryKey: ['admin', 'system_status'],
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async () => unwrap<SystemStatus>(await supabase.rpc('system_status')),
  })
}

export type IncidentRow = Incident & { attachments: AttachmentSummary[] }

/** Managers: incidents (test accounts' only for test accounts — RLS), newest first. */
export function useIncidents() {
  return useQuery({
    queryKey: ['incidents', 'all'],
    refetchInterval: 2 * 60_000,
    queryFn: async () =>
      unwrap<IncidentRow[]>(
        await supabase
          .from('incidents')
          .select('*, attachments(id, kind, status, drive_url, owner_id, created_at)')
          .order('occurred_at', { ascending: false })
          .limit(300),
      ),
  })
}

/** 管理 → レポート: newest first. */
export function useReports() {
  return useQuery({
    queryKey: ['admin', 'ai_reports'],
    queryFn: async () => unwrap<AiReport[]>(await supabase.from('ai_reports').select('*').order('period_from', { ascending: false }).order('kind').limit(60)),
  })
}
