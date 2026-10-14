import { describe, expect, it } from 'vitest'
import { systemProblems, type SystemStatus } from './systemStatus'

const base: SystemStatus = {
  mails_today: 12,
  mails_by_kind: {},
  notify_failed: [],
  notify_waiting: 0,
  uploads_failed: 0,
  uploads_pending: 0,
  jobs: [{ name: 'notify-instant', schedule: '* * * * *', status: 'succeeded', at: '2026-10-15T05:00:00Z', message: null }],
  sheets_synced_at: '2026-10-14T22:30:00Z',
  ai_tokens_month: { calls: 3, input: 100, output: 50 },
}
const now = new Date('2026-10-15T06:00:00Z')

describe('systemProblems', () => {
  it('nothing wrong', () => {
    expect(systemProblems(base, now)).toEqual([])
  })
  it('mails from 80, failures, stuck items, failed jobs, old sync', () => {
    const s: SystemStatus = {
      ...base,
      mails_today: 80,
      notify_failed: [{ id: 1, kind: 'sales', at: '', error: 'Resend 429' }],
      notify_waiting: 2,
      uploads_failed: 1,
      uploads_pending: 1,
      jobs: [{ ...base.jobs[0]!, status: 'failed' }],
      sheets_synced_at: '2026-10-13T22:30:00Z',
    }
    expect(systemProblems(s, now)).toEqual(['mails', 'notifyFailed', 'notifyWaiting', 'uploadsFailed', 'uploadsPending', 'jobs', 'sheets'])
  })
})
