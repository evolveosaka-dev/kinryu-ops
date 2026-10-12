// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

let t: TestDb
let store: string
let manager: string
let staff: string
let patroller: string
let tester: string

const TODAY = `(now() at time zone 'Asia/Tokyo')::date`

const events = () =>
  t.admin<{ kind: string; urgent: boolean; ref_table: string; data: Record<string, unknown>; dedupe_key: string | null }>(
    'select kind, urgent, ref_table, data, dedupe_key from public.notify_events order by id',
  )
const clear = () => t.admin('delete from public.notify_events')

const patrol = (scores: string, status = 'valid') => `
  insert into public.patrol_checks (store_id, business_date, shift, patrol_type, started_at, ended_at,
    score_smile, score_voice, score_grooming, score_clean, score_quality, good_points, improvements, status)
  values ($1, ${TODAY}, 'middle', 'after_shift', now() - interval '10 minutes', now() - interval '2 minutes',
    ${scores}, null, '笑顔', 'スープ', '${status}') returning id`

beforeAll(async () => {
  t = await createTestDb()
  store = (await t.admin<{ id: string }>(`select id from public.stores where code = 'midosuji'`))[0]!.id
  await t.admin(`insert into public.bootstrap_accounts (email, role) values ('boss@example.com', 'manager')`)
  manager = await t.createUser('boss@example.com')
  staff = await t.createUser('staff@example.com')
  patroller = await t.createUser('patrol@example.com')
  tester = await t.createUser('tester@example.com')
  await t.admin(`update public.profiles set status = 'active', full_name = '名前 テスト' where id = any($1)`, [[staff, patroller, tester]])
  await t.admin(`update public.profiles set can_patrol = true where id = any($1)`, [[patroller, tester]])
  await t.admin(`update public.profiles set is_test_account = true where id = $1`, [tester])
  await clear()
}, 60_000)

describe('notification events', () => {
  it('a 朝礼 and a note each add one event', async () => {
    const [rec] = await t.as<{ id: string }>(staff, `insert into public.chorei_records (store_id, business_date, shift, stock_none) values ($1, ${TODAY}, 'early', true) returning id`, [store])
    await t.as(patroller, 'select public.add_chorei_note($1, $2)', [rec!.id, '追記'])
    expect((await events()).map((e) => e.kind)).toEqual(['chorei', 'chorei_note'])
    await clear()
  })
  it('a 巡回 notifies when finalised, not as a draft; 即日指導 is urgent', async () => {
    const [draft] = await t.as<{ id: string }>(patroller, `insert into public.patrol_checks (store_id, business_date, shift, patrol_type, started_at, status)
      values ($1, ${TODAY}, 'early', 'before_shift', now() - interval '5 minutes', 'draft') returning id`, [store])
    expect(await events()).toHaveLength(0)
    await t.as(patroller, `update public.patrol_checks set ended_at = now(), score_smile = 2, score_voice = 2, score_grooming = 2, score_clean = 2,
      good_points = 'a', improvements = 'b', status = 'valid' where id = $1`, [draft!.id])
    await t.as(patroller, patrol('5, 5, 5, 5'), [store])
    expect((await events()).map((e) => [e.kind, e.urgent])).toEqual([['patrol', true], ['patrol', false]])
    await clear()
  })
  it("a manager's void or time fix is an edit event; a patroller's own draft edit is not", async () => {
    const [p] = await t.admin<{ id: string }>(`select id from public.patrol_checks where status = 'valid' order by created_at limit 1`)
    await t.as(manager, `update public.patrol_checks set status = 'void', void_reason = '重複' where id = $1`, [p!.id])
    const [e] = await events()
    expect(e).toMatchObject({ kind: 'edit', ref_table: 'patrol_checks', data: { action: 'void' } })
    await clear()
  })
  it('シフト希望: the staff member’s submission is deduplicated by key; a manager’s change is an edit', async () => {
    const [r] = await t.as<{ id: string }>(staff, `insert into public.shift_requests (month, shifts)
      values (date_trunc('month', ${TODAY} + 40)::date, '{early}') returning id`)
    await t.as(staff, `update public.shift_requests set shifts = '{early,middle}' where id = $1`, [r!.id])
    await t.as(manager, `update public.shift_requests set shifts = '{middle}' where id = $1`, [r!.id])
    const list = await events()
    expect(list.map((e) => [e.kind, e.data.first ?? e.data.action])).toEqual([['shift_request', true], ['shift_request', false], ['edit', 'update']])
    expect(list[0]!.dedupe_key).toBe(`shift_request:${r!.id}`)
    await clear()
  })
  it('a sign-up and a re-application are urgent; example.com test logins are not', async () => {
    const id = await t.createUser('newcomer@gmail.com')
    await t.createUser('someone@example.com')
    await t.as(manager, `update public.profiles set status = 'rejected' where id = $1`, [id])
    await t.as(id, `update public.profiles set status = 'pending' where id = auth.uid()`)
    expect((await events()).map((e) => [e.kind, e.urgent, e.data.reapply])).toEqual([['signup', true, false], ['signup', true, true]])
    await clear()
  })
  it('test accounts never notify', async () => {
    await t.as(tester, patrol('1, 1, 1, 1'), [store])
    expect(await events()).toHaveLength(0)
  })
})

describe('recipients', () => {
  it('only real managers manage recipients; staff see nothing', async () => {
    await t.as(manager, `insert into public.notify_recipients (email, name, mode) values ('boss@gmail.com', '社長', 'digest')`)
    await expect(t.as(manager, `insert into public.notify_recipients (email) values ('Bad Address')`)).rejects.toThrow(/check/)
    await expect(t.as(staff, `insert into public.notify_recipients (email) values ('x@gmail.com')`)).rejects.toThrow(/row-level security/)
    expect(await t.as(staff, 'select * from public.notify_recipients')).toHaveLength(0)
    expect(await t.as(staff, 'select * from public.notify_events')).toHaveLength(0)
    await t.admin(`update public.profiles set role = 'manager' where id = $1`, [tester])
    expect(await t.as(tester, 'select * from public.notify_recipients')).toHaveLength(1)
    await expect(t.as(tester, `delete from public.notify_recipients`)).rejects.toThrow(/read only/)
  })
})
