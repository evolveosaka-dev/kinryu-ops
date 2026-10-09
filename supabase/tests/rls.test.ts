// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

let t: TestDb
let midosuji: string
let sennichimae: string
let manager: string
let staffM: string // 御堂筋店
let staffS: string // 千日前店
let patroller: string // 千日前店
let pending: string

const TODAY = `(now() at time zone 'Asia/Tokyo')::date`

async function activate(id: string, store: string, extra = '') {
  await t.admin(`update public.profiles set status = 'active', home_store_id = $2 ${extra} where id = $1`, [id, store])
}

beforeAll(async () => {
  t = await createTestDb()
  const stores = await t.admin<{ id: string; code: string }>('select id, code from public.stores')
  midosuji = stores.find((s) => s.code === 'midosuji')!.id
  sennichimae = stores.find((s) => s.code === 'sennichimae')!.id

  await t.admin(`insert into public.bootstrap_accounts (email, role) values ('boss@example.com', 'manager')`)
  manager = await t.createUser('Boss@Example.com')
  staffM = await t.createUser('m@example.com', { display_name: 'スタッフM', locale: 'vi' })
  staffS = await t.createUser('s@example.com', { display_name: 'スタッフS' })
  patroller = await t.createUser('p@example.com', { display_name: 'パトロール' })
  pending = await t.createUser('new@example.com')
  await activate(staffM, midosuji)
  await activate(staffS, sennichimae)
  await activate(patroller, sennichimae, ', can_patrol = true')
}, 60_000)

describe('sign-up', () => {
  it('bootstrap e-mail becomes an active manager; others are pending staff', async () => {
    const rows = await t.admin<{ id: string; role: string; status: string; display_name: string; locale: string }>(
      'select id, role, status, display_name, locale from public.profiles',
    )
    expect(rows.find((r) => r.id === manager)).toMatchObject({ role: 'manager', status: 'active' })
    expect(rows.find((r) => r.id === pending)).toMatchObject({ role: 'staff', status: 'pending' })
    expect(rows.find((r) => r.id === staffM)).toMatchObject({ display_name: 'スタッフM', locale: 'vi' })
  })
})

describe('anon and pending users', () => {
  it('anon cannot read anything', async () => {
    await expect(t.as(null, 'select * from public.profiles')).rejects.toThrow(/permission denied/)
    await expect(t.as(null, 'select * from public.chorei_records')).rejects.toThrow(/permission denied/)
  })
  it('pending user reads only own profile and the store list', async () => {
    expect(await t.as(pending, 'select id from public.profiles')).toHaveLength(1)
    expect(await t.as(pending, 'select * from public.target_bowls')).toHaveLength(0)
    expect(await t.as(pending, 'select * from public.staff_directory()')).toHaveLength(0)
    expect(await t.as(pending, 'select * from public.stores')).toHaveLength(2)
  })
  it('pending user can choose a home store but not activate themselves', async () => {
    await t.as(pending, 'update public.profiles set home_store_id = $1, display_name = $2 where id = auth.uid()', [midosuji, '新人'])
    await expect(
      t.as(pending, `update public.profiles set status = 'active' where id = auth.uid()`),
    ).rejects.toThrow(/only managers/)
  })
  it('pending user cannot submit 朝礼', async () => {
    await expect(
      t.as(pending, `insert into public.chorei_records (store_id, business_date, shift, stock_none) values ($1, ${TODAY}, 'early', true)`, [midosuji]),
    ).rejects.toThrow(/row-level security/)
  })
})

