import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { StatChorei, StatPatrol } from '../../domain/stats'
import { addDays, tokyoParts } from '../../domain/time'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import type { AttachmentSummary } from '../../lib/types'

export type AdminPatrol = StatPatrol & {
  good_points: string | null
  improvements: string | null
  remarks: string | null
  staff_on_shift: string
  follow_up_note: string | null
  void_reason: string | null
  submitted_at: string | null
  original_texts: Record<string, string> | null
  source_lang: string | null
  attachments: AttachmentSummary[]
}

export type AdminChorei = StatChorei & {
  stock_none: boolean
  stock_text: string | null
  target_bowls: number | null
  caution_text: string | null
  submitted_at: string
  void_reason: string | null
  original_texts: Record<string, string> | null
  attachments: AttachmentSummary[]
  notes: { body: string; created_at: string }[]
}

export interface Person {
  id: string
  display_name: string
  full_name: string | null
  status: string
}

export interface Range {
  from: string
  to: string
}

const ATT = 'attachments(id, kind, status, drive_url)'

/** 朝礼 and 巡回 of a date range (managers read everything through RLS). */
export function useRecords(range: Range) {
  const chorei = useQuery({
    queryKey: ['admin', 'chorei', range.from, range.to],
    queryFn: async () =>
      unwrap<AdminChorei[]>(
        await supabase
          .from('chorei_records')
          .select(`*, ${ATT}, notes:chorei_notes(body, created_at)`)
          .eq('is_test', false)
          .gte('business_date', range.from)
          .lte('business_date', range.to)
          .order('business_date', { ascending: false }),
      ),
  })
  const patrols = useQuery({
    queryKey: ['admin', 'patrols', range.from, range.to],
    queryFn: async () =>
      unwrap<AdminPatrol[]>(
        await supabase
          .from('patrol_checks')
          .select(`*, ${ATT}`)
          .eq('is_test', false)
          .gte('business_date', range.from)
          .lte('business_date', range.to)
          .order('started_at', { ascending: false }),
      ),
  })
  return { chorei, patrols, isLoading: chorei.isLoading || patrols.isLoading, error: chorei.error ?? patrols.error }
}

/** Everyone with an account; `name(id)` prefers the full name used for reports. */
export function usePeople() {
  const q = useQuery({
    queryKey: ['admin', 'people'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => unwrap<Person[]>(await supabase.from('profiles').select('id, display_name, full_name, status')),
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
