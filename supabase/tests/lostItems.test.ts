// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// Migration 20261016000004: 忘れ物・落とし物 — staff record and see, managers comment / approve / send back / dispose.

let t: TestDb
let store: string
let manager: string
let staff: string
let other: string

beforeAll(async () => {
  t = await createTestDb()
  store = (await t.admin<{ id: string }>(`select id from public.stores where code = 'midosuji'`))[0]!.id
  await t.admin(`insert into public.bootstrap_accounts (email, role) values ('boss@example.com', 'manager')`)
  manager = await t.createUser('boss@example.com')
  staff = await t.createUser('staff@example.com', { display_name: 'スタッフ' })
  other = await t.createUser('other@example.com', { display_name: 'ほか' })
  await t.admin(`update public.profiles set status = 'active' where id = any($1)`, [[staff, other]])
}, 60_000)

const item = (who: string, owner = 'customer') =>
  t.as<{ id: string }>(
    who,
    `select public.report_lost_item($1, now() - interval '1 hour', '黒い傘', '入口の傘立て', 'レジ下の箱', $2, '山田', '090-0000-0000') as id`,
    [store, owner],
  )

describe('忘れ物・落とし物', () => {
  it('any staff records; everyone active sees it; a lost-item event is queued', async () => {
    const [i] = await item(staff)
    expect(await t.as(other, 'select description, owner_name from public.lost_items')).toEqual([{ description: '黒い傘', owner_name: '山田' }])
    expect(await t.admin(`select kind from public.notify_events where ref_id = $1`, [i!.id])).toEqual([{ kind: 'lost_item' }])
    // unknown owner keeps no name
    const [u] = await item(staff, 'unknown')
    expect(await t.admin('select owner_name from public.lost_items where id = $1', [u!.id])).toEqual([{ owner_name: null }])
  })

  it('returned by another staff member → pending; send back needs a comment; approve; consents only for customers', async () => {
    const [i] = await item(staff)
    const ret = (who: string) =>
      t.as(who, `select public.record_lost_item_outcome($1, 'returned', now(), '山田', null, null, true, true, null, null, null, 'id_card', true)`, [i!.id])
    await ret(other)
    expect(await t.admin('select status, approval, consent_face, consent_marketing from public.lost_items where id = $1', [i!.id])).toEqual([
      { status: 'returned', approval: 'pending', consent_face: true, consent_marketing: true },
    ])
    await expect(ret(other)).rejects.toThrow(/already handled/)
    await expect(t.as(staff, `select public.manage_lost_item($1, 'approve')`, [i!.id])).rejects.toThrow(/managers only/)
    await expect(t.as(manager, `select public.manage_lost_item($1, 'reject')`, [i!.id])).rejects.toThrow(/comment required/)
    await t.as(manager, `select public.manage_lost_item($1, 'reject', '写真がありません')`, [i!.id])
    await ret(other) // sent back → can be recorded again
    await t.as(manager, `select public.manage_lost_item($1, 'approve')`, [i!.id])
    expect(await t.admin('select approval, decided_by from public.lost_items where id = $1', [i!.id])).toEqual([{ approval: 'approved', decided_by: manager }])
    expect((await t.as<{ action: string | null }>(other, `select action from public.lost_item_comments where lost_item_id = $1 and action in ('approve', 'reject') order by created_at`, [i!.id])).map((c) => c.action)).toEqual([
      'reject',
      'approve',
    ])

    const [s] = await item(staff, 'staff')
    await t.as(other, `select public.record_lost_item_outcome($1, 'returned', now(), null, null, null, true, true, null, null, null, 'name_features', true)`, [s!.id])
    expect(await t.admin('select consent_face, consent_marketing from public.lost_items where id = $1', [s!.id])).toEqual([{ consent_face: false, consent_marketing: false }])
  })

  it('managers dispose stored items; staff cannot update rows directly', async () => {
    const [i] = await item(staff, 'unknown')
    await t.as(staff, `update public.lost_items set description = 'x' where id = $1`, [i!.id])
    expect(await t.admin('select description from public.lost_items where id = $1', [i!.id])).toEqual([{ description: '黒い傘' }])
    await t.as(manager, `select public.manage_lost_item($1, 'dispose', '保管期間が過ぎたため')`, [i!.id])
    expect(await t.admin('select status, approval from public.lost_items where id = $1', [i!.id])).toEqual([{ status: 'disposed', approval: 'approved' }])
  })
})
