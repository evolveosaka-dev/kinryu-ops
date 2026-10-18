// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// 販売杯数 from Office 365 (migration 20261019000001): apply_sales_import adds / updates Excel figures, never a 販売日報.
let t: TestDb
let manager: string
type Row = { date: string; store: string; shift: string; bowls: number }
const run = (rows: Row[]) => t.admin<{ r: Record<string, any> }>(`select public.apply_sales_import($1::jsonb) as r`, [JSON.stringify(rows)]).then((x) => x[0]!.r) // eslint-disable-line @typescript-eslint/no-explicit-any
const bowls = () =>
  t.admin<{ k: string; bowls: number; source: string }>(
    `select d.business_date::text || '|' || s.code || '|' || d.shift as k, d.bowls, d.source from public.daily_sales d join public.stores s on s.id = d.store_id order by 1`,
  )

beforeAll(async () => {
  t = await createTestDb()
  await t.admin(`insert into public.bootstrap_accounts (email, role) values ('boss@example.com', 'manager')`)
  manager = await t.createUser('boss@example.com')
}, 60_000)

describe('販売杯数 import', () => {
  it('adds new figures, updates changed ones, keeps the rest; reports the changes', async () => {
    let r = await run([
      { date: '2026-10-16', store: 'sennichimae', shift: 'early', bowls: 166 },
      { date: '2026-10-16', store: 'midosuji', shift: 'late', bowls: 145 },
      { date: '2024-12-31', store: 'midosuji', shift: 'late', bowls: 1 }, // before 2025: left out
      { date: '2099-01-01', store: 'midosuji', shift: 'late', bowls: 1 }, // future: left out
      { date: '2026-10-16', store: 'nowhere', shift: 'late', bowls: 1 },
    ])
    expect(r).toMatchObject({ rows: 2, added: 2, changed: 0, same: 0, report: 0 })
    r = await run([
      { date: '2026-10-16', store: 'sennichimae', shift: 'early', bowls: 170 },
      { date: '2026-10-16', store: 'midosuji', shift: 'late', bowls: 145 },
      { date: '2026-10-17', store: 'midosuji', shift: 'late', bowls: 170 },
    ])
    expect(r).toMatchObject({ rows: 3, added: 1, changed: 1, same: 1 })
    expect(r.changes).toEqual([
      { date: '2026-10-17', store: 'midosuji', shift: 'late', kind: 'added', before: null, after: 170 },
      { date: '2026-10-16', store: 'sennichimae', shift: 'early', kind: 'changed', before: 166, after: 170 },
    ])
    expect(await bowls()).toEqual([
      { k: '2026-10-16|midosuji|late', bowls: 145, source: 'excel' },
      { k: '2026-10-16|sennichimae|early', bowls: 170, source: 'excel' },
      { k: '2026-10-17|midosuji|late', bowls: 170, source: 'excel' },
    ])
  })
  it('a sent 販売日報 wins over the file', async () => {
    await t.admin(
      `insert into public.sales_reports (store_id, business_date, shift, status, tickets)
       values ((select id from public.stores where code = 'midosuji'), '2026-10-17', 'late', 'submitted', '{"ramen": 150, "chashu": 30, "coupon": 4}')`,
    )
    const r = await run([
      { date: '2026-10-16', store: 'sennichimae', shift: 'early', bowls: 170 },
      { date: '2026-10-16', store: 'midosuji', shift: 'late', bowls: 145 },
      { date: '2026-10-17', store: 'midosuji', shift: 'late', bowls: 999 },
    ])
    expect(r).toMatchObject({ added: 0, changed: 0, same: 2, report: 1 })
    expect((await bowls()).find((x) => x.k === '2026-10-17|midosuji|late')).toEqual({ k: '2026-10-17|midosuji|late', bowls: 180, source: 'report' })
  })
  it('a file with far fewer figures is refused; a cell emptied in the file deletes nothing', async () => {
    await expect(run([{ date: '2026-10-16', store: 'midosuji', shift: 'late', bowls: 145 }])).rejects.toThrow(/not imported/)
    const r = await run([
      { date: '2026-10-16', store: 'sennichimae', shift: 'early', bowls: 170 },
      { date: '2026-10-16', store: 'midosuji', shift: 'late', bowls: 145 },
      { date: '2026-10-18', store: 'midosuji', shift: 'early', bowls: 100 },
    ])
    expect(r.added).toBe(1)
    expect((await bowls()).length).toBe(4)
  })
  it('only the service role imports; managers set the link (SharePoint only)', async () => {
    await expect(t.as(manager, `select public.apply_sales_import('[]'::jsonb)`)).rejects.toThrow(/permission denied/)
    await t.admin(`update public.profiles set status = 'active' where id = $1`, [manager])
    await expect(t.as(manager, `select public.set_sales_workbook_url('https://example.com/x')`)).rejects.toThrow(/invalid_url/)
    await t.as(manager, `select public.set_sales_workbook_url('https://evolve1234-my.sharepoint.com/:x:/g/a?e=1')`)
    expect(await t.admin(`select value from public.app_kv where key = 'sales_workbook_url'`)).toEqual([{ value: 'https://evolve1234-my.sharepoint.com/:x:/g/a?e=1' }])
  })
})
