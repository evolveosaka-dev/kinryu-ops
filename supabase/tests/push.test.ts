// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// Web push (migration 20261018000001): subscriptions per phone, push_queue rows written by events.
let t: TestDb
let manager: string
let minami: string // ミナミ (reports)
let kita: string // キタ (free → gets 代わり募集)
let higashi: string // ヒガシ (works that shift → not asked)
let nishi: string // ニシ (free, but no phone subscribed)
let tester: string // テスト用 (test account)
let d3 = ''

const TODAY = `(now() at time zone 'Asia/Tokyo')::date`
const sub = (user: string, n: string) =>
  t.as(user, `select public.save_push_subscription($1, 'p256dh-key', 'auth-key', 'test-ua')`, [`https://push.example.com/${n}`])
const queue = () =>
  t.admin<{ user_id: string; kind: string; data: Record<string, unknown>; url: string }>(`select user_id, kind, data, url from public.push_queue order by id`)
const clear = () => t.admin(`delete from public.push_queue`)

async function assign(name: string, date: string, shift: string, start: number, end: number) {
  await t.admin(
    `insert into public.shift_assignments (month, business_date, shift, roster_name, store_mark, store_id, start_min, end_min, raw)
     values (date_trunc('month', $1::date)::date, $1, $2, $3, '⑤', (select id from public.stores where code = 'sennichimae'), $4, $5, 'x')`,
    [date, shift, name, start, end],
  )
}

beforeAll(async () => {
  t = await createTestDb()
  await t.admin(`insert into public.bootstrap_accounts (email, role) values ('boss@example.com', 'manager')`)
  manager = await t.createUser('boss@example.com')
  minami = await t.createUser('minami@example.com', { display_name: 'ミナミ' })
  kita = await t.createUser('kita@example.com', { display_name: 'キタ' })
  higashi = await t.createUser('higashi@example.com', { display_name: 'ヒガシ' })
  nishi = await t.createUser('nishi@example.com', { display_name: 'ニシ' })
  tester = await t.createUser('tester@example.com', { display_name: 'テスト用' })
  for (const [id, name] of [
    [minami, 'ミナミ'],
    [kita, 'キタ'],
    [higashi, 'ヒガシ'],
    [nishi, 'ニシ'],
    [tester, 'テスト用'],
  ] as const)
    await t.admin(`update public.profiles set status = 'active', roster_name = $2 where id = $1`, [id, name])
  await t.admin(`update public.profiles set is_test_account = true where id = $1`, [tester])
  await t.admin(`insert into public.staff_roster (name) values ('ミナミ'), ('キタ'), ('ヒガシ'), ('ニシ'), ('テスト用')`)
  const [row] = await t.admin<{ d3: string }>(`select (${TODAY} + 3)::text as d3`)
  d3 = row!.d3
  await assign('ミナミ', d3, 'early', 420, 1020)
  await assign('ヒガシ', d3, 'early', 420, 1020)
}, 60_000)