describe('朝礼記録', () => {
  it('active staff submits; duplicate slot is rejected', async () => {
    await t.as(staffM, `insert into public.chorei_records (store_id, business_date, shift, stock_none, caution_text) values ($1, ${TODAY}, 'early', true, '笑顔')`, [midosuji])
    await expect(
      t.as(staffS, `insert into public.chorei_records (store_id, business_date, shift, stock_none) values ($1, ${TODAY}, 'early', true)`, [midosuji]),
    ).rejects.toThrow(/duplicate key/)
  })
  it('requires a reason when a step is skipped', async () => {
    await expect(
      t.as(staffM, `insert into public.chorei_records (store_id, business_date, shift, stock_none, steps_done) values ($1, ${TODAY}, 'middle', true, '{"greeting":true,"philosophy":false,"phrases":true,"handover":true,"grooming":true,"closing":true}')`, [midosuji]),
    ).rejects.toThrow(/chorei_skip_reason/)
  })
  it('rejects a date far in the past for staff', async () => {
    await expect(
      t.as(staffM, `insert into public.chorei_records (store_id, business_date, shift, stock_none) values ($1, ${TODAY} - 10, 'late', true)`, [midosuji]),
    ).rejects.toThrow(/business_date out of range/)
  })
  it('staff of the other store does not see it in tables, but sees it via chorei_slot', async () => {
    expect(await t.as(staffS, 'select id from public.chorei_records')).toHaveLength(0)
    const [slot] = await t.as<{ s: { existing: { leader: string } | null } }>(staffS, `select public.chorei_slot($1, ${TODAY}, 'early') as s`, [midosuji])
    expect(slot!.s.existing?.leader).toBe('スタッフM')
  })
  it('next shift sees the handover of the previous shift', async () => {
    const [slot] = await t.as<{ s: { previous: { caution_text: string } | null } }>(staffM, `select public.chorei_slot($1, ${TODAY}, 'middle') as s`, [midosuji])
    expect(slot!.s.previous?.caution_text).toBe('笑顔')
  })
  it('notes can be added instead of a duplicate', async () => {
    const [rec] = await t.admin<{ id: string }>(`select id from public.chorei_records where store_id = $1`, [midosuji])
    await t.as(staffS, 'select public.add_chorei_note($1, $2)', [rec!.id, '追加：ネギ不足'])
    expect(await t.admin('select * from public.chorei_notes')).toHaveLength(1)
  })
  it('staff cannot void; manager can, and it is audited', async () => {
    const [rec] = await t.admin<{ id: string }>(`select id from public.chorei_records where store_id = $1`, [midosuji])
    await expect(
      t.as(staffM, `update public.chorei_records set status = 'void', void_reason = 'x' where id = $1`, [rec!.id]),
    ).rejects.toThrow(/only managers/)
    await t.as(manager, `update public.chorei_records set status = 'void', void_reason = 'テスト' where id = $1`, [rec!.id])
    const audit = await t.as<{ action: string; actor_id: string }>(manager, 'select action, actor_id from public.audit_log')
    expect(audit).toContainEqual({ action: 'void', actor_id: manager })
  })
})

describe('巡回チェック', () => {
  const insertPatrol = (extra = '') => `
    insert into public.patrol_checks (store_id, business_date, shift, patrol_type, started_at, ended_at,
      score_smile, score_voice, score_grooming, score_clean, score_quality, good_points, improvements, status ${extra ? ', remarks' : ''})
    values ($1, ${TODAY}, 'middle', 'after_shift', now() - interval '20 minutes', now() - interval '8 minutes',
      4, 4, 4, 4, null, '声が大きい', 'スープの線', 'valid' ${extra ? `, '${extra}'` : ''})
    returning total, max_total, judgement, duration_min, needs_time_review`

  it('staff cannot insert a patrol check', async () => {
    await expect(t.as(staffM, insertPatrol(), [midosuji])).rejects.toThrow(/row-level security/)
  })
  it('patroller inserts; SQL computes total, judgement and minutes', async () => {
    const [row] = await t.as(patroller, insertPatrol(), [midosuji])
    expect(row).toEqual({ total: 16, max_total: 20, judgement: 'good', duration_min: 12, needs_time_review: false })
  })
  it('patrol over 60 minutes is flagged for review', async () => {
    const [row] = await t.as<{ needs_time_review: boolean }>(
      patroller,
      `insert into public.patrol_checks (store_id, business_date, shift, patrol_type, started_at, ended_at,
        score_smile, score_voice, score_grooming, score_clean, good_points, improvements)
       values ($1, ${TODAY}, 'late', 'after_shift', now() - interval '90 minutes', now(), 3, 3, 3, 3, 'a', 'b')
       returning needs_time_review`,
      [midosuji],
    )
    expect(row!.needs_time_review).toBe(true)
  })
  it('patroller cannot change times after finalising; manager can', async () => {
    const [p] = await t.admin<{ id: string }>(`select id from public.patrol_checks where shift = 'middle'`)
    await expect(
      t.as(patroller, `update public.patrol_checks set ended_at = now() where id = $1`, [p!.id]),
    ).rejects.toThrow(/only managers/)
    await t.as(manager, `update public.patrol_checks set ended_at = started_at + interval '15 minutes' where id = $1`, [p!.id])
    const [after] = await t.admin<{ duration_min: number }>('select duration_min from public.patrol_checks where id = $1', [p!.id])
    expect(after!.duration_min).toBe(15)
  })
  it('incomplete check cannot be finalised', async () => {
    await expect(
      t.as(patroller, `insert into public.patrol_checks (store_id, business_date, shift, patrol_type, started_at, ended_at, score_smile, score_voice, score_grooming, score_clean, good_points, improvements)
        values ($1, ${TODAY}, 'early', 'after_shift', now() - interval '10 minutes', now(), 3, 3, 3, 3, '', 'b')`, [midosuji]),
    ).rejects.toThrow(/patrol_complete/)
  })
  it('draft started at 開始 is flagged by the cron job after 60 minutes', async () => {
    await t.as(patroller, `insert into public.patrol_checks (store_id, business_date, shift, patrol_type, started_at, status)
      values ($1, ${TODAY}, 'early', 'early', now() - interval '61 minutes', 'draft')`, [sennichimae])
    const [r] = await t.admin<{ n: number }>('select public.flag_open_patrols() as n')
    expect(r!.n).toBe(1)
  })
  it('patrollers see only their own checks; managers see all; staff none', async () => {
    expect((await t.as(patroller, 'select id from public.patrol_checks')).length).toBe(3)
    expect((await t.as(manager, 'select id from public.patrol_checks')).length).toBe(3)
    expect(await t.as(staffS, 'select id from public.patrol_checks')).toHaveLength(0)
  })
})

