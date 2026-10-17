// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// Migration 20261017000008: own changes after an import, duties left without a shift, reassigning them.
let t: TestDb
let manager: string
let minami: string
let kita: string
let store: string
const D = `((now() at time zone 'Asia/Tokyo')::date + 3)`
let day = ''

beforeAll(async () => {
  t = await createTestDb()
  await t.admin(`insert into public.bootstrap_accounts (email, role) values ('boss@example.com', 'manager')`)
  manager = await t.createUser('boss@example.com')
  minami = await t.createUser('minami@example.com', { display_name: 'ミナミ' })
  kita = await t.createUser('kita@example.com', { display_name: 'キタ' })
  for (const [id, name] of [[minami, 'ミナミ'], [kita, 'キタ']] as const) await t.admin(`update public.profiles set status = 'active', roster_name = $2 where id = $1`, [id, name])
  store = (await t.admin<{ id: string }>(`select id from public.stores where code = 'sennichimae'`))[0]!.id
  day = (await t.admin<{ d: string }>(`select ${D}::text as d`))[0]!.d
  const row = (name: string, shift: string, s: number, e: number) => ({ business_date: day, shift, roster_name: name, store_mark: '⑤', start_min: s, end_min: e, raw: `⑤${s / 60}-${(e / 60) % 24}` })
  const month = `${day.slice(0, 7)}-01`
  // first: ミナミ 中番 + 遅番; then the workbook moves 中番 to キタ
  await t.admin(`select public.apply_shift_import($1, $2::jsonb, 'office365', null)`, [month, JSON.stringify([row('ミナミ', 'middle', 1020, 1380), row('ミナミ', 'late', 1380, 1860)])])
  await t.admin(
    `insert into public.duty_assignments (business_date, shift, store_id, roster_name, kind, time_mode, start_min, end_min, method)
     values ($1, 'middle', $2, 'ミナミ', 'chorei', 'at', 1020, 1050, 'own'), ($1, 'middle', $2, 'ミナミ', 'patrol', 'during', 1020, 1380, 'own'),
            ($1, 'late', $2, 'ミナミ', 'chorei', 'at', 1380, 1410, 'own')`,
    [day, store],
  )
  await t.admin(`select public.apply_shift_import($1, $2::jsonb, 'office365', null)`, [month, JSON.stringify([row('キタ', 'middle', 1020, 1380), row('ミナミ', 'late', 1380, 1860)])])
}, 60_000)

describe('ホーム: shift changes and duties', () => {
  it('each person sees only their own changes', async () => {
    expect(await t.as(minami, `select shift, kind, before, after from public.my_shift_changes(7)`)).toEqual([{ shift: 'middle', kind: 'removed', before: '⑤17-23', after: null }])
    expect(await t.as(kita, `select shift, kind from public.my_shift_changes(7)`)).toEqual([{ shift: 'middle', kind: 'added' }])
  })

  it('managers see the duties without a shift, staff do not', async () => {
    expect(await t.as(manager, `select shift, kind, roster_name from public.orphan_duties()`)).toEqual([
      { shift: 'middle', kind: 'chorei', roster_name: 'ミナミ' },
      { shift: 'middle', kind: 'patrol', roster_name: 'ミナミ' },
    ])
    expect(await t.as(minami, `select * from public.orphan_duties()`)).toEqual([])
  })

  it('a manager gives them to someone else; staff cannot', async () => {
    const ids = (await t.as<{ id: string }>(manager, `select id from public.orphan_duties()`)).map((r) => r.id)
    await expect(t.as(minami, `select public.reassign_duties($1::uuid[], 'キタ')`, [ids])).rejects.toThrow(/managers only/)
    await expect(t.as(manager, `select public.reassign_duties($1::uuid[], 'だれ')`, [ids])).rejects.toThrow(/unknown_name/)
    expect((await t.as<{ n: number }>(manager, `select public.reassign_duties($1::uuid[], 'キタ') as n`, [ids]))[0]!.n).toBe(2)
    expect(await t.as(manager, `select * from public.orphan_duties()`)).toEqual([])
    expect(await t.admin(`select roster_name, kind from public.duty_assignments where shift = 'middle' order by kind`)).toEqual([
      { roster_name: 'キタ', kind: 'chorei' },
      { roster_name: 'キタ', kind: 'patrol' },
    ])
  })
})

describe('担当の割り当て with 勤務延長', () => {
  it('the shift before is extended to cover the duties', async () => {
    const month = `${day.slice(0, 7)}-01`
    await t.admin(
      `insert into public.shift_assignments (month, business_date, shift, roster_name, store_mark, store_id, start_min, end_min, raw)
       values ($1, $2, 'early', 'ヒガシ', '⑤', $3, 420, 1050, '⑤7-17.5')`,
      [month, day, store],
    )
    await t.admin(`insert into public.staff_roster (name) values ('ヒガシ') on conflict do nothing`)
    const [d] = await t.admin<{ id: string }>(
      `insert into public.duty_assignments (business_date, shift, store_id, roster_name, kind, time_mode, start_min, end_min, method)
       values ($1, 'middle', $2, 'だれか', 'chorei', 'at', 1050, 1080, 'move') returning id`,
      [day, store],
    )
    await expect(t.as(manager, `select public.reassign_duties($1::uuid[], 'ヒガシ', $2::date, 'early', 1020)`, [[d!.id], day])).rejects.toThrow(/bad_extension/)
    await expect(t.as(manager, `select public.reassign_duties($1::uuid[], 'ヒガシ', $2::date, 'middle', 1080)`, [[d!.id], day])).rejects.toThrow(/no_shift/)
    await t.as(manager, `select public.reassign_duties($1::uuid[], 'ヒガシ', $2::date, 'early', 1080)`, [[d!.id], day])
    expect(await t.admin(`select end_min, original_end_min from public.shift_assignments where roster_name = 'ヒガシ'`)).toEqual([{ end_min: 1080, original_end_min: 1050 }])
    expect(await t.admin(`select roster_name from public.duty_assignments where id = $1`, [d!.id])).toEqual([{ roster_name: 'ヒガシ' }])
    expect((await t.as<{ id: string }>(manager, `select id from public.orphan_duties()`)).map((r) => r.id)).not.toContain(d!.id)
  })
})
