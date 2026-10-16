// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// Migration 20261017000002: Workflow V2 stages 2 (忘れ物) and 3 (every other kind).

let t: TestDb
let store: string
let manager: string
let staff: string

const report = async (kind: string) => {
  const [r] = await t.as<{ id: string }>(staff, `select public.report_incident($1, current_date, 'early', now(), $2, '内容') as id`, [store, kind])
  return r!.id
}
const state = async (id: string) => (await t.admin<{ wf_state: string; status: string; version: number; priority: string }>('select wf_state, status, version, priority from public.incidents where id = $1', [id]))[0]!
const act = (who: string, id: string, action: string, version: number | null, body: string | null = null, data: object = {}) =>
  t.as<{ v: number }>(who, `select public.incident_act($1, $2, $3, $4, null, null, $5) as v`, [id, action, version, body, JSON.stringify(data)])

beforeAll(async () => {
  t = await createTestDb()
  store = (await t.admin<{ id: string }>(`select id from public.stores where code = 'midosuji'`))[0]!.id
  await t.admin(`insert into public.bootstrap_accounts (email, role) values ('boss@example.com', 'manager')`)
  manager = await t.createUser('boss@example.com')
  staff = await t.createUser('staff@example.com', { display_name: 'スタッフ' })
  await t.admin(`update public.profiles set status = 'active' where id = $1`, [staff])
}, 60_000)

describe('stage 3: the steps of every kind', () => {
  it('ケガ・事故: urgent, staff take 安全確保・管理者報告, managers the rest, 完了 needs 再発防止', async () => {
    const id = await report('injury')
    expect(await state(id)).toMatchObject({ wf_state: 'occurred', status: 'open', priority: 'urgent' })
    let v = (await act(staff, id, 'advance', 1, '店の外に出てもらい、冷やした'))[0]!.v
    v = (await act(staff, id, 'advance', v))[0]!.v
    expect((await state(id)).wf_state).toBe('reported_mgr')
    await expect(act(staff, id, 'advance', v)).rejects.toThrow(/managers only/)
    v = (await act(manager, id, 'advance', v))[0]!.v
    v = (await act(manager, id, 'advance', v))[0]!.v
    await expect(act(manager, id, 'advance', v)).rejects.toThrow(/prevention/)
    v = (await act(manager, id, 'advance', v, null, { prevention: '床が濡れたらすぐ拭く' }))[0]!.v
    expect(await state(id)).toMatchObject({ wf_state: 'done', status: 'done' })
    // back with a reason, never forward
    await expect(act(manager, id, 'back', v, null, { to: 'investigating' })).rejects.toThrow(/reason required/)
    await act(manager, id, 'back', v, '原因が違った', { to: 'investigating' })
    expect((await state(id)).wf_state).toBe('investigating')
  })

  it('クレーム: 回答 needs the answer; 会計・券売機 is a new kind; 電話の伝言 is short; その他 can be cancelled', async () => {
    const c = await report('complaint')
    let v = (await act(manager, c, 'advance', 1))[0]!.v
    v = (await act(manager, c, 'advance', v))[0]!.v
    await expect(act(manager, c, 'advance', v)).rejects.toThrow(/answer/)
    await act(manager, c, 'advance', v, null, { resolution: '作り直してお詫びした' })
    expect((await state(c)).wf_state).toBe('answered')
    const p = await report('payment')
    expect((await state(p)).wf_state).toBe('reported')
    const m = await report('phone_message')
    v = (await act(manager, m, 'advance', 1))[0]!.v
    await act(manager, m, 'advance', v)
    expect((await state(m)).wf_state).toBe('done')
    const o = await report('other')
    await expect(act(staff, o, 'cancel', 1, '重複')).rejects.toThrow(/managers only/)
    await act(manager, o, 'cancel', 1, '重複')
    expect(await state(o)).toMatchObject({ wf_state: 'cancelled', status: 'done' })
    // the old direct status update no longer applies to workflow rows
    await expect(t.as(manager, `update public.incidents set status = 'done' where id = $1`, [p])).rejects.toThrow(/workflow actions/)
  })
})

describe('stage 2: 忘れ物', () => {
  it('found → 返却待ち → return needs 本人確認 → approval; history; keep-until reminder once', async () => {
    const [r] = await t.as<{ id: string }>(staff, `select public.report_lost_item($1, now() - interval '1 hour', '傘', null, null, 'customer', '山田') as id`, [store])
    const id = r!.id
    const [row] = await t.admin<{ keep_until: string; found_at: string }>('select keep_until, found_at from public.lost_items where id = $1', [id])
    expect(new Date(row!.keep_until).getTime() - new Date(row!.found_at).getTime()).toBe(7 * 86_400_000)
    await t.as(staff, `select public.lost_item_await($1, '電話がつながり、明日取りに来る', now() + interval '1 day')`, [id])
    expect(await t.admin('select status from public.lost_items where id = $1', [id])).toEqual([{ status: 'awaiting' }])
    const ret = (checked: boolean) =>
      t.as(staff, `select public.record_lost_item_outcome($1, 'returned', now(), '山田', null, null, false, false, null, null, null, 'name_features', $2)`, [id, checked])
    await expect(ret(false)).rejects.toThrow(/identity check/)
    await ret(true)
    expect(await t.admin('select status, approval, id_method, id_checked from public.lost_items where id = $1', [id])).toEqual([
      { status: 'returned', approval: 'pending', id_method: 'name_features', id_checked: true },
    ])
    expect((await t.admin<{ action: string }>('select action from public.lost_item_comments where lost_item_id = $1 order by created_at, id', [id])).map((x) => x.action)).toEqual([
      'found',
      'await',
      'returned',
    ])
    const [r2] = await t.as<{ id: string }>(staff, `select public.report_lost_item($1, now() - interval '1 hour', '財布', null, null, 'unknown') as id`, [store])
    await t.admin(`update public.lost_items set keep_until = now() - interval '1 hour' where id = $1`, [r2!.id])
    await t.admin('select public.check_lost_items_due()')
    await t.admin('select public.check_lost_items_due()')
    expect(await t.admin(`select count(*)::int as n from public.notify_events where ref_id = $1 and data ->> 'event' = 'overdue'`, [r2!.id])).toEqual([{ n: 1 }])
    // managers dispose of an item still waiting for its owner
    await t.as(staff, `select public.lost_item_await($1, 'x', null)`, [r2!.id])
    await t.as(manager, `select public.manage_lost_item($1, 'dispose', '期限切れ')`, [r2!.id])
    expect(await t.admin('select status from public.lost_items where id = $1', [r2!.id])).toEqual([{ status: 'disposed' }])
  })
})
