import { describe, expect, it } from 'vitest'
import { actionsFor, durations, fmtMinutes, isOverdue, recurrences, wfMetrics, type IncidentEvent, type WfRow } from './incidentWorkflow'

const ev = (id: number, at: string, from: string | null, to: string | null, kind: IncidentEvent['kind'] = 'state'): IncidentEvent => ({
  id,
  incident_id: 'i',
  at: `2026-10-17T${at}:00+09:00`,
  actor_name: 'x',
  kind,
  action: null,
  from_state: from as IncidentEvent['from_state'],
  to_state: to as IncidentEvent['to_state'],
  body: null,
  original_body: null,
  data: {},
})
const T = (hm: string) => `2026-10-17T${hm}:00+09:00`

describe('Workflow V2', () => {
  it('buttons follow the transition table and the role', () => {
    expect(actionsFor('reported', false)).toEqual([])
    expect(actionsFor('in_progress', false)).toEqual(['repaired'])
    expect(actionsFor('repaired', true)).toEqual(['confirm_ok', 'confirm_ng'])
    expect(actionsFor('done', true)).toEqual(['reopen'])
    expect(actionsFor('reported', true)).toEqual(['acknowledge', 'start', 'cancel'])
  })

  it('durations from the history: hold, a failed check (再対応), confirmation', () => {
    const times = { occurred_at: T('09:00'), occurred_known: true, discovered_at: T('09:30'), created_at: T('09:40'), acknowledged_at: T('10:00'), repaired_at: T('15:00'), closed_at: T('16:00') }
    const events = [
      ev(1, '09:40', null, 'reported', 'created'),
      ev(2, '10:00', 'reported', 'checking', 'assign'),
      ev(3, '10:10', 'checking', 'in_progress'),
      ev(4, '11:00', 'in_progress', 'on_hold'),
      ev(5, '13:00', 'on_hold', 'in_progress'),
      ev(6, '14:00', 'in_progress', 'repaired'),
      ev(7, '14:30', 'repaired', 'reopened'),
      ev(8, '15:00', 'reopened', 'repaired'),
      ev(9, '16:00', 'repaired', 'done'),
    ]
    const d = durations(times, events, T('18:00'))
    expect(d).toMatchObject({ report: 10, firstResponse: 20, repair: 360, complete: 420, hold: 120, downtime: 300 + 30, estimated: false })
    // 発生 unknown → 発見 is the start, marked as estimated
    expect(durations({ ...times, occurred_known: false }, events, T('18:00'))).toMatchObject({ repair: 330, estimated: true })
    // still on hold → counted until now
    expect(durations(times, events.slice(0, 4), T('12:00')).hold).toBe(60)
  })

  it('overdue, recurrences and the dashboard figures', () => {
    const base = { store_id: 's', occurred_at: T('09:00'), occurred_known: true, discovered_at: null, acknowledged_at: null, repaired_at: null, closed_at: null, priority: 'normal' as const, equipment_name: null }
    const rows: WfRow[] = [
      { ...base, id: 'a', created_at: '2026-08-01T00:00:00Z', wf_state: 'done', due_at: null, equipment_id: 'e1', acknowledged_at: '2026-08-01T01:00:00Z', repaired_at: '2026-08-01T05:00:00Z' },
      { ...base, id: 'b', created_at: '2026-10-01T00:00:00Z', wf_state: 'in_progress', due_at: '2026-10-02T00:00:00Z', equipment_id: 'e1', acknowledged_at: '2026-10-01T00:30:00Z' },
      { ...base, id: 'c', created_at: '2026-10-01T00:00:00Z', wf_state: 'cancelled', due_at: '2026-10-02T00:00:00Z', equipment_id: 'e1' },
    ]
    expect(isOverdue(rows[1]!, new Date('2026-10-05'))).toBe(true)
    expect(recurrences(rows).map((r) => r.id)).toEqual(['b'])
    const m = wfMetrics(rows, new Date('2026-10-05'))
    expect([m.total.length, m.open.length, m.overdue.length]).toEqual([2, 1, 1])
    expect(m.firstResponse.avg).toBe(45)
    expect(fmtMinutes(45)).toBe('45分')
    expect(fmtMinutes(125)).toBe('2時間5分')
    expect(fmtMinutes(60 * 50)).toBe('2日2時間')
  })
})
