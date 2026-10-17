// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// 休み・遅刻・早退の連絡, 代わり募集 and 出勤評価 (migrations 20261014000008 / 09).
let t: TestDb
let manager: string
let minami: string // ミナミ
let kita: string // キタ
let higashi: string // ヒガシ
const d: Record<string, string> = {}

const TODAY = `(now() at time zone 'Asia/Tokyo')::date`

async function assign(name: string, date: string, shift: string, start: number, end: number, mark = '⑤') {
  await t.admin(
    `insert into public.shift_assignments (month, business_date, shift, roster_name, store_mark, store_id, start_min, end_min, raw)
     values (date_trunc('month', $1::date)::date, $1, $2, $3, $4, (select id from public.stores where code = 'sennichimae'), $5, $6, $7)`,
    [date, shift, name, mark, start, end, `${mark}${start / 60}-${(end / 60) % 24}`],
  )
}
const who = (date: string, shift: string) =>
  t.admin<{ roster_name: string; end_min: number }>(`select roster_name, end_min from public.shift_assignments where business_date = $1 and shift = $2 order by roster_name`, [date, shift])

beforeAll(async () => {
  t = await createTestDb()
  await t.admin(`insert into public.bootstrap_accounts (email, role) values ('boss@example.com', 'manager')`)
  manager = await t.createUser('boss@example.com')
  minami = await t.createUser('minami@example.com', { display_name: 'ミナミ' })
  kita = await t.createUser('kita@example.com', { display_name: 'キタ' })
  higashi = await t.createUser('higashi@example.com', { display_name: 'ヒガシ' })
  for (const [id, name] of [[minami, 'ミナミ'], [kita, 'キタ'], [higashi, 'ヒガシ']] as const)
    await t.admin(`update public.profiles set status = 'active', roster_name = $2 where id = $1`, [id, name])
  const [row] = await t.admin<Record<string, string>>(
    `select (${TODAY} - 40)::text as past, (${TODAY} + 3)::text as d3, (${TODAY} + 5)::text as d5, (${TODAY} + 8)::text as d8`,
  )
  Object.assign(d, row)
  await assign('ミナミ', d.d3!, 'early', 420, 1020)
  await assign('ヒガシ', d.d3!, 'early', 420, 1020)
  await assign('キタ', d.d5!, 'middle', 1020, 1380)
  await assign('ミナミ', d.d8!, 'middle', 1020, 1380)
}, 60_000)

const report = (args: string) => `select public.report_shift_change(${args}) as id`

