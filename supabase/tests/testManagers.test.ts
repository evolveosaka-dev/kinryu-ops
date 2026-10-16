// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// Migration 20261017000003: テスト管理者 = manager + is_test_account + keep_test_data, given only by a システム管理者.

let t: TestDb
let store: string
let admin: string
let manager: string
let tm: string
let purged: string

beforeAll(async () => {
  t = await createTestDb()
  store = (await t.admin<{ id: string }>(`select id from public.stores where code = 'midosuji'`))[0]!.id
  await t.admin(`insert into public.bootstrap_accounts (email, role) values ('boss@example.com', 'manager')`)
  manager = await t.createUser('boss@example.com')
  admin = await t.createUser('admin@example.com', { display_name: 'アドミン' })
  tm = await t.createUser('tm@example.com', { display_name: 'テスト管理' })
  purged = await t.createUser('kt@example.com', { display_name: 'テスト用' })
  await t.admin(`update public.profiles set status = 'active', role = 'admin' where id = $1`, [admin])
  await t.admin(`update public.profiles set status = 'active', role = 'manager', is_test_account = true where id = $1`, [purged])
  await t.admin(`update public.profiles set status = 'active' where id = $1`, [tm])
}, 60_000)

describe('テスト管理者', () => {
  it('a manager cannot make a test manager or an admin; an admin can', async () => {
    await expect(t.as(manager, `update public.profiles set role = 'manager', is_test_account = true, keep_test_data = true where id = $1`, [tm])).rejects.toThrow(/system admin/)
    await expect(t.as(manager, `update public.profiles set role = 'admin' where id = $1`, [tm])).rejects.toThrow(/system admin/)
    await t.as(admin, `update public.profiles set role = 'manager', is_test_account = true, keep_test_data = true where id = $1`, [tm])
    expect(await t.admin(`select role, is_test_account, keep_test_data from public.profiles where id = $1`, [tm])).toEqual([
      { role: 'manager', is_test_account: true, keep_test_data: true },
    ])
  })

  it('real managers do not see test managers; admins and test accounts do', async () => {
    expect(await t.as(manager, `select id from public.profiles where id = $1`, [tm])).toHaveLength(0)
    expect(await t.as(admin, `select id from public.profiles where id = $1`, [tm])).toHaveLength(1)
    expect(await t.as(purged, `select id from public.profiles where id = $1`, [tm])).toHaveLength(1)
  })

  it('records of a test manager are hidden from real managers and survive the 4:00 purge; other test records do not', async () => {
    const lost = (who: string) =>
      t.as<{ id: string }>(who, `select public.report_lost_item($1, now(), '傘', null, null, 'unknown', null, null) as id`, [store])
    const [kept] = await lost(tm)
    const [gone] = await lost(purged)
    expect(await t.as(manager, `select id from public.lost_items where id = any($1)`, [[kept!.id, gone!.id]])).toHaveLength(0)
    expect(await t.as(tm, `select id from public.lost_items where id = $1`, [kept!.id])).toHaveLength(1)
    await t.admin('select public.purge_test_account_data()')
    expect(await t.admin(`select id from public.lost_items where id = any($1)`, [[kept!.id, gone!.id]])).toEqual([{ id: kept!.id }])
  })

  it('a real shift-table name cannot go to a test manager', async () => {
    await t.admin(`insert into public.staff_roster (name) values ('本物') on conflict do nothing`)
    await t.admin(
      `insert into public.shift_assignments (month, business_date, shift, roster_name, store_mark, store_id, start_min, end_min, raw)
       values (date_trunc('month', current_date)::date, current_date, 'early', '本物', '⑤', $1, 600, 900, '')`,
      [store],
    )
    await expect(t.as(admin, `update public.profiles set roster_name = '本物' where id = $1`, [tm])).rejects.toThrow(/real shift-table name/)
    // a real person with that name cannot become a test manager unless the name is removed in the same change
    const real = await t.createUser('real@example.com', { display_name: '本物さん' })
    await t.admin(`update public.profiles set status = 'active', roster_name = '本物' where id = $1`, [real])
    await expect(t.as(admin, `update public.profiles set is_test_account = true, keep_test_data = true where id = $1`, [real])).rejects.toThrow(/real shift-table name/)
    await t.as(admin, `update public.profiles set is_test_account = true, keep_test_data = true, roster_name = null where id = $1`, [real])
  })
})
