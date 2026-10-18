// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// Web push (migrations 20261018000001 / 02): subscriptions per phone, push_queue rows written by events.
let t: TestDb
let manager: string
let minami: string // ミナミ (reports)
let kita: string // キタ (free → gets 代わり募集)
let higashi: string // ヒガシ (works that shift → not asked)
let nishi: string // ニシ (free, but no phone subscribed)
let tester: string // テスト用 (test account)
let store = ''
let d3 = ''

const TODAY = `(now() at time zone 'Asia/Tokyo')::date`
const sub = (user: string, n: string) =>
  t.as(user, `select public.save_push_subscription($1, 'p256dh-key', 'auth-key', 'test-ua')`, [`https://push.example.com/${n}`])
type Q = { user_id: string; kind: string; data: Record<string, any>; url: string } // eslint-disable-line @typescript-eslint/no-explicit-any
const queue = () => t.admin<Q>(`select user_id, kind, data, url from public.push_queue order by id`)
const clear = () => t.admin(`delete from public.push_queue`)
const kinds = (rows: Q[]) => rows.map((r) => [r.user_id, r.kind])

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
  store = (await t.admin<{ id: string }>(`select id from public.stores where code = 'midosuji'`))[0]!.id
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

  it('代わり募集 → people free at that time; managers get report and offer; the approval tells both and lists the shift changes', async () => {
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
    expect(kinds(after)).toEqual([
      [minami, 'decided'],
      [kita, 'assigned'],
      [kita, 'schedule'],
      [minami, 'schedule'],
    ])
    expect(after[0]!.data).toMatchObject({ ok: true, cover: 'キタ' })
    expect(after[2]!.data).toEqual({ n: 1, items: [{ date: d3, shift: 'early', kind: 'added', detail: '7:00–17:00' }] })
    expect(after[3]!.data).toEqual({ n: 1, items: [{ date: d3, shift: 'early', kind: 'removed', detail: '' }] })
    await clear()
  })

  it('指名: the named person must answer before a manager can approve; each answer is pushed', async () => {
    await assign('ミナミ', d3, 'middle', 1020, 1380)
    const [c] = await t.as<{ id: string }>(minami, `select public.report_shift_change('absence', $1, 'middle', 'sick', p_cover => 'ヒガシ') as id`, [d3])
    const rows = await queue()
    expect(rows.filter((r) => r.kind !== 'mgr_change').map((r) => [r.user_id, r.kind])).toEqual([[higashi, 'named']])
    expect(rows.find((r) => r.kind === 'mgr_change')!.data).toMatchObject({ event: 'report', named: 'ヒガシ', consent: 'pending' })
    await clear()
    await expect(t.as(manager, `select public.decide_shift_change($1, true, p_cover => 'ヒガシ')`, [c!.id])).rejects.toThrow(/waiting for the named person/)
    await t.as(higashi, `select public.respond_cover_request($1, true)`, [c!.id])
    const answered = await queue()
    expect(answered.map((r) => [r.user_id, r.kind, r.kind === 'consent' ? r.data.ok : r.data.event])).toEqual([
      [minami, 'consent', true],
      [manager, 'mgr_change', 'accepted'],
    ])
    await clear()
    await t.as(manager, `select public.decide_shift_change($1, true, p_cover => 'ヒガシ')`, [c!.id])
    expect(kinds(await queue())).toEqual([
      [minami, 'decided'],
      [higashi, 'assigned'],
      [higashi, 'schedule'],
      [minami, 'schedule'],
    ])
    await clear()
  })

  it('指名 declined: the reporter and the managers are told; the manager cannot approve with that person', async () => {
    await assign('ミナミ', d3, 'late', 1380, 1860)
    const [c] = await t.as<{ id: string }>(minami, `select public.report_shift_change('absence', $1, 'late', 'sick', p_cover => 'キタ') as id`, [d3])
    await clear()
    await t.as(kita, `select public.respond_cover_request($1, false, '用事があります')`, [c!.id])
    expect((await queue()).map((r) => [r.user_id, r.kind, r.kind === 'consent' ? r.data.ok : r.data.event, r.data.note ?? null])).toEqual([
      [minami, 'consent', false, '用事があります'],
      [manager, 'mgr_change', 'declined', '用事があります'],
    ])
    await expect(t.as(manager, `select public.decide_shift_change($1, true, p_cover => 'キタ')`, [c!.id])).rejects.toThrow(/declined/)
    await clear()
    await t.as(manager, `select public.decide_shift_change($1, false, p_note => 'ほかの人に頼みます')`, [c!.id])
    expect((await queue()).map((r) => [r.user_id, r.kind, r.data.ok])).toEqual([[minami, 'decided', false]])
    await clear()
  })

  it('シフトが変わりました after an import: each person their own future changes', async () => {
    await t.admin(
      `insert into public.shift_import_log (month, source, rows, changes, n_changes) values (date_trunc('month', $1::date)::date, 'office365', '[]', $2, 3)`,
      [
        d3,
        JSON.stringify([
          { date: d3, shift: 'middle', name: 'キタ', kind: 'added', before: null, after: '⑤17-23' },
          { date: d3, shift: 'late', name: 'キタ', kind: 'removed', before: '⑤23-7', after: null },
          { date: '2020-01-01', shift: 'early', name: 'ミナミ', kind: 'added', before: null, after: '①7-17' },
        ]),
      ],
    )
    const rows = await queue()
    expect(kinds(rows)).toEqual([[kita, 'schedule']])
    expect(rows[0]!.data).toEqual({
      n: 2,
      items: [
        { date: d3, shift: 'middle', kind: 'added', detail: '⑤17-23' },
        { date: d3, shift: 'late', kind: 'removed', detail: '' },
      ],
    })
    await clear()
  })

  it('管理者のコメント on my 朝礼 reaches me', async () => {
    const [rec] = await t.as<{ id: string }>(kita, `insert into public.chorei_records (store_id, business_date, shift, stock_none) values ($1, ${TODAY}, 'early', true) returning id`, [store])
    await clear()
    await t.as(manager, `select public.add_chorei_comment($1, 'よくできました')`, [rec!.id])
    const rows = await queue()
    expect(kinds(rows)).toEqual([[kita, 'comment']])
    expect(rows[0]).toMatchObject({ url: '/history', data: { what: 'chorei', shift: 'early', body: 'よくできました' } })
    await clear()
  })

  it('クレーム・事故: managers get new reports; the reporter and the assignee get each step and comment', async () => {
    const [inc] = await t.as<{ id: string }>(minami, `select public.report_incident($1, ${TODAY}, 'middle', now(), 'complaint', 'スープがぬるい') as id`, [store])
    expect((await queue()).map((r) => [r.user_id, r.kind, r.data.kind, r.data.event])).toEqual([[manager, 'mgr_incident', 'complaint', 'created']])
    await clear()
    const act = (who: string, action: string, version: number, body: string | null = null, data: object = {}) =>
      t.as<{ v: number }>(who, `select public.incident_act($1, $2, $3, $4, null, null, $5) as v`, [inc!.id, action, version, body, JSON.stringify(data)])
    const v = (await act(manager, 'advance', 1))[0]!.v
    const rows = await queue()
    expect(kinds(rows)).toEqual([[minami, 'inc_step']])
    expect(rows[0]).toMatchObject({ url: `/incident?tab=wf&open=${inc!.id}`, data: { kind: 'complaint', event: 'state', to: 'content_check' } })
    await clear()
    await act(manager, 'comment', v, 'お客様に電話しました')
    expect((await queue()).map((r) => [r.user_id, r.data.event, r.data.body])).toEqual([[minami, 'comment', 'お客様に電話しました']])
    await clear()
  })

  it('忘れ物: the finder gets each step', async () => {
    const [li] = await t.as<{ id: string }>(
      kita,
      `select public.report_lost_item($1, now() - interval '1 hour', '黒い傘', '入口', 'レジ下', $2, '山田', '090-0000-0000') as id`,
      [store, 'customer'],
    )
    await clear()
    await t.as(manager, `select public.manage_lost_item($1, 'dispose', '保管期間が過ぎたため')`, [li!.id])
    const rows = await queue()
    expect(kinds(rows)).toEqual([[kita, 'lost_step']])
    expect(rows[0]).toMatchObject({ url: `/lost-items?open=${li!.id}`, data: { desc: '黒い傘', action: 'dispose' } })
    await clear()
  })

  it('シフト希望: on the 15th / 18th / 20th, people who have not sent next month', async () => {
    const [{ day }] = (await t.admin<{ day: number }>(`select extract(day from ${TODAY})::int as day`)) as [{ day: number }]
    await t.admin(`select public.queue_shift_request_reminders()`)
    const rows = await queue()
    if (![15, 18, 20].includes(day)) expect(rows).toEqual([])
    // テスト用 (test account) and the manager (no shift-table name) are never reminded
    else expect(rows.map((r) => r.user_id).sort()).toEqual([minami, kita, higashi].sort())
    await clear()
  })

  it('送れていない写真・動画: reminds the sender at most once per 6 hours', async () => {
    const [inc] = await t.as<{ id: string }>(kita, `select public.report_incident($1, ${TODAY}, 'middle', now(), 'other', 'x') as id`, [store])
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