describe('休み連絡 and 代わり募集', () => {
  let absence: string
  it('staff report only their own scheduled shifts; other staff never read the reason', async () => {
    await expect(t.as(minami, report(`'absence', '${d.d5}', 'middle', 'sick'`))).rejects.toThrow(/no such shift/)
    await expect(t.as(minami, report(`'absence', '${d.d3}', 'early', 'sick', p_roster_name => 'ヒガシ'`))).rejects.toThrow(/managers only/)
    await expect(t.as(minami, report(`'absence', '${d.d3}', 'early', 'store'`))).rejects.toThrow(/managers only/)
    await expect(t.as(minami, report(`'absence', '${d.d3}', 'early', 'other'`))).rejects.toThrow(/note required/)
    const [r] = await t.as<{ id: string }>(minami, report(`'absence', '${d.d3}', 'early', 'family', '法事', p_recruit => true, p_swap_ok => true`))
    absence = r!.id
    await expect(t.as(minami, report(`'late', '${d.d3}', 'early', 'transport', p_late_min => 10`))).rejects.toThrow(/shift_changes_one_active/)
    expect(await t.as(kita, `select id from public.shift_changes`)).toEqual([])
    const ev = await t.admin<{ urgent: boolean }>(`select urgent from public.notify_events where kind = 'shift_change'`)
    expect(ev).toEqual([{ urgent: false }]) // 3 days ahead
  })
  it('the recruit is shown to people free at that time, without the reason', async () => {
    const [rec] = await t.as<Record<string, unknown>>(kita, `select * from public.shift_recruits()`)
    expect(rec).toMatchObject({ id: absence, roster_name: 'ミナミ', kind: 'absence', swap_ok: true, my_offer_id: null })
    expect(Object.keys(rec!)).not.toContain('reason')
    // ヒガシ works that 早番 → not offered to them
    expect(await t.as(higashi, `select * from public.shift_recruits()`)).toEqual([])
    await expect(t.as(higashi, `select public.offer_shift_cover($1)`, [absence])).rejects.toThrow(/you work at that time/)
    expect(await t.as(minami, `select * from public.shift_recruits()`)).toEqual([])
  })
  it('交換: キタ offers and gives one of their own shifts back', async () => {
    await expect(t.as(kita, `select public.offer_shift_cover($1, $2, 'early')`, [absence, d.d5])).rejects.toThrow(/no such shift/)
    await t.as(kita, `select public.offer_shift_cover($1, $2, 'middle')`, [absence, d.d5])
    const offers = await t.as<{ roster_name: string; give_shift: string }>(minami, `select roster_name, give_shift from public.shift_offers`)
    expect(offers).toEqual([{ roster_name: 'キタ', give_shift: 'middle' }])
    expect(await t.as(higashi, `select id from public.shift_offers`)).toEqual([])
  })
  it('only managers decide; approval swaps the shifts and survives a re-import', async () => {
    const [o] = await t.admin<{ id: string }>(`select id from public.shift_offers`)
    await expect(t.as(minami, `select public.decide_shift_change($1, true, $2)`, [absence, o!.id])).rejects.toThrow(/managers only/)
    await t.as(manager, `select public.decide_shift_change($1, true, $2)`, [absence, o!.id])
    expect((await who(d.d3!, 'early')).map((r) => r.roster_name)).toEqual(['キタ', 'ヒガシ'])
    expect((await who(d.d5!, 'middle')).map((r) => r.roster_name)).toEqual(['ミナミ'])
    const [rec] = await t.as<{ status: string; my_offer_status: string; assigned: boolean }>(kita, `select status, my_offer_status, assigned from public.shift_recruits()`)
    expect(rec).toEqual({ status: 'approved', my_offer_status: 'accepted', assigned: true })
    // re-import the original table of that month: the swap is applied again
    const month = d.d3!.slice(0, 8) + '01'
    const rows = [
      { business_date: d.d3, shift: 'early', roster_name: 'ミナミ', store_mark: '⑤', start_min: 420, end_min: 1020, raw: '⑤7-17' },
      { business_date: d.d3, shift: 'early', roster_name: 'ヒガシ', store_mark: '⑤', start_min: 420, end_min: 1020, raw: '⑤7-17' },
      { business_date: d.d5, shift: 'middle', roster_name: 'キタ', store_mark: '⑤', start_min: 1020, end_min: 1380, raw: '⑤17-23' },
      { business_date: d.d8, shift: 'middle', roster_name: 'ミナミ', store_mark: '⑤', start_min: 1020, end_min: 1380, raw: '⑤17-23' },
    ].filter((r) => r.business_date!.startsWith(d.d3!.slice(0, 7)))
    await t.as(manager, `select public.import_shift_month($1, $2)`, [month, JSON.stringify(rows)])
    expect((await who(d.d3!, 'early')).map((r) => r.roster_name)).toEqual(['キタ', 'ヒガシ'])
    if (d.d5!.startsWith(d.d3!.slice(0, 7))) expect((await who(d.d5!, 'middle')).map((r) => r.roster_name)).toEqual(['ミナミ'])
  })
  it('早退 with a replacement chosen by the manager; without one the absence removes the shift', async () => {
    const [e] = await t.as<{ id: string }>(minami, report(`'early_leave', '${d.d8}', 'middle', 'sick', p_leave_min => 1200, p_recruit => true`))
    await t.as(manager, `select public.decide_shift_change($1, true, p_cover => 'ヒガシ')`, [e!.id])
    expect(await who(d.d8!, 'middle')).toEqual([
      { roster_name: 'ヒガシ', end_min: 1380 },
      { roster_name: 'ミナミ', end_min: 1200 },
    ])
    const [a] = await t.as<{ id: string }>(manager, report(`'absence', '${d.d8}', 'middle', 'store', p_roster_name => 'ヒガシ'`))
    // one active change per person and shift: ミナミ's 早退 is approved, so ヒガシ (now on that shift) can be reported
    await t.as(manager, `select public.decide_shift_change($1, true)`, [a!.id])
    expect((await who(d.d8!, 'middle')).map((r) => r.roster_name)).toEqual(['ミナミ'])
  })
  it('the reporter may cancel while open; a rejected report changes nothing', async () => {
    const [l] = await t.as<{ id: string }>(kita, report(`'late', '${d.d3}', 'early', 'transport', p_late_min => 20`))
    await expect(t.as(higashi, `select public.cancel_shift_change($1)`, [l!.id])).rejects.toThrow(/cannot cancel/)
    await t.as(kita, `select public.cancel_shift_change($1)`, [l!.id])
    const [l2] = await t.as<{ id: string }>(kita, report(`'late', '${d.d3}', 'early', 'transport', p_late_min => 20`))
    await expect(t.as(manager, `select public.decide_shift_change($1, true, p_cover => 'ヒガシ')`, [l2!.id])).rejects.toThrow(/no replacement/)
    await t.as(manager, `select public.decide_shift_change($1, false, p_note => '電車の遅延証明を')`, [l2!.id])
    expect((await who(d.d3!, 'early')).map((r) => r.roster_name)).toEqual(['キタ', 'ヒガシ'])
  })
})