describe('profiles & manager rights', () => {
  it('staff cannot grant themselves patrol rights', async () => {
    await expect(
      t.as(staffM, 'update public.profiles set can_patrol = true where id = auth.uid()'),
    ).rejects.toThrow(/only managers/)
  })
  it('staff sees only own profile; manager sees all', async () => {
    expect(await t.as(staffM, 'select id from public.profiles')).toHaveLength(1)
    expect((await t.as(manager, 'select id from public.profiles')).length).toBe(5)
  })
  it('manager approves a pending user', async () => {
    await t.as(manager, `update public.profiles set status = 'active', home_store_id = $2 where id = $1`, [pending, midosuji])
    expect(await t.as(pending, 'select * from public.target_bowls')).toHaveLength(12)
  })
  it('staff cannot edit targets', async () => {
    const rows = await t.as(staffM, 'update public.target_bowls set bowls = 1 returning id')
    expect(rows).toHaveLength(0)
  })
})

describe('attachments', () => {
  const add = (owner: string, patrolId: string, kind: 'image' | 'video', size = 1000, duration: number | null = null) =>
    t.admin(
      `insert into public.attachments (owner_id, patrol_id, kind, file_name, mime_type, size_bytes, duration_sec)
       values ($1, $2, $3, 'f', $4, $5, $6)`,
      [owner, patrolId, kind, kind === 'image' ? 'image/jpeg' : 'video/mp4', size, duration],
    )

  it('allows 5 photos and 1 video per record, not more', async () => {
    const [p] = await t.admin<{ id: string }>(`select id from public.patrol_checks where status = 'valid' limit 1`)
    for (let i = 0; i < 5; i++) await add(patroller, p!.id, 'image')
    await expect(add(patroller, p!.id, 'image')).rejects.toThrow(/attachment limit/)
    await add(patroller, p!.id, 'video', 50_000_000, 59)
    await expect(add(patroller, p!.id, 'video', 1000, 10)).rejects.toThrow(/attachment limit/)
  })
  it('rejects videos over 60 s or 100 MB', async () => {
    const [p] = await t.admin<{ id: string }>(`select id from public.patrol_checks where status = 'valid' offset 1 limit 1`)
    await expect(add(patroller, p!.id, 'video', 1000, 90)).rejects.toThrow(/attachment_video_limits/)
    await expect(add(patroller, p!.id, 'video', 200 * 1024 * 1024, 30)).rejects.toThrow(/attachment_video_limits/)
  })
  it('owners see their own attachments, managers all, other staff none; nobody inserts directly', async () => {
    expect((await t.as(patroller, 'select id from public.attachments')).length).toBe(6)
    expect((await t.as(manager, 'select id from public.attachments')).length).toBe(6)
    expect(await t.as(staffS, 'select id from public.attachments')).toHaveLength(0)
    await expect(
      t.as(patroller, `insert into public.attachments (owner_id, chorei_id, kind, file_name, mime_type, size_bytes) values (auth.uid(), null, 'image', 'x', 'image/jpeg', 1)`),
    ).rejects.toThrow(/row-level security|permission denied|attachment_one_parent/)
  })
  it('app_kv: managers read only the spreadsheet link', async () => {
    await t.admin(`insert into public.app_kv (key, value) values ('sheets_url', 'https://x'), ('folder:root', 'abc')`)
    expect(await t.as(manager, 'select key from public.app_kv')).toEqual([{ key: 'sheets_url' }])
    expect(await t.as(staffM, 'select key from public.app_kv')).toHaveLength(0)
  })
})

