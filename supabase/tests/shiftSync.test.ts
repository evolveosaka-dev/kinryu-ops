// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// Migration 20261017000007: imports keep the list of changes, extensions and the test copy; the share link.
let t: TestDb
let manager: string
let staff: string

const row = (date: string, shift: string, name: string, mark: string, start: number, end: number) => ({
  business_date: date,
  shift,
  roster_name: name,
  store_mark: mark,
  start_min: start * 60,
  end_min: end * 60,
  raw: `${mark}${start}-${end % 24}`,
})
const month = '2026-11-01'
const first = [row('2026-11-01', 'early', 'ミナミ', '⑤', 7, 17), row('2026-11-01', 'late', 'キタ', '①', 23, 31), row('2026-11-02', 'early', 'ミナミ', '①', 7, 11)]

const importAs = (who: string, rows: unknown[]) => t.as<{ n: number }>(who, `select public.import_shift_month($1, $2::jsonb) as n`, [month, JSON.stringify(rows)])
const log = () => t.admin<{ source: string; n_changes: number; changes: { date: string; shift: string; name: string; kind: string; before: string | null; after: string | null }[] }>(
  `select source, n_changes, changes from public.shift_import_log order by id`,
)

beforeAll(async () => {
  t = await createTestDb()
  await t.admin(`insert into public.bootstrap_accounts (email, role) values ('boss@example.com', 'manager')`)
  manager = await t.createUser('boss@example.com')
  staff = await t.createUser('staff@example.com', { display_name: 'スタッフ' })
  await t.admin(`update public.profiles set status = 'active' where id = $1`, [staff])
}, 60_000)

describe('シフト表の取り込み: changes, extensions, test copy', () => {
  it('first import: compared with the rows already in the app', async () => {
    await t.admin(
      `insert into public.shift_assignments (month, business_date, shift, roster_name, store_mark, start_min, end_min, raw, original_end_min)
       values ($1, '2026-11-01', 'early', 'ミナミ', '⑤', 420, 1080, '⑤7-17', 1020), ($1, '2026-11-03', 'middle', 'ヒガシ', '⑤', 1020, 1380, '⑤17-23', null)`,
      [month],
    )
    expect((await importAs(manager, first))[0]!.n).toBe(3)
    const [l] = await log()
    expect(l!.source).toBe('app')
    // ミナミ 11/1 is the same shift (the extension is not a change)
    expect(l!.changes.map((c) => `${c.date} ${c.name} ${c.kind}`)).toEqual(['2026-11-01 キタ added', '2026-11-02 ミナミ added', '2026-11-03 ヒガシ removed'])
    // the extension survived the import
    expect(await t.admin(`select end_min, original_end_min from public.shift_assignments where roster_name = 'ミナミ' and business_date = '2026-11-01'`)).toEqual([
      { end_min: 1080, original_end_min: 1020 },
    ])
  })

  it('next import: compared with the previous workbook; same workbook = no new entry', async () => {
    await importAs(manager, first)
    expect(await log()).toHaveLength(1)
    const next = [row('2026-11-01', 'early', 'ミナミ', '⑤', 7, 12), first[1]!, row('2026-11-02', 'early', 'ミナミ', '⑤', 7, 11)]
    const res = await t.admin<{ r: { rows: number; changes: number } }>(`select public.apply_shift_import($1, $2::jsonb, 'office365', null) as r`, [month, JSON.stringify(next)])
    expect(res[0]!.r).toMatchObject({ rows: 3, changes: 2 })
    const l = (await log())[1]!
    expect(l.source).toBe('office365')
    expect(l.changes).toEqual([
      { date: '2026-11-01', shift: 'early', name: 'ミナミ', kind: 'changed', before: '⑤7-17', after: '⑤7-12' },
      { date: '2026-11-02', shift: 'early', name: 'ミナミ', kind: 'changed', before: '①7-11', after: '⑤7-11' },
    ])
    // the shift changed, so the old extension is dropped
    expect(await t.admin(`select end_min, original_end_min from public.shift_assignments where roster_name = 'ミナミ' and business_date = '2026-11-01'`)).toEqual([
      { end_min: 720, original_end_min: null },
    ])
  })

  it('the test account copy is made again', async () => {
    await t.admin(`insert into public.test_shadows (test_roster, source_roster) values ('テスト用', 'キタ')`)
    await t.admin(`select public.apply_shift_import($1, $2::jsonb, 'office365', null)`, [month, JSON.stringify(first)])
    expect(await t.admin(`select business_date::text, shift from public.shift_assignments where roster_name = 'テスト用'`)).toEqual([{ business_date: '2026-11-01', shift: 'late' }])
  })

  it('only managers read the log, import and set the link; staff cannot call apply_shift_import', async () => {
    expect(await t.as(staff, `select id from public.shift_import_log`)).toEqual([])
    expect((await t.as(manager, `select id from public.shift_import_log`)).length).toBeGreaterThan(0)
    await expect(importAs(staff, first)).rejects.toThrow(/managers only/)
    await expect(t.as(manager, `select public.apply_shift_import($1, '[]'::jsonb, 'app', null)`, [month])).rejects.toThrow(/permission denied/)
    await expect(t.as(manager, `select public.set_shift_workbook_url('https://evil.example.com/x')`)).rejects.toThrow(/invalid_url/)
    await t.as(manager, `select public.set_shift_workbook_url('https://example-my.sharepoint.com/:x:/g/personal/a/b?e=1')`)
    expect(await t.as(manager, `select key from public.app_kv where key = 'shift_workbook_url'`)).toEqual([{ key: 'shift_workbook_url' }])
    expect(await t.as(staff, `select key from public.app_kv`)).toEqual([])
    await expect(t.as(staff, `select public.set_shift_workbook_url('https://x.sharepoint.com/a')`)).rejects.toThrow(/managers only/)
  })
})