describe('出勤評価', () => {
  const events = (user: string) =>
    t.as<{ event_key: string; roster_name: string; kind: string; base_points: number; points: number; excluded: boolean }>(
      user,
      `select event_key, roster_name, kind, base_points, points, excluded from public.attendance_events(${TODAY} - 60, ${TODAY} + 30) order by roster_name, kind, event_key`,
    )
  it('points by how early people reported; replacements earn points', async () => {
    const ev = await events(manager)
    const pick = (name: string) => ev.filter((e) => e.roster_name === name).map((e) => [e.kind, e.points])
    expect(pick('ミナミ')).toEqual([
      ['absence', 0], // reported days before, a replacement was found
      ['early_leave', -1],
    ])
    expect(pick('キタ')).toEqual([['cover', 2]])
    expect(pick('ヒガシ')).toEqual([
      ['absence', 0], // 店の都合
      ['cover', 2],
    ])
  })
  it('a manager records a phone call after the start: 当日・無断 levels', async () => {
    await assign('キタ', d.past!, 'early', 420, 1020)
    await assign('ヒガシ', d.past!, 'early', 420, 1020)
    // ヒガシ called 30 min before the start, キタ only after it
    await t.as(manager, report(`'absence', '${d.past}', 'early', 'sick', p_roster_name => 'ヒガシ', p_reported_at => public.shift_at('${d.past}', 390)`))
    await t.as(manager, report(`'late', '${d.past}', 'early', 'transport', p_roster_name => 'キタ', p_late_min => 10, p_reported_at => public.shift_at('${d.past}', 430)`))
    const ev = await events(manager)
    expect(ev.find((e) => e.roster_name === 'ヒガシ' && e.event_key.startsWith('change') && e.kind === 'absence' && e.base_points !== 0)?.points).toBe(-5)
    expect(ev.find((e) => e.roster_name === 'キタ' && e.kind === 'late')?.points).toBe(-3) // ≤15 min −1, reported after the start −2
  })
  it('販売日報 without a report = 連絡なし; managers can exclude; staff see only themselves', async () => {
    await assign('ミナミ', d.past!, 'early', 420, 1020)
    await t.admin(
      `insert into public.sales_reports (store_id, business_date, shift, status, staff)
       values ((select id from public.stores where code = 'sennichimae'), $1, 'early', 'submitted', $2)`,
      [d.past, JSON.stringify([
        { name: 'ミナミ', start: '07:00', end: '17:00', status: 'absent' },
        { name: 'キタ', start: '07:25', end: '17:00', status: 'late' },
      ])],
    )
    let ev = await events(manager)
    const noShow = ev.find((e) => e.roster_name === 'ミナミ' && e.event_key.startsWith('report'))!
    expect(noShow).toMatchObject({ kind: 'absence', points: -10 })
    // キタ reported late 10 min, the 日報 says 25 min → −2 and −2 (after the start)
    expect(ev.find((e) => e.roster_name === 'キタ' && e.kind === 'late')?.points).toBe(-4)
    await t.as(manager, `insert into public.attendance_overrides (event_key, excluded, note) values ($1, true, '日報の入力ミス')`, [noShow.event_key])
    ev = await events(manager)
    expect(ev.find((e) => e.event_key === noShow.event_key)).toMatchObject({ points: 0, excluded: true })
    expect((await events(minami)).every((e) => e.roster_name === 'ミナミ')).toBe(true)
    await expect(t.as(minami, `insert into public.attendance_overrides (event_key, excluded) values ('x', true)`)).rejects.toThrow(/row-level security/)
  })
})