describe('full name (氏名)', () => {
  it('email sign-up stores the entered full name; Google name is not used', async () => {
    const a = await t.createUser('a@example.com', { entered_full_name: '  Nguyen   Van  An ' })
    const g = await t.createUser('g@example.com', { full_name: 'Google Name' })
    const rows = await t.admin<{ id: string; full_name: string | null }>('select id, full_name from public.profiles where id in ($1, $2)', [a, g])
    expect(rows.find((r) => r.id === a)?.full_name).toBe('Nguyen Van An')
    expect(rows.find((r) => r.id === g)?.full_name).toBeNull()
  })
  it('staff set it once (normalised), cannot change it later; managers can', async () => {
    await t.as(staffM, 'update public.profiles set full_name = $1 where id = auth.uid()', [' 山田　 太郎 ']) // full-width space
    const [r] = await t.admin<{ full_name: string }>('select full_name from public.profiles where id = $1', [staffM])
    expect(r!.full_name).toBe('山田 太郎')
    await expect(t.as(staffM, `update public.profiles set full_name = '別名' where id = auth.uid()`)).rejects.toThrow(/only managers/)
    await t.as(manager, `update public.profiles set full_name = '山田 太一' where id = $1`, [staffM])
  })
  it('rejects a 1-character name', async () => {
    await expect(t.as(staffS, `update public.profiles set full_name = 'A' where id = auth.uid()`)).rejects.toThrow(/profiles_full_name_length/)
  })
  it('directory returns full names to active users', async () => {
    const rows = await t.as<{ full_name: string | null }>(staffS, 'select full_name from public.staff_directory()')
    expect(rows.map((r) => r.full_name)).toContain('山田 太一')
  })
})

describe('staff roster', () => {
  it('managers maintain it, active staff read it, pending users and staff cannot write', async () => {
    await t.as(manager, `insert into public.staff_roster (name, home_store_id) values ('テスト', $1), ('サンプル', null)`, [midosuji])
    expect((await t.as(staffS, 'select name from public.staff_roster')).length).toBe(2)
    await expect(t.as(staffS, `insert into public.staff_roster (name) values ('勝手')`)).rejects.toThrow(/row-level security/)
    const fresh = await t.createUser('pending2@example.com')
    expect(await t.as(fresh, 'select name from public.staff_roster')).toHaveLength(0)
    await expect(t.as(manager, `insert into public.staff_roster (name) values ('テスト')`)).rejects.toThrow(/duplicate key/)
  })
  it('patrol checks store the list of staff names', async () => {
    const [row] = await t.as<{ staff_names: string[] }>(
      patroller,
      `insert into public.patrol_checks (store_id, business_date, shift, patrol_type, started_at, ended_at,
        score_smile, score_voice, score_grooming, score_clean, good_points, improvements, staff_names, staff_on_shift)
       values ($1, (now() at time zone 'Asia/Tokyo')::date, 'middle', 'after_shift', now() - interval '12 minutes', now(),
        4, 4, 4, 4, 'a', 'b', '{テスト,サンプル}', 'テスト、サンプル') returning staff_names`,
      [midosuji],
    )
    expect(row!.staff_names).toEqual(['テスト', 'サンプル'])
  })
})

describe('mask rule (① 笑顔)', () => {
  const insert = (smile: number) =>
    t.as<{ total: number }>(
      patroller,
      `insert into public.patrol_checks (store_id, business_date, shift, patrol_type, started_at, ended_at,
        score_smile, score_voice, score_grooming, score_clean, score_quality, good_points, improvements, mask_worn)
       values ($1, (now() at time zone 'Asia/Tokyo')::date, 'early', 'after_shift', now() - interval '10 minutes', now(),
        $2, 5, 5, 5, 5, 'a', 'b', true) returning total`,
      [midosuji, smile],
    )
  it('mask worn → smile must be 1', async () => {
    await expect(insert(4)).rejects.toThrow(/patrol_mask_smile/)
    const [row] = await insert(1)
    expect(row!.total).toBe(21)
  })
})
