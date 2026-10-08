export const SHIFTS = ['early', 'middle', 'late'] as const
export type Shift = (typeof SHIFTS)[number]

export const LOCALES = ['ja', 'en', 'vi', 'si', 'ne'] as const
export type Locale = (typeof LOCALES)[number]

export type DayType = 'weekday' | 'weekend_holiday'
export type PatrolType = 'after_shift' | 'early'
export type Role = 'staff' | 'manager' | 'admin'
export type ProfileStatus = 'pending' | 'active' | 'inactive'
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
