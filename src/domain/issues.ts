// 改善点の対象 (who × which kind) and the 面談指導 rules. Keep in sync with
// public.staff_issue_status() / notify_staff_issues() (migration 20261012000007) and supabase/functions/staff-ai.

/** 一時停止中 (2026-10-13): 改善点の対象・スタッフ別・面談指導の通知・AI候補. true で再開（DB の trigger patrol_staff_issues も enable する）. */
export const STAFF_ISSUES_ENABLED = false

export const ISSUE_CATEGORIES = ['smile', 'voice', 'grooming', 'clean', 'quality', 'other'] as const
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number]

export interface IssueTag {
  staff: string
  category: IssueCategory
}

/** 3 times in 30 days before any 面談; 3 times since the last 面談 after that. */
export const ISSUE_THRESHOLD = 3
export const ISSUE_WINDOW_DAYS = 30

export type IssueLevel = 'interview' | 'escalate'

export interface IssueStatus {
  staff: string
  category: IssueCategory
  interviews: number
  last_interview: string | null
  occurrences: number
  last_seen: string | null
  level: IssueLevel | null
}

/**
 * Fixed steps after a 面談 did not help (step n = the n-th recurrence after 面談).
 * The company's rule; AI writes a concrete proposal on top of it.
 */
export const ESCALATION_STEPS = [
  '再面談：改善目標を本人と一緒に決め、2週間後にもう一度確認する',
  '配置・シフトの見直しと、再研修（OJT）を検討する',
  '本部（責任者）との面談で、今後の対応を検討する',
] as const

export function escalationStep(interviews: number): string {
  return ESCALATION_STEPS[Math.min(Math.max(interviews, 1), ESCALATION_STEPS.length) - 1] ?? ''
}

export function hasTag(tags: IssueTag[], t: IssueTag): boolean {
  return tags.some((x) => x.staff === t.staff && x.category === t.category)
}

export function toggleTag(tags: IssueTag[], t: IssueTag): IssueTag[] {
  return hasTag(tags, t) ? tags.filter((x) => !(x.staff === t.staff && x.category === t.category)) : [...tags, t]
}

/** Only tags for people still on the list (the patroller may change 勤務者 after tagging). */
export function keepStaff(tags: IssueTag[], staff: string[]): IssueTag[] {
  return tags.filter((t) => staff.includes(t.staff))
}

/** Tags grouped per person (first-seen order), kinds in the usual order. */
export function tagsByStaff(tags: IssueTag[]): [string, IssueCategory[]][] {
  const map = new Map<string, IssueCategory[]>()
  for (const t of tags) map.set(t.staff, [...(map.get(t.staff) ?? []), t.category])
  return [...map.entries()].map(([s, cats]) => [s, ISSUE_CATEGORIES.filter((c) => cats.includes(c))])
}

/** issue_tags to save: [] = 全体・特定の人ではない, null = not answered */
export function issueTagsToSave(none: boolean | undefined, tags: IssueTag[] | undefined, staff: string[]): IssueTag[] | null {
  if (none) return []
  const kept = keepStaff(tags ?? [], staff)
  return kept.length ? kept : null
}
