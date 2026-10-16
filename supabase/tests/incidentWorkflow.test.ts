// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// Migration 20261017000001: クレーム・事故 Workflow V2, stage 1 (設備の故障). The checks follow the owner's spec §10.

let t: TestDb
let store: string
let manager: string
let staff: string
let other: string
let eq: string

const act = (who: string, id: string, action: string, version: number | null, body: string | null = null, data: object = {}) =>
  t.as<{ v: number }>(who, `select public.incident_act($1, $2, $3, $4, null, null, $5) as v`, [id, action, version, body, JSON.stringify(data)])
const row = (id: string) =>
  t.admin<Record<string, unknown>>(
    'select wf_state, status, version, acknowledged_at, repaired_at, closed_at, closed_by, assignee_id, priority, due_at, cause from public.incidents where id = $1',
    [id],
  )
const events = (id: string) => t.admin<{ kind: string; action: string; to_state: string | null }>('select kind, action, to_state from public.incident_events where incident_id = $1 order by id', [id])
const report = async (who: string, priority = 'normal') => {
  const [r] = await t.as<{ id: string }>(
    who,
    `select public.report_incident($1, current_date, 'early', now() - interval '2 hours', 'equipment', '製麺機が止まった', null, null, null, null, null, 'none',
                                   null, null, null, null, null, null, $2, null, $3, now() - interval '1 hour', false) as id`,
    [store, eq, priority],
  )
  return r!.id
}

beforeAll(async () => {
  t = await createTestDb()
  store = (await t.admin<{ id: string }>(`select id from public.stores where code = 'midosuji'`))[0]!.id
  await t.admin(`insert into public.bootstrap_accounts (email, role) values ('boss@example.com', 'manager')`)
  manager = await t.createUser('boss@example.com')
  staff = await t.createUser('staff@example.com', { display_name: 'スタッフ' })
  other = await t.createUser('other@example.com', { display_name: 'ほか' })
  await t.admin(`update public.profiles set status = 'active' where id = any($1)`, [[staff, other]])
  ;[{ id: eq }] = await t.as<{ id: string }>(manager, `insert into public.equipment_registry (store_id, name, code, category) values ($1, '製麺機', 'K-01', 'kitchen') returning id`, [store]).then((r) => r.map((x) => ({ id: x.id })))
}, 60_000)

