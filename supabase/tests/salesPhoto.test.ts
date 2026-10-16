// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// Migration 20261017000006: the photo of the paper 販売日報 is kept with the report (attachments.sales_report_id).

const TODAY = `(now() at time zone 'Asia/Tokyo')::date`
let t: TestDb
let store: string
let staff: string

beforeAll(async () => {
  t = await createTestDb()
  store = (await t.admin<{ id: string }>(`select id from public.stores where code = 'midosuji'`))[0]!.id
  staff = await t.createUser('staff@example.com', { display_name: 'スタッフ' })
  await t.admin(`update public.profiles set status = 'active' where id = $1`, [staff])
}, 60_000)

describe('販売日報: photo of the sheet', () => {
  it('an attachment can belong to a sales report, and to one parent only', async () => {
    const [r] = await t.as<{ id: string }>(staff, `select public.save_sales_report($1, ${TODAY}, 'early', '{"tickets":{"ramen":10}}'::jsonb) as id`, [store])
    await t.admin(
      `insert into public.attachments (owner_id, sales_report_id, kind, file_name, mime_type, size_bytes) values ($1, $2, 'image', 'a.jpg', 'image/jpeg', 10)`,
      [staff, r!.id],
    )
    expect(await t.as(staff, `select sales_report_id from public.attachments`)).toEqual([{ sales_report_id: r!.id }])
    const [c] = await t.admin<{ id: string }>(`insert into public.chorei_records (store_id, business_date, shift, stock_none, leader_id) values ($1, ${TODAY}, 'early', true, $2) returning id`, [store, staff])
    await expect(
      t.admin(
        `insert into public.attachments (owner_id, sales_report_id, chorei_id, kind, file_name, mime_type, size_bytes) values ($1, $2, $3, 'image', 'b.jpg', 'image/jpeg', 10)`,
        [staff, r!.id, c!.id],
      ),
    ).rejects.toThrow(/attachment_one_parent/)
  })
})
