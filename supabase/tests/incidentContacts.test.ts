// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// Migration 20261016000002: 緊急連絡先, the contact log, the new report_incident fields, managers correcting a report.

let t: TestDb
let store: string
let manager: string
let staff: string
let other: string
let contact: string

beforeAll(async () => {
  t = await createTestDb()
  store = (await t.admin<{ id: string }>(`select id from public.stores where code = 'midosuji'`))[0]!.id
  await t.admin(`insert into public.bootstrap_accounts (email, role) values ('boss@example.com', 'manager')`)
  manager = await t.createUser('boss@example.com')
  staff = await t.createUser('staff@example.com', { display_name: 'スタッフ' })
  other = await t.createUser('other@example.com', { display_name: 'ほか' })
  await t.admin(`update public.profiles set status = 'active' where id = any($1)`, [[staff, other]])
}, 60_000)

describe('緊急連絡先', () => {
  it('managers write; staff read only the active ones', async () => {
    await expect(t.as(staff, `insert into public.emergency_contacts (name, phone) values ('X', '090')`)).rejects.toThrow()
    const [c] = await t.as<{ id: string }>(manager, `insert into public.emergency_contacts (name, phone) values ('担当', '090-1234-5678') returning id`)
    contact = c!.id
    await t.as(manager, `insert into public.emergency_contacts (name, active) values ('休止中', false)`)
    expect(await t.as(staff, 'select name from public.emergency_contacts')).toEqual([{ name: '担当' }])
  })
})

describe('contact log + report_incident', () => {
  it('logs a call, keeps the answer, links it to the report; others cannot see it', async () => {
    const [l] = await t.as<{ id: string }>(staff, `select public.log_emergency_contact($1, 'phone') as id`, [contact])
    await t.as(staff, `select public.set_emergency_contact_result($1, 'reached')`, [l!.id])
    await expect(t.as(other, `select public.set_emergency_contact_result($1, 'no_answer')`, [l!.id])).rejects.toThrow(/not found/)

    const call = (action: string | null, source: string) =>
      t.as<{ id: string }>(
        staff,
        `select public.report_incident($1, current_date, 'early', now(), 'complaint', '麺がぬるい', $2, null, null,
                                       '山田', '090-0000-0000', 'phone', $3, '{"ja":"作り直す"}'::jsonb, $4) as id`,
        [store, action, [l!.id], source],
      )
    await expect(call(null, 'own')).rejects.toThrow(/action required/)
    const [r] = await call('作り直しました', 'ai')
    const [row] = await t.admin<Record<string, unknown>>(
      'select customer_name, customer_phone, contact_method, action_source, ai_suggestion from public.incidents where id = $1',
      [r!.id],
    )
    expect(row).toEqual({ customer_name: '山田', customer_phone: '090-0000-0000', contact_method: 'phone', action_source: 'ai', ai_suggestion: { ja: '作り直す' } })
    expect(await t.admin('select result, incident_id from public.emergency_contact_log where id = $1', [l!.id])).toEqual([{ result: 'reached', incident_id: r!.id }])
    expect(await t.as(other, 'select id from public.emergency_contact_log')).toEqual([])
    expect(await t.as(manager, 'select id from public.emergency_contact_log')).toHaveLength(1)

    // managers correct the report, but not who wrote it
    await t.as(manager, `update public.incidents set description = '麺がぬるかった', kind = 'other' where id = $1`, [r!.id])
    await expect(t.as(manager, `update public.incidents set reporter_name = '別人' where id = $1`, [r!.id])).rejects.toThrow(/reporter/)
  })
})

describe('ケガ・事故の人 / 電話の伝言 (20261016000003)', () => {
  it('keeps who was hurt for injuries and who called for phone messages only', async () => {
    const report = (kind: string) =>
      t.as<{ id: string }>(
        staff,
        `select public.report_incident($1, current_date, 'early', now(), $2, '内容', null, null, null, '業者A', '06-0000-0000', 'none',
                                       null, null, null, array['staff', 'customer'], 'グエン', 'vendor') as id`,
        [store, kind],
      )
    const [injury] = await report('injury')
    const [message] = await report('phone_message')
    const [other] = await report('equipment')
    const rows = await t.admin<{ id: string; injured_who: string[] | null; injured_staff: string | null; caller_type: string | null }>(
      'select id, injured_who, injured_staff, caller_type from public.incidents where id = any($1)',
      [[injury!.id, message!.id, other!.id]],
    )
    const by = (id: string) => rows.find((x) => x.id === id)
    expect(by(injury!.id)).toMatchObject({ injured_who: ['staff', 'customer'], injured_staff: 'グエン', caller_type: null })
    expect(by(message!.id)).toMatchObject({ injured_who: null, injured_staff: null, caller_type: 'vendor' })
    expect(by(other!.id)).toMatchObject({ injured_who: null, injured_staff: null, caller_type: null })
  })
})
