// クレーム・事故の記録 (migration 20261015000007). Keep the kinds in sync with the SQL check and
// send-notifications INCIDENT_KIND.

export const INCIDENT_KINDS = ['complaint', 'injury', 'foreign_object', 'equipment', 'food_poisoning', 'lost_item', 'phone_message', 'other'] as const
export type IncidentKind = (typeof INCIDENT_KINDS)[number]

export const INCIDENT_ICON: Record<IncidentKind, string> = {
  complaint: '😠',
  injury: '🩹',
  foreign_object: '🪳',
  equipment: '🔧',
  food_poisoning: '🤢',
  lost_item: '👜',
  phone_message: '☎️',
  other: '✏️',
}

/** Kinds that ask for the customer's name and phone (ケガ・事故 only when a customer was hurt). */
export const CUSTOMER_KINDS: readonly IncidentKind[] = ['complaint', 'foreign_object', 'food_poisoning', 'other']

/** 電話の伝言: who called. */
export const CALLER_TYPES = ['vendor', 'kinryu', 'customer'] as const
export type CallerType = (typeof CALLER_TYPES)[number]

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
  customer_name: string | null
  customer_phone: string | null
  contact_method: ContactMethod | null
  ai_suggestion: AiSuggestion | null
  action_source: 'ai' | 'own' | null
  injured_who: ('staff' | 'customer')[] | null
  injured_staff: string | null
  caller_type: CallerType | null
}

/** 管理者への連絡 (migration 20261016000002). */
export const CONTACT_METHODS = ['phone', 'line', 'none'] as const
export type ContactMethod = (typeof CONTACT_METHODS)[number]
export const CONTACT_ICON: Record<ContactMethod, string> = { phone: '📞', line: '💬', none: '🙅' }

export interface EmergencyContact {
  id: string
  name: string
  phone: string | null
  line_ok: boolean
  note: string | null
  sort_order: number
  active: boolean
}

export type ContactResult = 'reached' | 'no_answer' | 'sent' | 'not_sent'
export interface ContactLog {
  id: string
  contact_name: string
  method: 'phone' | 'line'
  user_name: string
  at: string
  result: ContactResult | null
  incident_id: string | null
}

/** その場でしたこと proposed by incident-ai from managers' earlier handling. */
export interface AiSuggestion {
  ja: string
  local: string
  lang: string
  basedOn: { id: string; kind: IncidentKind; date: string }[]
  cases: number
}

/** The text sent with LINE: kind, store, time, what happened (Japanese labels, the manager reads it). */
export function lineMessage(p: { kind: string; store: string; when: string; description: string; customer?: string }): string {
  return [`【クレーム・事故】${p.kind}`, `${p.store} ${p.when}`, p.description.trim(), p.customer ? `お客様: ${p.customer}` : '']
    .filter(Boolean)
    .join('\n')
}
