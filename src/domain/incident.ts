// クレーム・事故の記録 (migration 20261015000007). Keep the kinds in sync with the SQL check and
// send-notifications INCIDENT_KIND.

export const INCIDENT_KINDS = ['complaint', 'injury', 'foreign_object', 'equipment', 'food_poisoning', 'lost_item', 'other'] as const
export type IncidentKind = (typeof INCIDENT_KINDS)[number]

export const INCIDENT_ICON: Record<IncidentKind, string> = {
  complaint: '😠',
  injury: '🩹',
  foreign_object: '🪳',
  equipment: '🔧',
  food_poisoning: '🤢',
  lost_item: '👜',
  other: '✏️',
}

/** Mailed to every manager at once. */
export const URGENT_INCIDENTS: readonly IncidentKind[] = ['injury', 'foreign_object', 'food_poisoning']

export const INCIDENT_STATUSES = ['open', 'in_progress', 'done'] as const
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number]

export const INCIDENT_STATUS_STYLE: Record<IncidentStatus, string> = {
  open: 'bg-red-100 text-red-900',
  in_progress: 'bg-amber-100 text-amber-900',
  done: 'bg-green-100 text-green-900',
}

export interface Incident {
  id: string
  kind: IncidentKind
  store_id: string
  business_date: string
  shift: 'early' | 'middle' | 'late'
  occurred_at: string
  description: string
  action_taken: string | null
  original_texts: Record<string, string> | null
  reporter_id: string | null
  reporter_name: string
  status: IncidentStatus
  owner_id: string | null
  owner_name: string | null
  resolution: string | null
  prevention: string | null
  resolved_at: string | null
  created_at: string
}
