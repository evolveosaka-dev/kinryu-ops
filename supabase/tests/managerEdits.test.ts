// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// Migration 20261016000001: 目標杯数 filled into 朝礼 records, manager corrections of staff input,
// originals of translated manager text.

let t: TestDb
let store: string
let manager: string
let staff: string

const TODAY = `(now() at time zone 'Asia/Tokyo')::date`
const events = () => t.admin<{ kind: string }>('select kind from public.notify_events order by id')

beforeAll(async () => {
  t = await createTestDb()
  store = (await t.admin<{ id: string }>(`select id from public.stores where code = 'midosuji'`))[0]!.id
  await t.admin(`insert into public.bootstrap_accounts (email, role) values ('boss@example.com', 'manager')`)
  manager = await t.createUser('boss@example.com')
  staff = await t.createUser('staff@example.com', { display_name: 'スタッフ' })
  await t.admin(`update public.profiles set status = 'active', full_name = '名前 テスト', roster_name = 'テスト' where id = $1`, [staff])
}, 60_000)

describe('fill_chorei_targets', () => {
  it('fills only empty targets, without a mail, and marks the history as automatic', async () => {
    const [a] = await t.as<{ id: string }>(staff, `insert into public.chorei_records (store_id, business_date, shift, stock_none) values ($1, ${TODAY}, 'early', true) returning id`, [store])
    const [b] = await t.as<{ id: string }>(staff, `insert into public.chorei_records (store_id, business_date, shift, stock_none, target_bowls) values ($1, ${TODAY}, 'middle', true, 150) returning id`, [store])
    await t.admin('delete from public.notify_events')

    await expect(t.as(staff, 'select public.fill_chorei_targets($1)', [JSON.stringify([{ id: a!.id, bowls: 187 }])])).rejects.toThrow(/managers only/)
    const [r] = await t.as<{ n: number }>(manager, 'select public.fill_chorei_targets($1) as n', [JSON.stringify([{ id: a!.id, bowls: 187 }, { id: b!.id, bowls: 999 }])])
    expect(r!.n).toBe(1)

    const rows = await t.admin<{ id: string; target_bowls: number }>('select id, target_bowls from public.chorei_records where id = any($1)', [[a!.id, b!.id]])
    expect(rows.find((x) => x.id === a!.id)!.target_bowls).toBe(187)
    expect(rows.find((x) => x.id === b!.id)!.target_bowls).toBe(150)
    expect(await events()).toEqual([])
    const audit = await t.admin<{ action: string }>(`select action from public.audit_log where table_name = 'chorei_records' and row_id = $1`, [a!.id])
    expect(audit.map((x) => x.action)).toEqual(['auto_target'])

    // a manager's own edit still notifies
    await t.as(manager, 'update public.chorei_records set target_bowls = 190 where id = $1', [a!.id])
    expect((await events()).map((e) => e.kind)).toEqual(['edit'])
  })
})

describe('manager_edit_shift_change', () => {
  it('managers correct the reason, note and minutes; staff cannot', async () => {
    const [c] = await t.admin<{ id: string }>(
      `insert into public.shift_changes (kind, roster_name, requester_id, business_date, shift, store_id, store_mark, start_min, end_min, late_min, reason, note, notice_min)
       values ('late', 'テスト', $1, ${TODAY} + 1, 'early', $2, '御', 420, 1020, 10, 'transport', '電車', 600) returning id`,
      [staff, store],
    )
    const call = (who: string, late: number) =>
      t.as(who, `select public.manager_edit_shift_change($1, 'other', 'バスが遅れました', 'Xe buýt trễ', 'vi', $2, null)`, [c!.id, late])
    await expect(call(staff, 30)).rejects.toThrow(/managers only/)
    await expect(call(manager, 0)).rejects.toThrow(/bad late minutes/)
    await call(manager, 30)
    const [row] = await t.admin<{ reason: string; note: string; note_original: string; late_min: number }>(
      'select reason, note, note_original, late_min from public.shift_changes where id = $1',
      [c!.id],
    )
    expect(row).toEqual({ reason: 'other', note: 'バスが遅れました', note_original: 'Xe buýt trễ', late_min: 30 })
    const [audit] = await t.admin<{ diff: Record<string, unknown> }>(`select diff from public.audit_log where table_name = 'shift_changes' and row_id = $1`, [c!.id])
    expect(Object.keys(audit!.diff).sort()).toEqual(['late_min', 'note', 'note_original', 'reason', 'source_lang'])
  })
})

describe('replace_stock_event', () => {
  it('a manager replaces a row: old one cancelled, writer and time kept', async () => {
    const [item] = await t.admin<{ id: string }>(
      `insert into public.stock_items (store_id, code, name_ja, unit, sort_order) values ($1, 'test_item', 'テスト品', 'piece', 99) returning id`,
      [store],
    )
    const [ev] = await t.as<{ id: string }>(
      staff,
      `select public.add_stock_event($1, ${TODAY}, 'early', 'in', $2, 'warehouse') as id`,
      [store, JSON.stringify([{ item: item!.id, qty: 5 }])],
    )
    const args = [ev!.id, JSON.stringify([{ item: item!.id, qty: 8 }])]
    await expect(t.as(staff, `select public.replace_stock_event($1, $2, 'warehouse')`, args)).rejects.toThrow(/managers only/)
    const [n] = await t.as<{ id: string }>(manager, `select public.replace_stock_event($1, $2, 'warehouse') as id`, args)

    const rows = await t.admin<{ id: string; author_id: string; voided_by: string | null; replaces: string | null; edited_by: string | null; lines: { qty: number }[]; created_at: string }>(
      'select id, author_id, voided_by, replaces, edited_by, lines, created_at from public.stock_events where id = any($1)',
      [[ev!.id, n!.id]],
    )
    const old = rows.find((r) => r.id === ev!.id)!
    const fresh = rows.find((r) => r.id === n!.id)!
    expect(old.voided_by).toBe(manager)
    expect(fresh).toMatchObject({ author_id: staff, replaces: ev!.id, edited_by: manager, voided_by: null })
    expect(fresh.lines[0]!.qty).toBe(8)
    expect(String(fresh.created_at)).toBe(String(old.created_at))
    // a cancelled row cannot be replaced again
    await expect(t.as(manager, `select public.replace_stock_event($1, $2, 'warehouse')`, args)).rejects.toThrow(/not found/)
  })
})

describe('manager_text_originals', () => {
  it('managers keep and read originals; staff can do neither', async () => {
    const row = `insert into public.manager_text_originals (table_name, row_key, field, original, source_lang) values ('chorei_comments', 'x', 'body', 'Cảm ơn', 'vi')`
    await expect(t.as(staff, row)).rejects.toThrow()
    await t.as(manager, row)
    expect(await t.as(staff, 'select * from public.manager_text_originals')).toHaveLength(0)
    expect(await t.as(manager, 'select original from public.manager_text_originals')).toEqual([{ original: 'Cảm ơn' }])
  })
})
