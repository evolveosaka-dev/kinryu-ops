import type { Locale, PatrolType, ProfileStatus, RecordStatus, Role, Shift, StepsDone } from '../domain/types'
import type { Judgement } from '../domain/patrol'

export interface Store {
  id: string
  code: string
  name_ja: string
  name_en: string
  sort_order: number
  active: boolean
}

export interface Profile {
  id: string
  display_name: string
  /** 氏名 — used for weekly / monthly aggregation */
  full_name: string | null
  email: string | null
  role: Role
  can_patrol: boolean
  status: ProfileStatus
  privacy_accepted_at: string | null
  home_store_id: string | null
  locale: Locale
  created_at: string
}

export interface StaffEntry {
  id: string
  display_name: string
  full_name: string | null
  home_store_id: string | null
  can_patrol: boolean
}

export interface RosterEntry {
  id: string
  name: string
  home_store_id: string | null
  active: boolean
}

export interface TargetBowls {
  store_id: string
  month: string
  shift: Shift
  day_type: 'weekday' | 'weekend_holiday'
  bowls: number
}

export interface AttachmentSummary {
  id: string
  kind: 'image' | 'video'
  status: 'pending' | 'uploaded' | 'failed' | 'deleted'
  drive_url: string | null
}

export interface ChoreiRecord {
  id: string
  store_id: string
  business_date: string
  shift: Shift
  leader_id: string
  participants: string[]
  participants_extra: string[]
  stock_none: boolean
  stock_text: string | null
  target_bowls: number | null
  caution_text: string | null
  steps_done: StepsDone
  skip_reason: string | null
  submitted_at: string
  status: RecordStatus
  void_reason: string | null
  original_texts: Record<string, string> | null
  source_lang: string | null
  attachments?: AttachmentSummary[]
}

export interface HandoverSummary {
  id: string
  business_date: string
  shift: Shift
  leader: string
  stock_none: boolean
  stock_text: string | null
  target_bowls: number | null
  caution_text: string | null
  submitted_at: string
  notes: { body: string; author: string }[]
}

export interface ChoreiSlot {
  existing: { id: string; leader: string; submitted_at: string } | null
  previous: HandoverSummary | null
}

export interface PatrolCheck {
  id: string
  patroller_id: string
  store_id: string
  business_date: string
  shift: Shift
  patrol_type: PatrolType
  started_at: string
  ended_at: string | null
  score_smile: number | null
  score_voice: number | null
  score_grooming: number | null
  score_clean: number | null
  score_quality: number | null
  total: number | null
  max_total: number | null
  judgement: Judgement | null
  duration_min: number | null
  needs_time_review: boolean
  staff_on_shift: string
  staff_names: string[]
  good_points: string | null
  improvements: string | null
  remarks: string | null
  submitted_at: string | null
  status: 'draft' | 'valid' | 'void'
  original_texts: Record<string, string> | null
  source_lang: string | null
  attachments?: AttachmentSummary[]
}