describe('留学・家族滞在: 28 hours in 7 days', () => {
  const alerts = () => t.admin<{ data: { roster_name: string; minutes: number } }>(`select data from public.notify_events where kind = 'visa_hours' order by id`)
  it('setting the visa checks at once; one mail per run; managers only', async () => {
    // ヒガシ: 5 × 6 h within 7 days from day 20 = 30 h
    for (let i = 0; i < 5; i++) {
      const [r] = await t.admin<{ d: string }>(`select (${TODAY} + 20 + ${i})::text as d`)
      await assign('ヒガシ', r!.d, 'early', 420, 780)
    }
    await expect(t.as(minami, `insert into public.staff_limits (roster_name, visa) values ('ヒガシ', 'student')`)).rejects.toThrow(/row-level security/)
    await t.as(manager, `insert into public.staff_limits (roster_name, visa) values ('ヒガシ', 'student')`)
    expect((await alerts()).map((a) => [a.data.roster_name, a.data.minutes])).toEqual([['ヒガシ', 1800]])
    await t.admin(`select public.check_visa_hours()`)
    expect(await alerts()).toHaveLength(1)
    const w = await t.as<{ minutes: number }>(manager, `select minutes from public.visa_hour_windows(${TODAY} + 20, ${TODAY} + 20)`)
    expect(w).toEqual([{ minutes: 1800 }])
    expect(await t.as(minami, `select * from public.visa_hour_windows(${TODAY}, ${TODAY} + 30)`)).toEqual([])
  })
  it('28 hours exactly is fine', async () => {
    await t.admin(`update public.shift_assignments set end_min = 756 where roster_name = 'ヒガシ' and business_date >= ${TODAY} + 20`) // 5 × 5.6 h = 28 h
    const w = await t.as<{ minutes: number }>(manager, `select max(minutes) as minutes from public.visa_hour_windows(${TODAY} + 14, ${TODAY} + 24)`)
    expect(w[0]!.minutes).toBe(1680)
  })
})

