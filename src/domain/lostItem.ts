// 忘れ物・落とし物 (migration 20261016000004). Keep in sync with the SQL checks and send-notifications.

export const LOST_OWNERS = ['customer', 'staff', 'unknown'] as const
export type LostOwner = (typeof LOST_OWNERS)[number]
export const LOST_OWNER_ICON: Record<LostOwner, string> = { customer: '👤', staff: '🧑‍🍳', unknown: '❓' }

export type LostStatus = 'stored' | 'awaiting' | 'returned' | 'police' | 'disposed'
export type LostApproval = 'pending' | 'approved' | 'rejected'
export const LOST_STATUS_ICON: Record<LostStatus, string> = { stored: '📦', awaiting: '⏳', returned: '🤝', police: '🚓', disposed: '🗑️' }
/** 本人確認 at the return */
export const ID_METHODS = ['id_card', 'name_features', 'phone', 'other'] as const
export type IdMethod = (typeof ID_METHODS)[number]

/** After this many days in the store, the list suggests taking the item to the police. */
export const LOST_KEEP_DAYS = 7

export interface LostItem {
  id: string
  store_id: string
  business_date: string
  shift: 'early' | 'middle' | 'late'
  found_at: string
  found_place: string | null
  description: string
  storage_place: string | null
  owner_type: LostOwner
  owner_name: string | null
  owner_phone: string | null
  original_texts: Record<string, string> | null
  reporter_name: string
  status: LostStatus
  approval: LostApproval | null
  keep_until: string | null
  contact_note: string | null
  pickup_at: string | null
  id_method: IdMethod | null
  id_checked: boolean
  outcome_at: string | null
  outcome_to_name: string | null
  outcome_to_phone: string | null
  outcome_note: string | null
  consent_face: boolean
  consent_marketing: boolean
  police_station: string | null
  police_number: string | null
  outcome_by_name: string | null
  decided_by_name: string | null
  decided_at: string | null
  created_at: string
}

export interface LostComment {
  id: string
  lost_item_id: string
  author_name: string
  action: 'approve' | 'reject' | 'dispose' | 'found' | 'await' | 'returned' | 'police' | null
  body: string | null
  original_body: string | null
  created_at: string
}

export type LostFilter = 'stored' | 'pending' | 'done' | 'marketing' | 'all'

/** Which list tab a row belongs to (承認待ち also covers 差し戻し, which staff must record again). */
export function lostStage(i: Pick<LostItem, 'status' | 'approval'>): 'stored' | 'pending' | 'rejected' | 'done' {
  if (i.status === 'stored' || i.status === 'awaiting') return 'stored'
  if (i.approval === 'pending') return 'pending'
  if (i.approval === 'rejected') return 'rejected'
  return 'done'
}

export function matchesLostFilter(i: Pick<LostItem, 'status' | 'approval' | 'consent_marketing'>, f: LostFilter): boolean {
  const s = lostStage(i)
  if (f === 'stored') return s === 'stored' || s === 'rejected'
  if (f === 'pending') return s === 'pending'
  if (f === 'done') return s === 'done'
  if (f === 'marketing') return i.consent_marketing
  return true
}

/** 保管期限 passed (still kept or waiting) */
export const pastKeep = (i: Pick<LostItem, 'status' | 'keep_until'>, now = new Date()) =>
  (i.status === 'stored' || i.status === 'awaiting') && Boolean(i.keep_until && new Date(i.keep_until) < now)
/** Whole days an item has been kept (found → now). */
export const keptDays = (foundAt: string, now = new Date()) => Math.floor((now.getTime() - new Date(foundAt).getTime()) / 86_400_000)
