// システム状態 (system_status() in SQL, migration 20261015000006): what counts as a problem.

/** Resend free plan: 100 mails a day; warn from 80. */
export const MAIL_DAY_LIMIT = 100
export const MAIL_WARN = 80

export interface CronJob {
  name: string
  schedule: string
  status: string | null
  at: string | null
  message: string | null
}

export interface SystemStatus {
  mails_today: number
  mails_by_kind: Record<string, number>
  notify_failed: { id: number; kind: string; at: string; error: string }[]
  notify_waiting: number
  uploads_failed: number
  uploads_pending: number
  jobs: CronJob[]
  sheets_synced_at: string | null
  ai_tokens_month: { calls: number; input: number; output: number }
}

export type Problem = 'mails' | 'notifyFailed' | 'notifyWaiting' | 'uploadsFailed' | 'uploadsPending' | 'jobs' | 'sheets'

/** Sheets are synced every morning at 7:30: older than 26 hours means the job did not run. */
const SHEETS_MAX_AGE_H = 26

export function systemProblems(s: SystemStatus, now: Date): Problem[] {
  const out: Problem[] = []
  if (s.mails_today >= MAIL_WARN) out.push('mails')
  if (s.notify_failed.length) out.push('notifyFailed')
  if (s.notify_waiting > 0) out.push('notifyWaiting')
  if (s.uploads_failed > 0) out.push('uploadsFailed')
  if (s.uploads_pending > 0) out.push('uploadsPending')
  if (s.jobs.some((j) => j.status === 'failed')) out.push('jobs')
  if (s.sheets_synced_at && now.getTime() - Date.parse(s.sheets_synced_at) > SHEETS_MAX_AGE_H * 3600_000) out.push('sheets')
  return out
}