describe('代わりの人を指名 + 28 hours everywhere', () => {
  let day22 = ''
  it('the form checks the named person: visa over 28 h is refused with the reason', async () => {
    const [r] = await t.admin<{ d: string }>(`select (${TODAY} + 22)::text as d`)
    day22 = r!.d
    await assign('ミナミ', day22, 'middle', 1020, 1380)
    const check = (name: string) => t.as<{ p: Record<string, unknown> | null }>(minami, `select public.check_cover($1, 'middle', 'absence', null, $2) as p`, [day22, name])
    const [visa] = await check('ヒガシ') // 28 h already + 6 h
    expect(visa!.p).toMatchObject({ problem: 'visa', name: 'ヒガシ', minutes: 2040 })
    expect((await check('ミナミ'))[0]!.p).toMatchObject({ problem: 'self' })
    expect((await check('だれか'))[0]!.p).toMatchObject({ problem: 'unknown' })
    await t.admin(`insert into public.staff_roster (name) values ('キタ') on conflict do nothing`)
    expect((await check('キタ'))[0]!.p).toBeNull()
    await expect(t.as(minami, report(`'absence', '${day22}', 'middle', 'personal', p_cover => 'ヒガシ'`))).rejects.toThrow(/cover_problem:.*visa/)
  })
  it('naming creates a pending request; the named person sees it; a manager approves', async () => {
    const [r] = await t.as<{ id: string }>(minami, report(`'absence', '${day22}', 'middle', 'personal', p_cover => 'キタ', p_recruit => true`))
    const [c] = await t.admin<{ proposed_cover: string; recruit: boolean }>(`select proposed_cover, recruit from public.shift_changes where id = $1`, [r!.id])
    expect(c).toEqual({ proposed_cover: 'キタ', recruit: false })
    const rec = await t.as<{ id: string; designated: boolean }>(kita, `select id, designated from public.shift_recruits() where id = $1`, [r!.id])
    expect(rec).toEqual([{ id: r!.id, designated: true }])
    await expect(t.as(manager, `select public.decide_shift_change($1, true, p_cover => 'ヒガシ')`, [r!.id])).rejects.toThrow(/cover_problem:.*visa/)
    await t.as(manager, `select public.decide_shift_change($1, true, p_cover => 'キタ')`, [r!.id])
    expect((await who(day22, 'middle')).map((x) => x.roster_name)).toEqual(['キタ'])
  })
  it('「代われます」 is refused when it would take a visa holder over 28 h', async () => {
    await assign('キタ', day22, 'late', 1380, 1860)
    const [r] = await t.as<{ id: string }>(kita, report(`'absence', '${day22}', 'late', 'sick', p_recruit => true`))
    const [rec] = await t.as<{ my_over_min: number | null }>(higashi, `select my_over_min from public.shift_recruits() where id = $1`, [r!.id])
    expect(rec!.my_over_min).toBe(2160)
    await expect(t.as(higashi, `select public.offer_shift_cover($1)`, [r!.id])).rejects.toThrow(/cover_problem:.*visa/)
  })
})

describe('出勤可能 people for naming', () => {
  it('lists people who marked the shift in シフト希望 but are not scheduled, with problems', async () => {
    const [r] = await t.admin<{ d: string; m: string }>(`select (${TODAY} + 26)::text as d, date_trunc('month', ${TODAY} + 26)::date::text as m`)
    const d = r!.d
    await assign('ミナミ', d, 'early', 420, 1020)
    await assign('ヒガシ', d, 'late', 1380, 1860)
    const req = (user: string, days: object) =>
      t.admin(`insert into public.shift_requests (user_id, month, shifts, days) values ($1, $2, '{early}', $3)
               on conflict (user_id, month) do update set days = excluded.days`, [user, r!.m, JSON.stringify(days)])
    await req(kita, { [d]: { early: 'morning' } })
    await req(higashi, { [d]: { early: 'full', early_until_1730: true } })
    await req(manager, { [d]: { middle: 'ok' } }) // another shift only
    const rows = await t.as<{ roster_name: string; choice: string; until_1730: boolean; problem: unknown }>(
      minami,
      `select roster_name, choice, until_1730, problem from public.available_covers($1, 'early')`,
      [d],
    )
    expect(rows.map((x) => [x.roster_name, x.choice, x.until_1730])).toEqual([
      ['キタ', 'morning', false],
      ['ヒガシ', 'full', true],
    ])
    await expect(t.as(kita, `select * from public.available_covers($1, 'early')`, [d])).rejects.toThrow(/no such shift/)
  })
})