describe('設備の故障 workflow', () => {
  it('1–3: staff report (報告済み, due date, created event, mail); managers take and assign; staff cannot close', async () => {
    await t.admin('delete from public.notify_events')
    const id = await report(staff)
    const [r] = await row(id)
    expect(r).toMatchObject({ wf_state: 'reported', status: 'open', priority: 'normal', version: 1 })
    expect(r!.due_at).not.toBeNull()
    expect(await events(id)).toEqual([{ kind: 'created', action: 'report', to_state: 'reported' }])
    expect((await t.admin<{ kind: string }>('select kind from public.notify_events where ref_id = $1', [id])).map((x) => x.kind)).toEqual(['incident'])
    // the equipment name comes from the registry; 発生 unknown is kept
    expect(await t.admin('select equipment_name, occurred_known from public.incidents where id = $1', [id])).toEqual([{ equipment_name: '製麺機', occurred_known: false }])

    await expect(act(staff, id, 'acknowledge', 1)).rejects.toThrow(/managers only/)
    await expect(act(staff, id, 'assign', 1, null, { assignee_id: other })).rejects.toThrow(/managers only/)
    const [{ v }] = (await act(manager, id, 'assign', 1, null, { assignee_id: other, priority: 'high' })) as [{ v: number }]
    expect(await row(id).then((x) => x[0])).toMatchObject({ wf_state: 'checking', assignee_id: other, priority: 'high' })
    expect((await row(id))[0]!.acknowledged_at).not.toBeNull()
    await act(manager, id, 'start', v)
    // staff may report the repair but never close
    await expect(act(staff, id, 'confirm_ok', v + 1, null, { works: true, cause: 'x' })).rejects.toThrow(/managers only/)
    // a direct update of the workflow columns is refused, even for managers
    await expect(t.as(manager, `update public.incidents set wf_state = 'done' where id = $1`, [id])).rejects.toThrow(/workflow actions/)
  })

  it('4, 6–8: comments, hold → resume, repaired is not done, NG → 再対応, confirm closes, reopen', async () => {
    const id = await report(staff)
    let v = 1
    await act(staff, id, 'comment', null, '電源を入れ直したが動かない')
    v = (await act(manager, id, 'start', v))[0]!.v
    await expect(act(manager, id, 'hold', v)).rejects.toThrow(/reason required/)
    v = (await act(manager, id, 'hold', v, '部品待ち（メーカー）'))[0]!.v
    v = (await act(manager, id, 'resume', v))[0]!.v
    v = (await act(staff, id, 'repaired', v, '交換した部品で動いた'))[0]!.v
    let [r] = await row(id)
    expect(r).toMatchObject({ wf_state: 'repaired', status: 'in_progress', closed_at: null })
    expect(r!.repaired_at).not.toBeNull()
    await expect(act(manager, id, 'confirm_ok', v, null, { works: false, cause: '部品の摩耗' })).rejects.toThrow(/confirm that it works/)
    v = (await act(manager, id, 'confirm_ng', v, 'まだ異音がする'))[0]!.v
    expect((await row(id))[0]).toMatchObject({ wf_state: 'reopened', closed_at: null })
    v = (await act(staff, id, 'repaired', v, '再調整'))[0]!.v
    v = (await act(manager, id, 'confirm_ok', v, null, { works: true, cause: 'ベルトの摩耗', resolution: 'ベルト交換' }))[0]!.v
    ;[r] = await row(id)
    expect(r).toMatchObject({ wf_state: 'done', status: 'done', closed_by: manager, cause: 'ベルトの摩耗' })
    expect(r!.closed_at).not.toBeNull()
    await act(manager, id, 'reopen', v, '翌日また止まった')
    expect((await row(id))[0]).toMatchObject({ wf_state: 'reopened', status: 'in_progress', closed_at: null })
    expect((await events(id)).map((e) => e.action)).toEqual(['report', 'comment', 'start', 'hold', 'resume', 'repaired', 'confirm_ng', 'repaired', 'confirm_ok', 'reopen'])
  })

  it('9: two people at once — the second write with an old version is refused', async () => {
    const id = await report(staff)
    await act(manager, id, 'acknowledge', 1)
    await expect(act(manager, id, 'start', 1)).rejects.toThrow(/conflict/)
  })

  it('10: staff see 設備の故障 of the stores and its history, not other kinds; the history cannot be changed', async () => {
    const id = await report(staff)
    const [c] = await t.as<{ id: string }>(staff, `select public.report_incident($1, current_date, 'early', now(), 'complaint', 'ぬるい') as id`, [store])
    const seen = (await t.as<{ id: string }>(other, 'select id from public.incidents')).map((r) => r.id)
    expect(seen).toContain(id)
    expect(seen).not.toContain(c!.id)
    expect((await t.as(other, 'select id from public.incident_events where incident_id = $1', [id])).length).toBeGreaterThan(0)
    await expect(t.as(manager, 'update public.incident_events set body = $2 where incident_id = $1', [id, 'x'])).rejects.toThrow()
    await expect(t.as(manager, 'delete from public.incident_events where incident_id = $1', [id])).rejects.toThrow()
    await expect(t.as(staff, `insert into public.incident_costs (incident_id, amount_yen) values ($1, 1000)`, [id])).rejects.toThrow()
    await t.as(manager, `insert into public.incident_costs (incident_id, amount_yen, vendor) values ($1, 12000, 'メーカー')`, [id])
    expect(await t.as(staff, 'select id from public.incident_costs')).toEqual([])
    // cancel: managers, with a reason, only before work starts
    await expect(act(manager, id, 'cancel', 1)).rejects.toThrow(/reason required/)
    await act(manager, id, 'cancel', 1, '重複した報告')
    expect((await row(id))[0]).toMatchObject({ wf_state: 'cancelled', status: 'done' })
  })

  it('11: overdue mails once per due date; old kinds keep the old status handling', async () => {
    const id = await report(staff, 'urgent')
    await t.admin(`select set_config('app.incident_act', 'on', false)`)
    await t.admin(`update public.incidents set due_at = now() - interval '1 hour' where id = $1`, [id])
    await t.admin(`select set_config('app.incident_act', '', false)`)
    await t.admin('select public.check_incident_due()')
    await t.admin('select public.check_incident_due()')
    expect(await t.admin(`select count(*)::int as n from public.notify_events where ref_id = $1 and data ->> 'event' = 'overdue'`, [id])).toEqual([{ n: 1 }])
    const [c] = await t.as<{ id: string }>(staff, `select public.report_incident($1, current_date, 'early', now(), 'complaint', 'ぬるい') as id`, [store])
    await t.as(manager, `update public.incidents set status = 'done', prevention = '温度確認' where id = $1`, [c!.id])
    expect(await t.admin('select wf_state, status from public.incidents where id = $1', [c!.id])).toEqual([{ wf_state: null, status: 'done' }])
  })
})
