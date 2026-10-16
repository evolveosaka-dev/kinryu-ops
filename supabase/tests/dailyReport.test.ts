// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// Migration 20261017000005: AI日報 — daily_report_data() collects one business day (朝礼, 巡回, 休み連絡, クレーム事故)
// and the cases still open from earlier days, for managers only, without test data.

const DAY = `(now() at time zone 'Asia/Tokyo')::date - 1`
let t: TestDb
let store: string
let manager: string
let staff: string
let tester: string

interface Slot {
  store: string
  shift: string
  chorei: { leader: string; participants: string[]; caution: string; comments: { by: string; body: string }[] } | null
  chorei_missed: { kind: string; reason: string } | null
  patrols: { patroller: string; staff: string[]; good_points: string; improvements: string; comments: { body: string }[] }[]
  incidents: { kind: string }[]
}
const report = async (who: string) =>
  (await t.as<{ d: { slots: Slot[]; open_cases: { kind: string; days_open: number }[] } }>(who, `select public.daily_report_data(${DAY}) as d`))[0]!.d

beforeAll(async () => {
  t = await createTestDb()
  store = (await t.admin<{ id: string }>(`select id from public.stores where code = 'midosuji'`))[0]!.id
  await t.admin(`insert into public.bootstrap_accounts (email, role) values ('boss@example.com', 'manager')`)
  manager = await t.createUser('boss@example.com', { display_name: '店長' })
  staff = await t.createUser('staff@example.com', { display_name: 'スタッフ' })
  tester = await t.createUser('kt@example.com', { display_name: 'テスト' })
  await t.admin(`update public.profiles set status = 'active', full_name = '山田 花子', can_patrol = true where id = $1`, [staff])
  await t.admin(`update public.profiles set status = 'active', role = 'manager', is_test_account = true where id = $1`, [tester])

  const [c] = await t.admin<{ id: string }>(
    `insert into public.chorei_records (store_id, business_date, shift, leader_id, participants, participants_extra, stock_none, caution_text)
     values ($1, ${DAY}, 'early', $2, array[$2, $3]::uuid[], array['ヘルプ'], true, '声出しを大きく') returning id`,
    [store, staff, manager],
  )
  await t.as(manager, `select public.add_chorei_comment($1, 'よくできました')`, [c!.id])
  await t.admin(
    `insert into public.chorei_misses (store_id, business_date, shift, kind, reason, reporter_id) values ($1, ${DAY}, 'middle', 'missed', 'busy', $2)`,
    [store, staff],
  )
  await t.admin(
    `insert into public.patrol_checks (patroller_id, store_id, business_date, shift, patrol_type, started_at, ended_at,
       score_smile, score_voice, score_grooming, score_clean, score_quality, good_points, improvements, staff_names, status)
     values ($1, $2, ${DAY}, 'early', 'in_shift', now() - interval '1 day', now() - interval '1 day' + interval '10 minutes',
       5, 3, 4, 4, null, '笑顔が良い', '声が小さい → その場で伝えた', array['グエン'], 'valid')`,
    [staff, store],
  )
  // a test account's patrol on the same slot must not show
  await t.admin(
    `insert into public.patrol_checks (patroller_id, store_id, business_date, shift, patrol_type, started_at, ended_at,
       score_smile, score_voice, score_grooming, score_clean, good_points, improvements, staff_names, status, by_test_account)
     values ($1, $2, ${DAY}, 'early', 'in_shift', now() - interval '1 day', now() - interval '1 day' + interval '5 minutes',
       1, 1, 1, 1, 'x', 'x', array['テスト'], 'valid', true)`,
    [tester, store],
  )
  await t.as(staff, `select public.report_incident($1, ${DAY}, 'late', now() - interval '20 hours', 'complaint', '麺がぬるい')`, [store])
  await t.as(staff, `select public.report_incident($1, ${DAY} - 3, 'early', now() - interval '4 days', 'equipment', '製麺機')`, [store])
}, 60_000)

describe('AI日報 data', () => {
  it('managers only', async () => {
    await expect(report(staff)).rejects.toThrow(/managers only/)
  })

  it('one business day: 朝礼 leader / participants / comments, 未実施 reason, patrols with who and what, incidents', async () => {
    const d = await report(manager)
    const mido = d.slots.filter((s) => s.store === '御堂筋店')
    expect(mido.map((s) => s.shift)).toEqual(['early', 'middle', 'late'])
    const [early, middle, late] = mido
    expect(early!.chorei).toMatchObject({ leader: '山田 花子', participants: ['店長', 'ヘルプ'], caution: '声出しを大きく' })
    expect(early!.chorei!.comments.map((c) => c.body)).toEqual(['よくできました'])
    expect(early!.patrols).toHaveLength(1)
    expect(early!.patrols[0]).toMatchObject({ patroller: '山田 花子', staff: ['グエン'], good_points: '笑顔が良い' })
    expect(middle!.chorei).toBeNull()
    expect(middle!.chorei_missed).toMatchObject({ kind: 'missed', reason: 'busy' })
    expect(late!.incidents.map((i) => i.kind)).toEqual(['complaint'])
  })

  it('cases from earlier days that are still open', async () => {
    const d = await report(manager)
    expect(d.open_cases.map((o) => [o.kind, o.days_open])).toEqual([['equipment', 3]])
  })

  it('ai_reports accepts the daily kind', async () => {
    await t.admin(`insert into public.ai_reports (kind, period_from, period_to, data, summary) values ('daily', ${DAY}, ${DAY}, '{}', 'x')`)
    expect(await t.as(manager, `select kind from public.ai_reports`)).toEqual([{ kind: 'daily' }])
  })
})
