// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

// Files that did not arrive (migration 20261019000002): the sender's app reports what it holds, managers close or nudge,
// 48 hours closes by itself; 'lost' is not a problem in システム.
let t: TestDb
let manager: string
let kita: string
let minami: string
let inc = ''

const TODAY = `(now() at time zone 'Asia/Tokyo')::date`
const file = async (owner: string, name: string, age: string) =>
  (
    await t.admin<{ id: string }>(
      `insert into public.attachments (owner_id, incident_id, kind, file_name, mime_type, size_bytes, created_at)
       values ($1, $2, 'image', $3, 'image/jpeg', 10, now() - $4::interval) returning id`,
      [owner, inc, name, age],
    )
  )[0]!.id
const state = (id: string) =>
  t.admin<{ status: string; lost_reason: string | null; seen: boolean }>(
    `select status, lost_reason, device_seen_at is not null as seen from public.attachments where id = $1`,
    [id],
  ).then((r) => r[0])
const status = () => t.as<{ s: Record<string, any> }>(manager, `select public.system_status() as s`).then((r) => r[0]!.s) // eslint-disable-line @typescript-eslint/no-explicit-any

beforeAll(async () => {
  t = await createTestDb()
  await t.admin(`insert into public.bootstrap_accounts (email, role) values ('boss@example.com', 'manager')`)
  manager = await t.createUser('boss@example.com')
  kita = await t.createUser('kita@example.com', { display_name: 'キタ' })
  minami = await t.createUser('minami@example.com', { display_name: 'ミナミ' })
  await t.admin(`update public.profiles set status = 'active' where id in ($1, $2)`, [kita, minami])
  const [store] = await t.admin<{ id: string }>(`select id from public.stores where code = 'sennichimae'`)
  ;[{ id: inc }] = await t.as<{ id: string }>(kita, `select public.report_incident($1, ${TODAY}, 'middle', now(), 'other', 'x') as id`, [store!.id])
}, 60_000)

describe('files that did not arrive', () => {
  it('the app reports what it holds: the others (waiting > 10 minutes) are lost from the phone', async () => {
    const held = await file(kita, 'held.jpg', '3 hours')
    const gone = await file(kita, 'gone.jpg', '3 hours')
    const justNow = await file(kita, 'now.jpg', '1 minute') // registered a moment ago: maybe not saved yet
    const other = await file(minami, 'other.jpg', '3 hours') // another sender: untouched
    const [r] = await t.as<{ n: number }>(kita, `select public.report_upload_holdings($1::uuid[]) as n`, [[held]])
    expect(r!.n).toBe(1)
    expect(await state(held)).toEqual({ status: 'pending', lost_reason: null, seen: true })
    expect(await state(gone)).toEqual({ status: 'lost', lost_reason: 'device', seen: false })
    expect((await state(justNow))!.status).toBe('pending')
    expect((await state(other))!.status).toBe('pending')

    const s = await status()
    // pending > 1 hour: held + other; the lost one is listed apart and is not counted as waiting
    expect(s.uploads_pending).toBe(2)
    expect(s.uploads_pending_list.map((u: { name: string; seen: string | null; parent: string; push: boolean }) => [u.name, Boolean(u.seen), u.parent, u.push])).toEqual([
      ['キタ', true, 'incident', false],
      ['ミナミ', false, 'incident', false],
    ])
    expect(s.uploads_lost_list).toEqual([expect.objectContaining({ name: 'キタ', reason: 'device', parent: 'incident' })])
  })

  it('managers close a waiting file or nudge its sender; staff cannot', async () => {
    const id = await file(minami, 'wait.jpg', '2 hours')
    await expect(t.as(kita, `select public.close_pending_upload($1)`, [id])).rejects.toThrow(/managers only/)
    await expect(t.as(kita, `select public.nudge_upload_owner($1)`, [minami])).rejects.toThrow(/managers only/)
    // no phone with notifications: nothing to send
    expect((await t.as<{ ok: boolean }>(manager, `select public.nudge_upload_owner($1) as ok`, [minami]))[0]!.ok).toBe(false)
    await t.as(minami, `select public.save_push_subscription('https://push.example.com/m', 'p', 'a')`)
    expect((await t.as<{ ok: boolean }>(manager, `select public.nudge_upload_owner($1) as ok`, [minami]))[0]!.ok).toBe(true)
    expect(await t.admin(`select user_id, kind, urgent from public.push_queue`)).toEqual([{ user_id: minami, kind: 'upload', urgent: true }])
    await t.as(manager, `select public.close_pending_upload($1)`, [id])
    expect(await state(id)).toEqual({ status: 'lost', lost_reason: 'manager', seen: false })
  })

  it('a file still waiting after 48 hours is closed by itself', async () => {
    const old = await file(kita, 'old.jpg', '49 hours')
    const young = await file(kita, 'young.jpg', '47 hours')
    await t.admin(`select public.expire_pending_uploads()`)
    expect((await state(old))!.lost_reason).toBe('expired')
    expect((await state(young))!.status).toBe('pending')
  })
})
