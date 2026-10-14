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
