import type { Locale, MissReason, PatrolType, ProfileStatus, RecordStatus, Role, Shift, StepsDone } from '../domain/types'
import type { IssueTag } from '../domain/issues'
import type { Judgement } from '../domain/patrol'

export interface Store {
  id: string
  code: string
  name_ja: string
  name_en: string
  sort_order: number
  active: boolean
  /** 在庫・仕入: number of fridges for 冷蔵庫温度 */
  fridge_count?: number
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
  /** name used in the shift workbook (e.g. バンダラ); set by managers */
  roster_name: string | null
  /** test account: everything it records is deleted every night (4:00 JST) */
  is_test_account?: boolean
  /** テスト管理者: a test account whose records are kept (not purged at 4:00); only admins set it */
  keep_test_data?: boolean
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
  /** 平日 / 土日祝 before 2026-10, the six types of src/domain/targets.ts after */
  day_type: string
  bowls: number
}

export interface AttachmentSummary {
  id: string
  kind: 'image' | 'video'
  status: 'pending' | 'uploaded' | 'failed' | 'deleted' | 'lost'
  drive_url: string | null
  owner_id?: string
  created_at?: string
}

export interface ChoreiRecord {
  id: string
  /** 「接客中のため、写真・動画の撮影を控えました」 (sent without files) */
  media_skipped?: boolean
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
  is_test: boolean
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

/** 朝礼できなかった report of a slot (kind 'done' = a manager confirmed it was held). */
export interface ChoreiMiss {
  kind: 'missed' | 'done'
  reason: MissReason | null
  note: string | null
  reporter: string
  mine: boolean
  at: string
}

export interface ChoreiSlot {
  existing: { id: string; leader: string; submitted_at: string } | null
  previous: HandoverSummary | null
  miss: ChoreiMiss | null
}

export interface PatrolCheck {
  id: string
  /** 「接客中のため、写真・動画の撮影を控えました」 (sent without files) */
  media_skipped?: boolean
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
  mask_worn: boolean
  good_points: string | null
  improvements: string | null
  remarks: string | null
  /** ⑥ お客様の満足度 (not scored); null = not asked (before 2026-10-12) */
  customer_none: boolean
  customer_satisfied: boolean | null
  customer_reason: string | null
  /** 改善点の対象: [] = 全体, null = sent before 2026-10-13 */
  issue_tags: IssueTag[] | null
  submitted_at: string | null
  status: 'draft' | 'valid' | 'void'
  original_texts: Record<string, string> | null
  source_lang: string | null
  is_test: boolean
  attachments?: AttachmentSummary[]
}
