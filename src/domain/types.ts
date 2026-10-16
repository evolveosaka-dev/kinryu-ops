export const SHIFTS = ['early', 'middle', 'late'] as const
export type Shift = (typeof SHIFTS)[number]

export const LOCALES = ['ja', 'en', 'vi', 'si', 'ne', 'my'] as const
export type Locale = (typeof LOCALES)[number]

export type DayType = 'weekday' | 'weekend_holiday'
export const PATROL_TYPES = ['before_shift', 'in_shift', 'after_shift', 'random'] as const
export type PatrolType = (typeof PATROL_TYPES)[number]
export type Role = 'staff' | 'manager' | 'admin'
export type ProfileStatus = 'pending' | 'active' | 'inactive' | 'rejected'
export type RecordStatus = 'valid' | 'void'

export const CHOREI_STEPS = ['greeting', 'philosophy', 'phrases', 'handover', 'grooming', 'closing'] as const
export type ChoreiStep = (typeof CHOREI_STEPS)[number]
export type StepsDone = Record<ChoreiStep, boolean>

export const ALL_STEPS_DONE: StepsDone = {
  greeting: true,
  philosophy: true,
  phrases: true,
  handover: true,
  grooming: true,
  closing: true,
}

/** 朝礼できなかった: why a 朝礼 was not held (chorei_misses.reason). Keep in sync with the SQL check. */
export const MISS_REASONS = ['busy', 'no_manager', 'alone', 'forgot', 'other'] as const
export type MissReason = (typeof MISS_REASONS)[number]
export const MISS_ICON: Record<MissReason, string> = { busy: '🔥', no_manager: '👥', alone: '🧍', forgot: '❓', other: '✏️' }
