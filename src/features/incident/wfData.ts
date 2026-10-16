import { useQuery } from '@tanstack/react-query'
import type { Incident } from '../../domain/incident'
import type { EquipmentCategory, IncidentEvent, Priority, WfAction, WfState } from '../../domain/incidentWorkflow'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import type { AttachmentSummary } from '../../lib/types'

export interface Equipment {
  id: string
  store_id: string
  name: string
  code: string | null
  category: EquipmentCategory
  note: string | null
  active: boolean
}

/** 設備の一覧 (active ones for the report form; all for 設定). */
export function useEquipment(all = false) {
  return useQuery({
    queryKey: ['equipment_registry', all],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      let q = supabase.from('equipment_registry').select('*').order('category').order('name')
      if (!all) q = q.eq('active', true)
      return unwrap<Equipment[]>(await q)
    },
  })
}

export type WfIncident = Incident & {
  incident_no: number
  wf_state: WfState
  priority: Priority
  assignee_id: string | null
  assignee_name: string | null
  due_at: string | null
  discovered_at: string | null
  occurred_known: boolean
  acknowledged_at: string | null
  repaired_at: string | null
  closed_at: string | null
  closed_by_name: string | null
  equipment_id: string | null
  equipment_name: string | null
  cause: string | null
  cancel_reason: string | null
  version: number
  attachments: AttachmentSummary[]
}

/** Workflow incidents (stage 1 = 設備の故障): staff see those of both stores (RLS), managers all. */
export function useWfIncidents() {
  return useQuery({
    queryKey: ['incidents', 'wf'],
    refetchInterval: 60_000,
    queryFn: async () =>
      unwrap<WfIncident[]>(
        await supabase
          .from('incidents')
          .select('*, attachments(id, kind, status, drive_url, owner_id, created_at)')
          .not('wf_state', 'is', null)
          .order('created_at', { ascending: false })
          .limit(300),
      ),
  })
}

export function useIncidentEvents(id: string | null) {
  return useQuery({
    queryKey: ['incident_events', id],
    enabled: Boolean(id),
    refetchInterval: 60_000,
    queryFn: async () => unwrap<IncidentEvent[]>(await supabase.from('incident_events').select('*').eq('incident_id', id!).order('id')),
  })
}

export interface IncidentCost {
  id: string
  amount_yen: number
  vendor: string | null
  note: string | null
  created_at: string
}

export function useIncidentCosts(id: string | null, manager: boolean) {
  return useQuery({
    queryKey: ['incident_costs', id],
    enabled: Boolean(id) && manager,
    queryFn: async () => unwrap<IncidentCost[]>(await supabase.from('incident_costs').select('*').eq('incident_id', id!).order('created_at')),
  })
}

/** One workflow action (the database checks the role, the transition and the version). Returns the new version. */
export async function incidentAct(
  id: string,
  action: WfAction | 'comment' | 'assign',
  version: number | null,
  body: string | null,
  extra: { original?: string | null; sourceLang?: string | null; data?: Record<string, unknown> } = {},
) {
  return unwrap<number>(
    await supabase.rpc('incident_act', {
      p_id: id,
      p_action: action,
      p_version: version,
      p_body: body,
      p_original: extra.original ?? null,
      p_source_lang: extra.sourceLang ?? null,
      p_data: extra.data ?? {},
    }),
  )
}

/** 設-0001 (受付番号) */
export const incidentNo = (n: number) => `設-${String(n).padStart(4, '0')}`
