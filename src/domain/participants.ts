import { MEETING_TIME } from './time'
import type { Shift } from './types'

// 朝礼 参加者 vs the shift table (出勤予定): who should be at the meeting and is not listed, and who is
// listed but not scheduled. Shown for confirmation before a 朝礼 record is saved.

export interface Scheduled {
  roster_name: string
  /** minutes from 00:00 of the business date (遅番 23–7 → 1380–1860) */
  start_min: number
  end_min: number
}

export interface ScheduleCheck {
  /** working at the meeting time */
  atMeeting: (Scheduled & { present: boolean; leader: boolean })[]
  /** start later in the shift (not expected at the meeting) */
  later: Scheduled[]
  /** expected at the meeting but not a participant / the leader */
  missing: string[]
  /** participants who are not in the shift table for this shift */
  extra: string[]
}

const meetingMin = (shift: Shift) => {
  const [h, m] = MEETING_TIME[shift].split(':').map(Number)
  return h! * 60 + m!
}

/** null when there is no shift table for the slot or everything matches. */
export function checkParticipants(shift: Shift, participants: string[], leaderNames: (string | null | undefined)[], schedule: Scheduled[]): ScheduleCheck | null {
  if (schedule.length === 0) return null
  const meeting = meetingMin(shift)
  const leader = new Set(leaderNames.filter((n): n is string => Boolean(n)))
  const listed = new Set(participants.filter(Boolean))
  const scheduled = new Set(schedule.map((s) => s.roster_name))
  const atMeeting = schedule
    .filter((s) => s.start_min <= meeting && s.end_min > meeting)
    .map((s) => ({ ...s, present: listed.has(s.roster_name) || leader.has(s.roster_name), leader: leader.has(s.roster_name) }))
  const later = schedule.filter((s) => !atMeeting.some((a) => a.roster_name === s.roster_name))
  const missing = atMeeting.filter((s) => !s.present).map((s) => s.roster_name)
  const extra = [...listed].filter((n) => !scheduled.has(n) && !leader.has(n))
  return missing.length || extra.length ? { atMeeting, later, missing, extra } : null
}