describe('未対応の連絡 reminders + test account', () => {
  let soon = ''
  it('a report still open 12 h / 3 h before the start is reminded once each', async () => {
    const [r] = await t.admin<{ d: string; m: number }>(
      `select (now() at time zone 'Asia/Tokyo' + interval '10 hours')::date::text as d,
              extract(hour from (now() at time zone 'Asia/Tokyo' + interval '10 hours'))::int * 60 as m`,
    )
    await t.admin(`insert into public.shift_assignments (month, business_date, shift, roster_name, store_mark, start_min, end_min, raw)
                   values (date_trunc('month', $1::date)::date, $1, 'late', 'キタ', '⑤', $2, $2 + 60, 'x')`, [r!.d, r!.m])
    const [c] = await t.as<{ id: string }>(kita, report(`'absence', '${r!.d}', 'late', 'sick', p_recruit => true`))
    soon = c!.id
    const reminders = () => t.admin<{ data: { hours: number } }>(`select data from public.notify_events where ref_id = $1 and data ->> 'event' = 'reminder'`, [soon])
    await t.admin(`select public.check_pending_changes()`)
    expect(await reminders()).toEqual([]) // just reported: the report mail is enough
    await t.admin(`update public.shift_changes set created_at = now() - interval '1 hour' where id = $1`, [soon])
    await t.admin(`select public.check_pending_changes()`)
    await t.admin(`select public.check_pending_changes()`)
    expect((await reminders()).map((x) => x.data.hours)).toEqual([12])
    // 2 h before the start → the 3-hour reminder
    // (computed afresh: moving the start back 8 h could cross midnight)
    const [r2] = await t.admin<{ d: string; m: number }>(
      `select (now() at time zone 'Asia/Tokyo' + interval '2 hours')::date::text as d,
              extract(hour from (now() at time zone 'Asia/Tokyo' + interval '2 hours'))::int * 60 as m`,
    )
    await t.admin(`update public.shift_assignments set business_date = $1, start_min = $2, end_min = $2 + 60 where raw = 'x'`, [r2!.d, r2!.m])
    await t.admin(`update public.shift_changes set business_date = $2, start_min = $3, end_min = $3 + 60 where id = $1`, [soon, r2!.d, r2!.m])
    await t.admin(`select public.check_pending_changes()`)
    expect((await reminders()).map((x) => x.data.hours)).toEqual([12, 3])
  })
  it('a test account: own reports are test records, cannot offer on real ones nor approve, purged at night', async () => {
    const tester = await t.createUser('tester@example.com', { display_name: 'テスト' })
    await t.admin(`update public.profiles set status = 'active', role = 'manager', is_test_account = true, roster_name = 'テスト用' where id = $1`, [tester])
    const [r] = await t.admin<{ d: string }>(`select (${TODAY} + 30)::text as d`)
    await assign('テスト用', r!.d, 'early', 420, 1020)
    await assign('ミナミ', r!.d, 'middle', 1020, 1380)
    const [own] = await t.as<{ id: string }>(tester, report(`'absence', '${r!.d}', 'early', 'sick', p_recruit => true`))
    expect((await t.admin<{ is_test: boolean }>(`select is_test from public.shift_changes where id = $1`, [own!.id]))[0]!.is_test).toBe(true)
    const [real] = await t.as<{ id: string }>(minami, report(`'absence', '${r!.d}', 'middle', 'sick', p_recruit => true`))
    await expect(t.as(tester, `select public.offer_shift_cover($1)`, [real!.id])).rejects.toThrow(/read only/)
    await expect(t.as(tester, `select public.decide_shift_change($1, false)`, [real!.id])).rejects.toThrow(/read only/)
    await expect(t.as(tester, `insert into public.staff_limits (roster_name, visa) values ('キタ', 'student') on conflict (roster_name) do update set visa = 'student'`)).rejects.toThrow(/read only/)
    expect(await t.as(minami, `select id from public.shift_recruits() where id = $1`, [own!.id])).toEqual([])
    await t.admin(`select public.purge_test_account_data()`)
    expect(await t.admin(`select id from public.shift_changes where id = $1`, [own!.id])).toEqual([])
    expect(await t.admin(`select id from public.shift_changes where id = $1`, [real!.id])).toHaveLength(1)
  })
})