describe('web push', () => {
  it('a phone is saved under the signed-in person; each person sees only their own phones', async () => {
    for (const [u, n] of [
      [manager, 'boss'],
      [minami, 'minami'],
      [kita, 'kita'],
      [higashi, 'higashi'],
      [tester, 'tester'],
    ] as const)
      await sub(u, n)
    await expect(t.as(kita, `select public.save_push_subscription('http://bad', 'a', 'b')`)).rejects.toThrow(/bad subscription/)
    await expect(t.as(kita, `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://x', 'a', 'b')`, [kita])).rejects.toThrow()
    expect(await t.as(kita, `select endpoint from public.push_subscriptions`)).toEqual([{ endpoint: 'https://push.example.com/kita' }])
    await expect(t.as(kita, `select id from public.push_queue`)).rejects.toThrow(/permission denied/)
    // the same phone signed in as another person moves to them
    await sub(nishi, 'kita')
    expect(await t.admin(`select user_id from public.push_subscriptions where endpoint = 'https://push.example.com/kita'`)).toEqual([{ user_id: nishi }])
    await sub(kita, 'kita')
    expect(await t.as(nishi, `select endpoint from public.push_subscriptions`)).toEqual([])
  })

  it('テスト通知 goes to my phones (also for a test account)', async () => {
    await t.as(tester, `select public.send_test_push()`)
    await expect(t.as(nishi, `select public.send_test_push()`)).rejects.toThrow(/no subscription/)
    expect(await queue()).toEqual([{ user_id: tester, kind: 'test', data: {}, url: '/profile' }])
    await clear()
  })

  it('代わり募集 goes to people free at that time with a phone; managers get the report, the offer and the result', async () => {
    const [c] = await t.as<{ id: string }>(minami, `select public.report_shift_change('absence', $1, 'early', 'family', '法事', p_recruit => true) as id`, [d3])
    const rows = await queue()
    // キタ: free + phone. ヒガシ works that 早番, ニシ has no phone, テスト用 is a test account, ミナミ reported it.
    expect(rows.filter((r) => r.kind === 'recruit').map((r) => r.user_id)).toEqual([kita])
    expect(rows.find((r) => r.kind === 'recruit')!.data).toMatchObject({ name: 'ミナミ', kind: 'absence', date: d3, shift: 'early', from: 420, to: 1020 })
    expect(rows.filter((r) => r.kind === 'mgr_change').map((r) => [r.user_id, r.data.event, r.url])).toEqual([[manager, 'report', '/manager/attendance']])

    await clear()
    const [o] = await t.as<{ id: string }>(kita, `select public.offer_shift_cover($1) as id`, [c!.id])
    expect((await queue()).map((r) => [r.kind, r.data.event, r.data.offer_name])).toEqual([['mgr_change', 'offer', 'キタ']])
    await clear()
    await t.as(manager, `select public.decide_shift_change($1, true, $2)`, [c!.id, o!.id])
    const after = await queue()
    expect(after.map((r) => [r.user_id, r.kind])).toEqual([
      [minami, 'decided'],
      [kita, 'assigned'],
    ])
    expect(after[0]!.data).toMatchObject({ ok: true, cover: 'キタ' })
    await clear()
  })

  it('指名 goes to the named person; a refusal tells the reporter', async () => {
    await assign('ミナミ', d3, 'middle', 1020, 1380)
    const [c] = await t.as<{ id: string }>(minami, `select public.report_shift_change('absence', $1, 'middle', 'sick', p_cover => 'ヒガシ') as id`, [d3])
    expect((await queue()).filter((r) => r.kind !== 'mgr_change').map((r) => [r.user_id, r.kind])).toEqual([[higashi, 'named']])
    await clear()
    await t.as(manager, `select public.decide_shift_change($1, false, p_note => 'ほかの人に頼みます')`, [c!.id])
    expect((await queue()).map((r) => [r.user_id, r.kind, r.data.ok])).toEqual([[minami, 'decided', false]])
    await clear()
  })

  it('クレーム・事故 and sign-ups go to the managers', async () => {
    const [st] = await t.admin<{ id: string }>(`select id from public.stores where code = 'midosuji'`)
    await t.as(minami, `select public.report_incident($1, ${TODAY}, 'middle', now(), 'injury', 'やけど')`, [st!.id])
    expect((await queue()).map((r) => [r.user_id, r.kind, r.data.kind, r.data.event])).toEqual([[manager, 'mgr_incident', 'injury', 'created']])
    await clear()
    await t.createUser('newcomer@kinryu.jp', { display_name: '新人' })
    expect((await queue()).map((r) => [r.user_id, r.kind])).toEqual([[manager, 'mgr_signup']])
    await clear()
  })

  it('送れていない写真・動画: reminds the sender at most once per 6 hours', async () => {
    const [st] = await t.admin<{ id: string }>(`select id from public.stores where code = 'midosuji'`)
    const [inc] = await t.as<{ id: string }>(kita, `select public.report_incident($1, ${TODAY}, 'middle', now(), 'other', 'x') as id`, [st!.id])
    await clear()
    await t.admin(
      `insert into public.attachments (owner_id, incident_id, kind, file_name, mime_type, size_bytes, created_at)
       values ($1, $2, 'video', 'a.mov', 'video/quicktime', 9000, now() - interval '2 hours'),
              ($1, $2, 'image', 'b.jpg', 'image/jpeg', 10, now() - interval '90 minutes'),
              ($1, $2, 'image', 'new.jpg', 'image/jpeg', 10, now())`,
      [kita, inc!.id],
    )
    const [jst] = await t.admin<{ h: number }>(`select extract(hour from now() at time zone 'Asia/Tokyo')::int as h`)
    await t.admin(`select public.queue_upload_reminders()`)
    await t.admin(`select public.queue_upload_reminders()`)
    // quiet before 9:00 JST
    expect(await queue()).toEqual(jst!.h < 9 ? [] : [{ user_id: kita, kind: 'upload', data: { n: 2 }, url: '/' }])
  })

  it('test accounts never get real events', async () => {
    await clear()
    await t.admin(`select public.queue_push($1, 'recruit', '{}', '/')`, [tester])
    expect(await queue()).toEqual([])
  })
})
