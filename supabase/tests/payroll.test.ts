// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// Migration 20261017000010: 給与計算 is for System Admins only (not managers, not test accounts).
let t: TestDb
let admin: string
let manager: string
let testAdmin: string
let staff: string

beforeAll(async () => {
  t = await createTestDb()
  await t.admin(`insert into public.bootstrap_accounts (email, role) values ('boss@example.com', 'manager'), ('mgr@example.com', 'manager'), ('tadmin@example.com', 'manager')`)
  admin = await t.createUser('boss@example.com')
  manager = await t.createUser('mgr@example.com')
  testAdmin = await t.createUser('tadmin@example.com')
  staff = await t.createUser('staff@example.com')
  await t.admin(`update public.profiles set role = 'admin' where id = any($1::uuid[])`, [[admin, testAdmin]])
  await t.admin(`update public.profiles set is_test_account = true where id = $1`, [testAdmin])
  await t.admin(`update public.profiles set status = 'active' where id = $1`, [staff])
  await t.admin(
    `insert into public.payroll_rates (valid_from, normal, night, overtime, training_normal, training_night) values ('2026-10-01', 1000, 1250, 1250, 1000, 1250)`,
  )
  await t.admin(`insert into public.payroll_sources (month, data, source) values ('2026-10-01', '{}', 'office365')`)
}, 60_000)

describe('給与計算: who can see it', () => {
  it('only the System Admin reads and writes', async () => {
    expect(await t.as(admin, `select normal from public.payroll_rates`)).toEqual([{ normal: 1000 }])
    for (const who of [manager, testAdmin, staff]) {
      expect(await t.as(who, `select * from public.payroll_rates`)).toEqual([])
      expect(await t.as(who, `select * from public.payroll_sources`)).toEqual([])
      await expect(t.as(who, `insert into public.payroll_staff (roster_name, kind) values ('ミナミ', '早番')`)).rejects.toThrow()
      await expect(t.as(who, `select public.close_payroll('2026-10-01', '[]', 0)`)).rejects.toThrow(/admins only/)
    }
    await t.as(admin, `insert into public.payroll_staff (roster_name, kind, commute_unit) values ('ミナミ', '早番', 380)`)
    expect(await t.as<{ updated_by: string }>(admin, `select updated_by from public.payroll_staff`)).toEqual([{ updated_by: admin }])
  })

  it('a closed month cannot change its inputs until reopened; sources are written by the server only', async () => {
    await t.as(admin, `insert into public.payroll_inputs (month, roster_name, paid_days) values ('2026-10-01', 'ミナミ', 1)`)
    await t.as(admin, `select public.close_payroll('2026-10-01', '[{"name":"ミナミ"}]', 12345)`)
    expect(await t.as(admin, `select total from public.payroll_closings`)).toEqual([{ total: 12345 }])
    await expect(t.as(admin, `update public.payroll_inputs set paid_days = 2`)).rejects.toThrow(/month_closed/)
    await t.as(admin, `select public.reopen_payroll('2026-10-01')`)
    await t.as(admin, `update public.payroll_inputs set paid_days = 2`)
    await expect(t.as(admin, `insert into public.payroll_sources (month, data, source) values ('2026-11-01', '{}', 'office365')`)).rejects.toThrow()
    await expect(t.as(admin, `insert into public.payroll_closings (month, results, total) values ('2026-11-01', '[]', 0)`)).rejects.toThrow()
  })
})