describe('test accounts are invisible to real users', () => {
  it('profiles, directory, schedule, duties, requests, reports: only test accounts see them; nightly copy of the schedule', async () => {
    const [tester] = await t.admin<{ id: string }>(`select id from public.profiles where is_test_account`)
    const tid = tester!.id
    const [r] = await t.admin<{ d: string; m: string }>(`select (${TODAY} + 31)::text as d, date_trunc('month', ${TODAY} + 31)::date::text as m`)
    await assign('テスト用', r!.d, 'middle', 1020, 1380)
    await t.admin(`insert into public.duty_assignments (business_date, shift, store_id, roster_name, kind, time_mode, start_min, end_min, method)
                   values ($1, 'middle', (select id from public.stores where code = 'sennichimae'), 'テスト用', 'patrol', 'during', 1020, 1380, 'own')`, [r!.d])
    await t.admin(`insert into public.shift_requests (user_id, month, shifts, days) values ($1, $2, '{early}', '{}')`, [tid, r!.m])
    const [rep] = await t.as<{ id: string }>(tid, report(`'absence', '${r!.d}', 'middle', 'sick'`))
    const seen = async (user: string) => ({
      profile: (await t.as(user, `select id from public.profiles where id = $1`, [tid])).length,
      directory: (await t.as(user, `select id from public.staff_directory() where id = $1`, [tid])).length,
      shifts: (await t.as(user, `select id from public.shift_assignments where roster_name = 'テスト用'`)).length,
      duties: (await t.as(user, `select id from public.duty_assignments where roster_name = 'テスト用'`)).length,
      requests: (await t.as(user, `select id from public.shift_requests where user_id = $1`, [tid])).length,
      changes: (await t.as(user, `select id from public.shift_changes where id = $1`, [rep!.id])).length,
    })
    expect(await seen(manager)).toEqual({ profile: 0, directory: 0, shifts: 0, duties: 0, requests: 0, changes: 0 })
    expect(await seen(minami)).toEqual({ profile: 0, directory: 0, shifts: 0, duties: 0, requests: 0, changes: 0 })
    const own = await seen(tid)
    expect(own.profile && own.directory && own.shifts && own.duties && own.requests && own.changes).toBeTruthy()
    // approve its own test absence (no replacement): its own schedule row goes away
    await t.as(tid, `select public.decide_shift_change($1, true)`, [rep!.id])
    expect(await t.admin(`select id from public.shift_assignments where roster_name = 'テスト用' and business_date = $1`, [r!.d])).toEqual([])
    // nightly: the test schedule is a fresh copy of ミナミ's
    await t.admin(`insert into public.test_shadows values ('テスト用', 'ミナミ')`)
    await t.admin(`select public.purge_test_account_data()`)
    const [cnt] = await t.admin<{ a: number; b: number }>(
      `select (select count(*)::int from public.shift_assignments where roster_name = 'テスト用') as a,
              (select count(*)::int from public.shift_assignments where roster_name = 'ミナミ') as b`,
    )
    expect(cnt!.a).toBe(cnt!.b)
  })
})

