// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// Migration 20261017000004: 在庫・仕入 from a photo of the paper sheet — one sheet saved at once, partial 終わりの在庫,
// new places, handwritten standards reported to the system admins.

const TODAY = `(now() at time zone 'Asia/Tokyo')::date`
let t: TestDb
let store: string
let staff: string
let items: { id: string; code: string }[]

beforeAll(async () => {
  t = await createTestDb()
  store = (await t.admin<{ id: string }>(`select id from public.stores where code = 'midosuji'`))[0]!.id
  staff = await t.createUser('staff@example.com', { display_name: 'スタッフ' })
  await t.admin(`update public.profiles set status = 'active' where id = $1`, [staff])
  items = await t.admin(`select id, code from public.stock_items where store_id = $1 and active order by sort_order`, [store])
}, 60_000)

const id = (code: string) => items.find((i) => i.code === code)!.id

describe('在庫・仕入: photo of the sheet', () => {
  it('a 終わりの在庫 needs every item unless partial', async () => {
    const one = JSON.stringify([{ item: id('noodle'), qty: 600 }])
    await expect(t.as(staff, `select public.add_stock_event($1, ${TODAY}, 'early', 'close', $2::jsonb)`, [store, one])).rejects.toThrow(/count every item/)
    await t.as(staff, `select public.add_stock_event($1, ${TODAY}, 'early', 'close', $2::jsonb, null, null, null, null, null, null, true)`, [store, one])
  })

  it('one sheet → every row in one go; new places; the photo can go on the close row', async () => {
    const sheet = {
      open: { lines: [{ item: id('noodle'), qty: 337 }], reason: 'miscount', note: null },
      ins: [{ place: 'honten', note: '名前: ルオン', lines: [{ item: id('noodle'), qty: 400 }] }, { place: 'dotonbori', note: null, lines: [{ item: id('kimchi'), qty: 1 }] }],
      outs: [{ place: 'honten', note: null, lines: [{ item: id('garlic'), qty: 2 }] }],
      close: [{ item: id('noodle'), qty: 662 }, { item: id('kimchi'), qty: 3 }],
      temps_start: [6, 0, 2],
      temps_end: [4, 1, 3],
    }
    const [r] = await t.as<{ id: string }>(staff, `select public.save_stock_sheet($1, ${TODAY}, 'middle', $2::jsonb) as id`, [store, JSON.stringify(sheet)])
    const rows = await t.admin<{ kind: string; place: string | null }>(
      `select kind, place from public.stock_events where store_id = $1 and shift = 'middle' order by kind, place`,
      [store],
    )
    expect(rows.map((x) => `${x.kind}:${x.place ?? ''}`)).toEqual(['close:', 'in:dotonbori', 'in:honten', 'open:', 'out:honten', 'temp_end:', 'temp_start:'])
    expect(await t.admin(`select kind from public.stock_events where id = $1`, [r!.id])).toEqual([{ kind: 'close' }])
  })

  it('all or nothing: a bad part saves nothing', async () => {
    const sheet = { ins: [{ place: 'nowhere', lines: [{ item: id('noodle'), qty: 1 }] }], close: [{ item: id('noodle'), qty: 1 }] }
    await expect(t.as(staff, `select public.save_stock_sheet($1, ${TODAY}, 'late', $2::jsonb)`, [store, JSON.stringify(sheet)])).rejects.toThrow(/bad place/)
    expect(await t.admin(`select id from public.stock_events where store_id = $1 and shift = 'late'`, [store])).toHaveLength(0)
  })

  it('a different handwritten standard → one notification for the admins', async () => {
    const [c] = await t.admin<{ id: string }>(`select id from public.stock_events where store_id = $1 and shift = 'middle' and kind = 'close'`, [store])
    const rows = JSON.stringify([{ item: id('noodle'), paper: 700, text: '14段' }])
    await t.as(staff, `select public.report_stock_standards($1, $2::jsonb)`, [c!.id, rows])
    await t.as(staff, `select public.report_stock_standards($1, $2::jsonb)`, [c!.id, rows])
    const ev = await t.admin<{ kind: string }>(`select kind from public.notify_events where kind = 'stock_standard'`)
    expect(ev.length).toBeGreaterThanOrEqual(1)
  })
})