describe('システム状態', () => {
  it('managers only; counts mails of today and stuck notifications', async () => {
    await expect(t.as(minami, `select public.system_status()`)).rejects.toThrow(/managers only/)
    await t.admin(`insert into public.mail_log (kind, mails) values ('sales', 3), ('digest', 2)`)
    await t.admin(`insert into public.mail_log (kind, mails, sent_at) values ('sales', 50, now() - interval '2 days')`)
    const [r] = await t.as<{ s: { mails_today: number; mails_by_kind: Record<string, number>; jobs: unknown[] } }>(manager, `select public.system_status() as s`)
    expect(r!.s.mails_today).toBe(5)
    expect(r!.s.mails_by_kind).toEqual({ sales: 3, digest: 2 })
    expect(r!.s.jobs).toEqual([])
  })

  it('lists who has files waiting more than 1 hour', async () => {
    const [st] = await t.admin<{ id: string }>(`select id from public.stores where code = 'midosuji'`)
    const [inc] = await t.as<{ id: string }>(minami, `select public.report_incident($1, ${TODAY}, 'middle', now(), 'other', 'x') as id`, [st!.id])
    await t.admin(
      `insert into public.attachments (owner_id, incident_id, kind, file_name, mime_type, size_bytes, created_at)
       values ($1, $2, 'image', 'old.jpg', 'image/jpeg', 2048, now() - interval '2 hours'), ($1, $2, 'image', 'new.jpg', 'image/jpeg', 10, now())`,
      [minami, inc!.id],
    )
    const [r] = await t.as<{ s: { uploads_pending: number; uploads_pending_list: { name: string; kind: string; size: number }[] } }>(manager, `select public.system_status() as s`)
    expect(r!.s.uploads_pending).toBe(1)
    expect(r!.s.uploads_pending_list).toEqual([expect.objectContaining({ name: 'ミナミ', kind: 'image', size: 2048 })])
  })
})

describe('クレーム・事故', () => {
  it('any staff records; managers handle; urgent kinds mail at once; others cannot read it', async () => {
    const [st] = await t.admin<{ id: string }>(`select id from public.stores where code = 'midosuji'`)
    const rep = (user: string, kind: string) =>
      t.as<{ id: string }>(user, `select public.report_incident($1, ${TODAY}, 'middle', now(), $2, 'スープがぬるい', '作り直した') as id`, [st!.id, kind])
    const [a] = await rep(minami, 'complaint')
    const [b] = await rep(minami, 'foreign_object')
    const ev = await t.admin<{ ref_id: string; urgent: boolean }>(`select ref_id, urgent from public.notify_events where kind = 'incident' order by id`)
    expect(ev.map((e) => [e.ref_id, e.urgent])).toEqual([[a!.id, false], [b!.id, true]])
    expect(await t.as(kita, `select id from public.incidents`)).toEqual([])
    expect(await t.as(minami, `select id from public.incidents`)).toHaveLength(2)
    await expect(t.as(minami, `update public.incidents set status = 'done' where id = $1 returning id`, [a!.id])).resolves.toEqual([])
    // handled through the workflow (stage 3): the steps up to 完了 with 再発防止
    let v = 1
    const handling = JSON.stringify({ resolution: '温度確認', prevention: '提供前に確認' })
    for (let k = 0; k < 5; k++) v = (await t.as<{ v: number }>(manager, `select public.incident_act($1, 'advance', $2, null, null, null, $3) as v`, [a!.id, v, handling]))[0]!.v
    const [row] = await t.admin<{ resolved: boolean }>(`select resolved_at is not null as resolved from public.incidents where id = $1`, [a!.id])
    expect(row!.resolved).toBe(true)
    // managers may correct the report since 20261016000002; who reported stays
    await expect(t.as(manager, `update public.incidents set reporter_name = 'x' where id = $1`, [a!.id])).rejects.toThrow(/reporter/)
    await expect(t.as(minami, `select public.report_incident($1, ${TODAY}, 'middle', now() - interval '20 days', 'other', 'x')`, [st!.id])).rejects.toThrow(/time out of range/)
  })
})

describe('AIレポート report_data', () => {
  it('managers only; sums of sales, patrols, 朝礼, attendance, incidents of the period', async () => {
    await expect(t.as(minami, `select public.report_data(${TODAY} - 7, ${TODAY})`)).rejects.toThrow(/managers only/)
    const [r] = await t.as<{ d: Record<string, Record<string, unknown>> }>(manager, `select public.report_data(${TODAY} - 7, ${TODAY} + 40) as d`)
    expect(Object.keys(r!.d)).toEqual(expect.arrayContaining(['sales', 'patrol', 'chorei', 'attendance', 'stock', 'incidents']))
    expect(r!.d.incidents!.by_kind).toMatchObject({ complaint: 1, foreign_object: 1 })
    expect(Number(r!.d.attendance!.absence)).toBeGreaterThan(0)
  })
})
