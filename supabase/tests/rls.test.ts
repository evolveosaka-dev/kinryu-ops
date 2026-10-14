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
  it('rejected user can apply again (rejected → pending) but nothing more', async () => {
    await t.as(manager, `update public.profiles set status = 'rejected' where id = $1`, [pending])
    await expect(t.as(pending, `update public.profiles set status = 'active' where id = auth.uid()`)).rejects.toThrow(/only managers/)
    await t.as(pending, `update public.profiles set status = 'pending' where id = auth.uid()`)
    const [row] = await t.admin<{ status: string }>('select status from public.profiles where id = $1', [pending])
    expect(row!.status).toBe('pending')
    await expect(t.as(pending, `update public.profiles set status = 'rejected' where id = auth.uid()`)).rejects.toThrow(/only managers/)
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
  it('manager edits keep the original submitted time and are audited for managers only', async () => {
    const [rec] = await t.admin<{ id: string; submitted_at: string }>(`select id, submitted_at::text from public.chorei_records where store_id = $1 and shift = 'early'`, [midosuji])
    await t.as(manager, `update public.chorei_records set caution_text = '丼の縁', participants_extra = '{カン}' where id = $1`, [rec!.id])
    const [after] = await t.admin<{ submitted_at: string; caution_text: string }>(`select submitted_at::text, caution_text from public.chorei_records where id = $1`, [rec!.id])
    expect(after).toEqual({ submitted_at: rec!.submitted_at, caution_text: '丼の縁' })
    const audit = await t.as<{ diff: Record<string, { old: unknown; new: unknown }> }>(manager, `select diff from public.audit_log where row_id = $1`, [rec!.id])
    expect(audit.at(-1)!.diff.caution_text).toEqual({ old: '笑顔', new: '丼の縁' })
    expect(audit.at(-1)!.diff.submitted_at).toBeUndefined()
    expect(await t.as(staffM, 'select id from public.audit_log')).toHaveLength(0)
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
  it('patrol over 15 minutes is flagged for review', async () => {
    const [row] = await t.as<{ needs_time_review: boolean }>(
      patroller,
      `insert into public.patrol_checks (store_id, business_date, shift, patrol_type, started_at, ended_at,
        score_smile, score_voice, score_grooming, score_clean, good_points, improvements)
       values ($1, ${TODAY}, 'late', 'after_shift', now() - interval '16 minutes', now(), 3, 3, 3, 3, 'a', 'b')
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
  it('draft started at 開始 without 終了 is flagged by the cron job after 15 minutes', async () => {
    await t.as(patroller, `insert into public.patrol_checks (store_id, business_date, shift, patrol_type, started_at, status)
      values ($1, ${TODAY}, 'early', 'before_shift', now() - interval '16 minutes', 'draft')`, [sennichimae])
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

  it('allows 5 photos and 3 videos per record, not more', async () => {
    const [p] = await t.admin<{ id: string }>(`select id from public.patrol_checks where status = 'valid' limit 1`)
    for (let i = 0; i < 5; i++) await add(patroller, p!.id, 'image')
    await expect(add(patroller, p!.id, 'image')).rejects.toThrow(/attachment limit/)
    await add(patroller, p!.id, 'video', 140_000_000, 89)
    await add(patroller, p!.id, 'video', 1000, 10)
    await add(patroller, p!.id, 'video', 1000, 10)
    await expect(add(patroller, p!.id, 'video', 1000, 10)).rejects.toThrow(/attachment limit/)
  })
  it('rejects videos over 90 s or 150 MB', async () => {
    const [p] = await t.admin<{ id: string }>(`select id from public.patrol_checks where status = 'valid' offset 1 limit 1`)
    await expect(add(patroller, p!.id, 'video', 1000, 95)).rejects.toThrow(/attachment_video_limits/)
    await expect(add(patroller, p!.id, 'video', 160 * 1024 * 1024, 30)).rejects.toThrow(/attachment_video_limits/)
  })
  it('owners see their own attachments, managers all, other staff none; nobody inserts directly', async () => {
    expect((await t.as(patroller, 'select id from public.attachments')).length).toBe(8)
    expect((await t.as(manager, 'select id from public.attachments')).length).toBe(8)
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

describe('15-minute patrol limit', () => {
  it('a 14-minute patrol is not flagged; 終了 on a draft cannot be moved', async () => {
    const [ok] = await t.as<{ needs_time_review: boolean }>(
      patroller,
      `insert into public.patrol_checks (store_id, business_date, shift, patrol_type, started_at, ended_at,
        score_smile, score_voice, score_grooming, score_clean, good_points, improvements)
       values ($1, ${TODAY}, 'early', 'in_shift', now() - interval '14 minutes', now(), 4, 4, 4, 4, 'a', 'b')
       returning needs_time_review`,
      [midosuji],
    )
    expect(ok!.needs_time_review).toBe(false)
    const [d] = await t.as<{ id: string }>(
      patroller,
      `insert into public.patrol_checks (store_id, business_date, shift, patrol_type, started_at, ended_at, status)
       values ($1, ${TODAY}, 'early', 'random', now() - interval '5 minutes', now() - interval '1 minute', 'draft') returning id`,
      [midosuji],
    )
    await expect(
      t.as(patroller, 'update public.patrol_checks set ended_at = now() where id = $1', [d!.id]),
    ).rejects.toThrow(/end time already recorded/)
  })
})

describe('test data before the operation start (2026-10-12)', () => {
  it('records with an earlier business date are labelled is_test, later ones are not', async () => {
    const rows = await t.admin<{ business_date: string; is_test: boolean }>('select business_date::text, is_test from public.patrol_checks')
    for (const r of rows) expect(r.is_test).toBe(r.business_date < '2026-10-12')
    await t.admin(
      `insert into public.chorei_records (store_id, business_date, shift, leader_id, stock_none)
       values ($1, '2026-10-11', 'early', $2, true), ($1, '2026-10-12', 'early', $2, true)`, // early: the duty tests use 'late' on TODAY - 3
      [sennichimae, manager],
    )
    const flags = await t.admin<{ d: string; is_test: boolean }>(`select business_date::text as d, is_test from public.chorei_records where business_date in ('2026-10-11', '2026-10-12')`)
    expect(flags.find((f) => f.d === '2026-10-11')?.is_test).toBe(true)
    expect(flags.find((f) => f.d === '2026-10-12')?.is_test).toBe(false)
  })
})

describe('shift requests (シフト希望)', () => {
  // two months ahead: its deadline (20th of next month) is always in the future
  const NEXT = `date_trunc('month', (now() at time zone 'Asia/Tokyo')::date + interval '2 month')::date`
  it('staff submit and update their own request; others cannot read it; managers can', async () => {
    await t.as(staffM, `insert into public.shift_requests (month, shifts, days) values (${NEXT}, '{early}', '{"x": {"early": "full"}}')`)
    await t.as(staffM, `update public.shift_requests set shifts = '{early,middle}' where user_id = auth.uid()`)
    expect(await t.as(staffS, 'select id from public.shift_requests')).toHaveLength(0)
    const rows = await t.as<{ shifts: string[] }>(manager, 'select shifts from public.shift_requests')
    expect(rows[0]!.shifts).toEqual(['early', 'middle'])
  })
  it('one request per person per month; past months are closed; shifts must be valid', async () => {
    await expect(t.as(staffM, `insert into public.shift_requests (month, shifts) values (${NEXT}, '{late}')`)).rejects.toThrow(/duplicate key/)
    await expect(t.as(staffS, `insert into public.shift_requests (month, shifts) values ('2026-01-01', '{late}')`)).rejects.toThrow(/row-level security/)
    await expect(t.as(staffS, `insert into public.shift_requests (month, shifts) values (${NEXT}, '{night}')`)).rejects.toThrow(/check constraint/)
  })
})

describe('shift request deadline (20th of the previous month)', () => {
  it('deadline date', async () => {
    const [r] = await t.admin<{ a: string; b: string }>(`select public.shift_request_deadline('2026-11-01')::text as a, public.shift_request_deadline('2027-01-01')::text as b`)
    expect(r).toEqual({ a: '2026-10-20', b: '2026-12-20' })
  })
  it('staff cannot send for a month whose deadline has passed; managers can still edit', async () => {
    const THIS_MONTH = `date_trunc('month', (now() at time zone 'Asia/Tokyo')::date)::date`
    await expect(t.as(staffS, `insert into public.shift_requests (month, shifts) values (${THIS_MONTH}, '{early}')`)).rejects.toThrow(/row-level security/)
    const updated = await t.as(manager, `update public.shift_requests set answers = '{"message": "ok"}' returning id`)
    expect(updated.length).toBeGreaterThan(0)
  })
})

describe('shift schedule', () => {
  const rows = JSON.stringify([
    { business_date: '2026-10-12', shift: 'middle', roster_name: 'ミナミ', store_mark: '⑤', start_min: 1020, end_min: 1380, raw: '⑤17-23' },
    { business_date: '2026-10-12', shift: 'middle', roster_name: 'キタ', store_mark: '⑤', start_min: 1050, end_min: 1380, raw: '⑤17.5-23' },
    { business_date: '2026-10-12', shift: 'middle', roster_name: 'ヒガシ', store_mark: '①', start_min: 1020, end_min: 1380, raw: '①17-23' },
    { business_date: '2026-10-12', shift: 'late', roster_name: 'ミナミ', store_mark: '①', start_min: 1380, end_min: 1860, raw: '①23-7' },
  ])
  it('only managers import; new names join the roster', async () => {
    await expect(t.as(staffM, 'select public.import_shift_month($1, $2)', ['2026-10-01', rows])).rejects.toThrow(/managers only/)
    const [r] = await t.as<{ n: number }>(manager, 'select public.import_shift_month($1, $2) as n', ['2026-10-01', rows])
    expect(r!.n).toBe(4)
    expect((await t.admin(`select name from public.staff_roster where name in ('ミナミ','キタ','ヒガシ')`)).length).toBe(3)
    const [store] = await t.admin<{ ok: boolean }>(`select store_id = $1 as ok from public.shift_assignments where raw = '①23-7'`, [midosuji])
    expect(store!.ok).toBe(true)
  })
  it('staff see only their own assignments, and coworkers of their own shifts', async () => {
    await t.admin(`update public.profiles set roster_name = 'ミナミ' where id = $1`, [staffM])
    expect(await t.as(staffM, 'select shift from public.shift_assignments order by start_min')).toEqual([{ shift: 'middle' }, { shift: 'late' }])
    expect(await t.as(staffS, 'select id from public.shift_assignments')).toHaveLength(0)
    const co = await t.as<{ roster_name: string }>(staffM, `select roster_name from public.shift_coworkers('2026-10-12', 'middle')`)
    expect(co.map((c) => c.roster_name)).toEqual(['キタ']) // same store ⑤ only
    expect(await t.as(staffS, `select * from public.shift_coworkers('2026-10-12', 'middle')`)).toHaveLength(0)
  })
  it('朝礼 参加者: the scheduled names of a slot — managers any day, staff only around today', async () => {
    const slot = (store: string, date: string) => `select roster_name from public.slot_staff('${store}', ${date}, 'middle')`
    expect(await t.as(manager, slot(sennichimae, `'2026-10-12'`))).toEqual([{ roster_name: 'ミナミ' }, { roster_name: 'キタ' }])
    expect(await t.as(staffS, slot(sennichimae, `'2026-10-12'::date - 365`))).toEqual([])
    await t.admin(`insert into public.shift_assignments (month, business_date, shift, roster_name, store_mark, store_id, start_min, end_min, raw)
                   values (date_trunc('month', ${TODAY})::date, ${TODAY}, 'middle', 'ニシ', '①', $1, 1020, 1380, '①17-23')`, [midosuji])
    expect(await t.as(staffS, slot(midosuji, TODAY))).toEqual([{ roster_name: 'ニシ' }])
    const waiting = await t.createUser('slot-pending@example.com')
    expect(await t.as(waiting, slot(midosuji, TODAY))).toEqual([])
    await t.admin(`delete from public.shift_assignments where roster_name = 'ニシ'`)
  })
  it('staff cannot link themselves to another shift-table name', async () => {
    await expect(t.as(staffS, "update public.profiles set roster_name = 'ミナミ' where id = auth.uid()")).rejects.toThrow(/only managers/)
  })
  it('勤務延長 keeps the shift-table end, which must be before the new end', async () => {
    await t.admin(`update public.shift_assignments set end_min = 1410, original_end_min = 1380 where raw = '⑤17-23' and roster_name = 'ミナミ'`)
    expect(await t.as(staffM, `select end_min, original_end_min from public.shift_assignments where shift = 'middle'`)).toEqual([
      { end_min: 1410, original_end_min: 1380 },
    ])
    await expect(t.admin(`update public.shift_assignments set original_end_min = 1500 where raw = '⑤17-23' and roster_name = 'ミナミ'`)).rejects.toThrow(
      /shift_assignments_extension/,
    )
  })
  it('duties: members see only their own; done follows the 朝礼 record and their own patrol check', async () => {
    // staffM is linked to ミナミ above; patroller gets キタ. A day no other test uses:
    const DAY = `${TODAY} - 3`
    await t.admin(`update public.profiles set roster_name = 'キタ' where id = $1`, [patroller])
    const insertDuty = `insert into public.duty_assignments (business_date, shift, store_id, roster_name, kind, time_mode, start_min, end_min, method)
      values (${DAY}, 'late', $1, $2, $3, 'at', 1380, 1410, 'own')`
    await expect(t.as(staffM, insertDuty, [midosuji, 'ミナミ', 'chorei'])).rejects.toThrow(/row-level security/)
    await t.as(manager, insertDuty, [midosuji, 'ミナミ', 'chorei'])
    await t.admin(insertDuty, [sennichimae, 'キタ', 'patrol'])
    await t.admin(insertDuty, [sennichimae, 'キタ', 'chorei'])

    expect(await t.as(staffM, 'select roster_name from public.duty_assignments')).toEqual([{ roster_name: 'ミナミ' }])
    expect(await t.as(staffS, 'select id from public.duty_assignments')).toHaveLength(0)
    expect((await t.as(manager, 'select id from public.duty_assignments')).length).toBe(3)

    const mine = (who: string) =>
      t.as<{ kind: string; done: boolean }>(who, `select kind, done from public.my_duties(${DAY}, ${TODAY}) order by kind`)
    expect(await mine(patroller)).toEqual([
      { kind: 'chorei', done: false },
      { kind: 'patrol', done: false },
    ])
    await t.admin(`insert into public.chorei_records (store_id, business_date, shift, leader_id, stock_none) values ($1, ${DAY}, 'late', $2, true)`, [sennichimae, staffS])
    await t.admin(`
      insert into public.patrol_checks (patroller_id, store_id, business_date, shift, patrol_type, started_at, ended_at,
        score_smile, score_voice, score_grooming, score_clean, score_quality, good_points, improvements, status)
      values ($2, $1, ${DAY}, 'late', 'in_shift', now() - interval '10 minutes', now() - interval '2 minutes', 4, 4, 4, 4, null, '笑顔', '声', 'valid')`, [sennichimae, patroller])
    expect(await mine(patroller)).toEqual([
      { kind: 'chorei', done: true },
      { kind: 'patrol', done: true },
    ])
    expect(await mine(staffM)).toEqual([{ kind: 'chorei', done: false }]) // other store's 朝礼 does not count
    expect(await t.as(pending, `select * from public.my_duties(${DAY}, ${TODAY})`)).toHaveLength(0)
  })
  it('re-import replaces the month', async () => {
    await t.as(manager, 'select public.import_shift_month($1, $2)', ['2026-10-01', JSON.stringify([JSON.parse(rows)[0]])])
    expect((await t.admin(`select id from public.shift_assignments where month = '2026-10-01'`)).length).toBe(1)
  })
})

describe('test accounts', () => {
  const DAY = `(${TODAY} - 5)`
  let tester: string
  let real: string
  const steps = `'{"greeting":true,"philosophy":true,"phrases":true,"handover":true,"grooming":true,"closing":true}'`
  const insertChorei = (shift: string) =>
    `insert into public.chorei_records (store_id, business_date, shift, leader_id, stock_none, steps_done) values ($1, ${DAY}, '${shift}', $2, true, ${steps}) returning id, is_test, by_test_account`

  beforeAll(async () => {
    tester = await t.createUser('tester@example.com', { display_name: 'テスト' })
    real = await t.createUser('real@example.com', { display_name: 'リアル' })
    await activate(tester, midosuji, `, can_patrol = true, is_test_account = true, roster_name = 'テスト野口'`)
    await activate(real, midosuji, `, roster_name = 'ノグチ'`)
    await t.admin(`insert into public.shift_assignments (month, business_date, shift, roster_name, store_mark, start_min, end_min, raw) values
      (date_trunc('month', ${DAY})::date, ${DAY}, 'late', 'ノグチ', '①', 1380, 1860, '①23-7'),
      (date_trunc('month', ${DAY})::date, ${DAY}, 'late', 'テスト野口', '①', 1380, 1860, '①23-7')`)
    await t.admin(`insert into public.duty_assignments (business_date, shift, store_id, roster_name, kind, time_mode, start_min, end_min, method) values
      (${DAY}, 'late', $1, 'ノグチ', 'chorei', 'at', 1380, 1410, 'own'), (${DAY}, 'late', $1, 'テスト野口', 'chorei', 'at', 1380, 1410, 'own')`, [midosuji])
  })

  it('records of a test account are test data and never take the real slot', async () => {
    const [mine] = await t.admin<{ id: string; is_test: boolean; by_test_account: boolean }>(insertChorei('late'), [midosuji, tester])
    expect(mine).toMatchObject({ is_test: true, by_test_account: true })
    const [theirs] = await t.admin<{ by_test_account: boolean }>(insertChorei('late'), [midosuji, real])
    expect(theirs!.by_test_account).toBe(false)
    const slot = (who: string) =>
      t.as<{ s: { existing: { leader: string } | null } }>(who, `select public.chorei_slot($1, ${DAY}, 'late') as s`, [midosuji])
    expect((await slot(real))[0]!.s.existing!.leader).toBe('リアル')
    expect((await slot(tester))[0]!.s.existing!.leader).toBe('テスト')
    // the test record is not the handover the next (early) shift sees
    const [next] = await t.as<{ s: { previous: { leader: string } } }>(real, `select public.chorei_slot($1, ${DAY} + 1, 'early') as s`, [midosuji])
    expect(next!.s.previous.leader).toBe('リアル')
    // notes only on own test records
    await expect(t.as(tester, 'select public.add_chorei_note($1, $2)', [(await t.admin<{ id: string }>(`select id from public.chorei_records where leader_id = $1`, [real]))[0]!.id, 'x'])).rejects.toThrow(/record not found/)
    await t.as(tester, 'select public.add_chorei_note($1, $2)', [mine!.id, 'テストのメモ'])
  })
  it('担当 done flags do not mix; coworkers never list a test account', async () => {
    const done = (who: string) => t.as<{ done: boolean }>(who, `select done from public.my_duties(${DAY}, ${DAY})`)
    expect(await done(real)).toEqual([{ done: true }])
    expect(await done(tester)).toEqual([{ done: true }])
    await t.admin(`update public.chorei_records set status = 'void', void_reason = 'x' where leader_id = $1`, [real])
    expect(await done(real)).toEqual([{ done: false }]) // the test record does not count
    expect(await t.as(real, `select roster_name from public.shift_coworkers(${DAY}, 'late')`)).toEqual([])
  })
  it('a test account cannot clear its own flag; the nightly purge removes only its records', async () => {
    await expect(t.as(tester, 'update public.profiles set is_test_account = false where id = auth.uid()')).rejects.toThrow(/only managers/)
    const before = await t.admin<{ n: number }>(`select count(*)::int as n from public.chorei_records where leader_id = $1`, [real])
    const [r] = await t.admin<{ n: number }>('select public.purge_test_account_data() as n')
    expect(r!.n).toBeGreaterThan(0)
    expect(await t.admin(`select id from public.chorei_records where leader_id = $1`, [tester])).toHaveLength(0)
    expect(await t.admin(`select id from public.chorei_notes where author_id = $1`, [tester])).toHaveLength(0)
    expect(await t.admin<{ n: number }>(`select count(*)::int as n from public.chorei_records where leader_id = $1`, [real])).toEqual(before)
    expect(await t.admin(`select id from public.profiles where id = $1 and is_test_account`, [tester])).toHaveLength(1)
  })
})

describe('test account with the manager role is read-only', () => {
  let viewer: string
  beforeAll(async () => {
    viewer = await t.createUser('viewer@example.com', { display_name: 'ビューア' })
    await activate(viewer, midosuji, `, role = 'manager', can_patrol = true, is_test_account = true`)
  })
  it('reads like a manager', async () => {
    expect((await t.as(viewer, 'select id from public.profiles')).length).toBeGreaterThan(3)
    expect((await t.as(viewer, 'select id from public.chorei_records')).length).toBeGreaterThan(0)
  })
  it('changes nothing: targets, users, its own role, shift import, other records', async () => {
    const ro = /test account: read only/
    await expect(t.as(viewer, `update public.target_bowls set bowls = bowls + 1`)).rejects.toThrow(ro)
    await expect(t.as(viewer, `update public.profiles set status = 'active' where id = $1`, [pending])).rejects.toThrow(ro)
    await expect(t.as(viewer, `update public.profiles set role = 'admin', is_test_account = false where id = auth.uid()`)).rejects.toThrow(ro)
    await expect(t.as(viewer, `select public.import_shift_month('2026-10-01', '[]')`)).rejects.toThrow(ro)
    await expect(t.as(viewer, `update public.chorei_records set status = 'void', void_reason = 'x' where leader_id <> auth.uid()`)).rejects.toThrow(ro)
    await expect(t.as(viewer, `insert into public.staff_roster (name) values ('ダミー')`)).rejects.toThrow(ro)
  })
  it('may still change its language and send its own (purged) test records', async () => {
    await t.as(viewer, `update public.profiles set locale = 'vi' where id = auth.uid()`)
    const [c] = await t.as<{ is_test: boolean }>(viewer, `insert into public.chorei_records (store_id, business_date, shift, leader_id, stock_none)
      values ($1, ${TODAY}, 'middle', auth.uid(), true) returning is_test`, [sennichimae])
    expect(c!.is_test).toBe(true)
  })
})

describe('履歴 → 全店舗', () => {
  const month = `date_trunc('month', ${TODAY})::date`
  it('any active staff sees every 朝礼 of a store this month, with the leader name', async () => {
    await t.as(staffM, `insert into public.chorei_records (store_id, business_date, shift, stock_none) values ($1, ${TODAY}, 'late', true)`, [midosuji])
    const rows = await t.as<{ r: { leader: string; shift: string }[] }>(staffS, `select public.store_chorei_month($1, ${month}) as r`, [midosuji])
    expect(rows[0]!.r.length).toBeGreaterThan(0)
    expect(rows[0]!.r[0]).toHaveProperty('leader')
  })
  it('巡回 of all stores: managers only, not staff or patrol members', async () => {
    await expect(t.as(staffS, `select public.store_patrol_month($1, ${month})`, [midosuji])).rejects.toThrow(/managers only/)
    await expect(t.as(patroller, `select public.store_patrol_month($1, ${month})`, [midosuji])).rejects.toThrow(/managers only/)
    const [row] = await t.as<{ r: { patroller: string }[] }>(manager, `select public.store_patrol_month($1, ${month}) as r`, [midosuji])
    expect(row!.r.length).toBeGreaterThan(0)
    expect(row!.r[0]).toHaveProperty('patroller')
  })
  it('pending users get nothing', async () => {
    const newcomer = await t.createUser('newcomer2@example.com')
    await expect(t.as(newcomer, `select public.store_chorei_month($1, ${month})`, [midosuji])).rejects.toThrow(/not allowed/)
  })
})

describe('朝礼できなかった (chorei_misses)', () => {
  const SLOT = `${TODAY} - 1`
  const report = (who: string, reason: string, note: string | null = null) =>
    t.as(who, `select public.report_chorei_miss($1, ${SLOT}, 'middle', $2, $3) as id`, [midosuji, reason, note])

  it('staff report a reason; other needs a note; a second person cannot overwrite', async () => {
    await expect(report(staffM, 'other')).rejects.toThrow(/chorei_miss_other_note/)
    await report(staffM, 'busy')
    await report(staffM, 'alone')
    await expect(report(staffS, 'forgot')).rejects.toThrow(/already reported/)
    const [slot] = await t.as<{ s: { miss: { reason: string; mine: boolean } } }>(staffS, `select public.chorei_slot($1, ${SLOT}, 'middle') as s`, [midosuji])
    expect(slot!.s.miss).toMatchObject({ reason: 'alone', mine: false })
  })
  it('staff cannot write the table directly nor read others; managers correct it to ✓', async () => {
    await expect(
      t.as(staffS, `insert into public.chorei_misses (store_id, business_date, shift, reason, reporter_id) values ($1, ${TODAY}, 'late', 'busy', auth.uid())`, [midosuji]),
    ).rejects.toThrow(/row-level security/)
    expect(await t.as(staffS, 'select id from public.chorei_misses')).toHaveLength(0)
    expect(await t.as(staffM, 'select id from public.chorei_misses')).toHaveLength(1)
    const rows = await t.as<{ kind: string; reason: string | null; by_manager: boolean }>(
      manager,
      `update public.chorei_misses set kind = 'done', note = '実施を確認' returning kind, reason, by_manager`,
    )
    expect(rows).toEqual([{ kind: 'done', reason: null, by_manager: true }])
  })
  it('cannot report a slot that already has a 朝礼 record, nor outside today ± 1', async () => {
    const [rec] = await t.admin<{ store_id: string; d: string; shift: string }>(
      `select store_id, business_date::text as d, shift from public.chorei_records where status = 'valid' and not by_test_account and business_date = ${TODAY} limit 1`,
    )
    await expect(t.as(staffM, `select public.report_chorei_miss($1, $2::date, $3, 'busy')`, [rec!.store_id, rec!.d, rec!.shift])).rejects.toThrow(/already recorded/)
    await expect(t.as(staffM, `select public.report_chorei_miss($1, ${TODAY} - 5, 'late', 'busy')`, [midosuji])).rejects.toThrow(/out of range/)
  })
  it('a manager records a missed 朝礼 afterwards at the meeting time; staff cannot set those fields', async () => {
    const [r] = await t.as<{ submitted_at: string; entered_by_manager: boolean; manager_note: string }>(
      manager,
      `insert into public.chorei_records (store_id, business_date, shift, leader_id, stock_none, submitted_at, entered_by_manager, manager_note)
       values ($1, ${TODAY} - 1, 'early', auth.uid(), true, ((${TODAY} - 1)::text || ' 07:00+09')::timestamptz, true, '記録漏れ')
       returning to_char(submitted_at at time zone 'Asia/Tokyo', 'HH24:MI') as submitted_at, entered_by_manager, manager_note`,
      [sennichimae],
    )
    expect(r).toEqual({ submitted_at: '07:00', entered_by_manager: true, manager_note: '記録漏れ' })
    const [s] = await t.as<{ entered_by_manager: boolean; manager_note: string | null }>(
      staffS,
      `insert into public.chorei_records (store_id, business_date, shift, stock_none, entered_by_manager, manager_note)
       values ($1, ${TODAY} + 1, 'late', true, true, 'x') returning entered_by_manager, manager_note`,
      [sennichimae],
    )
    expect(s).toEqual({ entered_by_manager: false, manager_note: null })
  })
  it('a report can carry photos (5 + 3 limit per report)', async () => {
    const [m] = await t.admin<{ id: string }>('select id from public.chorei_misses limit 1')
    const add = (kind: string) =>
      t.admin(`insert into public.attachments (owner_id, miss_id, kind, file_name, mime_type, size_bytes) values ($1, $2, $3, 'f', $4, 1000)`, [
        manager, m!.id, kind, kind === 'image' ? 'image/jpeg' : 'video/mp4',
      ])
    for (let i = 0; i < 5; i++) await add('image')
    await expect(add('image')).rejects.toThrow(/attachment limit/)
    for (let i = 0; i < 3; i++) await add('video')
    await expect(add('video')).rejects.toThrow(/attachment limit/)
  })
})

describe('巡回を後から記録 (manager)', () => {
  const insert = (who: string, patrollerSql: string, extra = '') =>
    t.as<{ patroller_id: string; entered_by_manager: boolean; needs_time_review: boolean; duration_min: number }>(
      who,
      `insert into public.patrol_checks (patroller_id, store_id, business_date, shift, patrol_type, started_at, ended_at,
         score_smile, score_voice, score_grooming, score_clean, score_quality, good_points, improvements, status, entered_by_manager, manager_note)
       values (${patrollerSql}, $1, ${TODAY} - 3, 'late', 'after_shift', now() - interval '3 days', now() - interval '3 days' + interval '20 minutes',
         4, 4, 4, 4, null, '良い', '改善', 'valid', true, '後から入力' ${extra})
       returning patroller_id, entered_by_manager, needs_time_review, duration_min`,
      [midosuji],
    )
  it('a manager records a past patrol for a patrol member, with its own times and no time review', async () => {
    const [r] = await insert(manager, `'${patroller}'`)
    expect(r).toEqual({ patroller_id: patroller, entered_by_manager: true, needs_time_review: false, duration_min: 20 })
  })
  it('not for a member without patrol rights; staff cannot use it', async () => {
    await expect(insert(manager, `'${staffS}'`)).rejects.toThrow(/row-level security/)
    await expect(insert(staffS, `'${patroller}'`)).rejects.toThrow(/row-level security|out of range/)
  })
})

describe('学ぶ (learn_items)', () => {
  const insert = `insert into public.learn_items (kind, category, title, steps, published) values ('manual', 'service', $1, '[{"text":"「おおきに」","image":null}]', $2) returning id`
  it('only managers write; staff read published pages only', async () => {
    await expect(t.as(staffM, insert, ['勝手に', true])).rejects.toThrow(/row-level security/)
    await t.as(manager, insert, ['お見送り', true])
    await t.as(manager, insert, ['下書き', false])
    expect((await t.as<{ title: string }>(staffM, 'select title from public.learn_items')).map((r) => r.title)).toEqual(['お見送り'])
    expect(await t.as(manager, 'select id from public.learn_items')).toHaveLength(2)
    // an account waiting for approval (earlier tests approve `pending`)
    const waiting = await t.createUser('wait@example.com')
    expect(await t.as(waiting, 'select id from public.learn_items')).toHaveLength(0)
    await expect(t.as(null, 'select id from public.learn_items')).rejects.toThrow(/permission denied/)
    expect(await t.as(staffM, `update public.learn_items set title = 'x' returning id`)).toHaveLength(0)
  })
  it('a video needs a link; changing the Japanese moves content_updated_at, translating does not', async () => {
    await expect(t.as(manager, `insert into public.learn_items (kind, category, title) values ('video', 'service', 'v')`)).rejects.toThrow(/learn_video_needs_url/)
    const [row] = await t.admin<{ id: string; c: string }>(`select id, content_updated_at::text as c from public.learn_items where title = 'お見送り'`)
    await t.admin(`update public.learn_items set content_updated_at = '2026-01-01' where id = $1`, [row!.id])
    await t.admin(`update public.learn_items set translations = '{"en":{}}', translated_at = now() where id = $1`, [row!.id])
    const [a] = await t.admin<{ c: string }>(`select content_updated_at::text as c from public.learn_items where id = $1`, [row!.id])
    expect(a!.c.startsWith('2026-01-01')).toBe(true)
    await t.as(manager, `update public.learn_items set steps = '[{"text":"「まいど」","image":null}]' where id = $1`, [row!.id])
    const [b] = await t.admin<{ c: string; by: string }>(`select content_updated_at::text as c, updated_by::text as by from public.learn_items where id = $1`, [row!.id])
    expect(b!.c.startsWith('2026-01-01')).toBe(false)
    expect(b!.by).toBe(manager)
  })
})

describe('在庫・仕入 (stock)', () => {
  const add = (kind: string, lines: string, place: string | null = null, note: string | null = null, date = TODAY, temps: string | null = null) =>
    `select public.add_stock_event($1, ${date}, 'early', '${kind}', '${lines}'::jsonb, ${place ? `'${place}'` : 'null'}, ${note ? `'${note}'` : 'null'}, ${temps ?? 'null'}) as id`
  let items: { id: string; code: string }[]
  const line = (code: string, qty: number) => ({ item: items.find((i) => i.code === code)!.id, qty })
  beforeAll(async () => {
    items = await t.admin(`select id, code from public.stock_items where store_id = $1`, [sennichimae])
  })

  it('items per store: 米 only at 千日前店, standards differ, fridges 4 / 3', async () => {
    const rows = await t.as<{ store: string; code: string; standard: string | null }>(
      staffM,
      `select s.code as store, i.code, i.standard::text as standard from public.stock_items i join public.stores s on s.id = i.store_id where i.code in ('rice', 'noodle')`,
    )
    expect(rows.filter((r) => r.code === 'rice').map((r) => r.store)).toEqual(['sennichimae'])
    expect(rows.filter((r) => r.code === 'noodle').map((r) => Number(r.standard)).sort()).toEqual([500, 750])
    expect(await t.as(staffM, `select code, fridge_count from public.stores order by code`)).toEqual([
      { code: 'midosuji', fridge_count: 3 },
      { code: 'sennichimae', fridge_count: 4 },
    ])
    await expect(t.as(staffM, `update public.stock_items set standard = 1 returning id`)).resolves.toHaveLength(0)
  })

  it('staff record 受入 / 払出 with a valid place; wrong input is refused', async () => {
    const ok = JSON.stringify([line('noodle', 400), line('kimchi', 2.25)])
    const [r] = await t.as<{ id: string }>(staffM, add('in', ok, 'honten', 'ド'), [sennichimae])
    const [row] = await t.admin<{ lines: { qty: number }[]; author_name: string }>(`select lines, author_name from public.stock_events where id = $1`, [r!.id])
    expect(row!.lines.map((l) => l.qty)).toEqual([400, 2.3])
    expect(row!.author_name).toBe('スタッフM')
    await expect(t.as(staffM, add('in', ok, 'sennichimae'), [sennichimae])).rejects.toThrow(/bad place/)
    await expect(t.as(staffM, add('out', ok, 'other'), [sennichimae])).rejects.toThrow(/note required/)
    await expect(t.as(staffM, add('in', JSON.stringify([line('noodle', -1)]), 'vendor'), [sennichimae])).rejects.toThrow(/bad lines/)
    await expect(t.as(staffM, add('in', ok, 'vendor'), [midosuji])).rejects.toThrow(/bad lines/) // items of another store
    await expect(t.as(staffM, add('in', ok, 'vendor', null, `${TODAY} - 3`), [sennichimae])).rejects.toThrow(/date out of range/)
    await t.as(manager, add('in', ok, 'vendor', null, `${TODAY} - 3`), [sennichimae])
    const waiting = await t.createUser('stock-wait@example.com')
    await expect(t.as(waiting, add('in', ok, 'vendor'), [sennichimae])).rejects.toThrow(/active users only/)
    await expect(t.as(staffM, `insert into public.stock_events (store_id, business_date, shift, kind, author_id, author_name) values ($1, ${TODAY}, 'early', 'in', auth.uid(), 'x')`, [sennichimae])).rejects.toThrow(/row-level security/)
  })

  it('終わりの在庫 needs every item; temperatures one per fridge', async () => {
    await expect(t.as(staffM, add('close', JSON.stringify([line('noodle', 481)])), [sennichimae])).rejects.toThrow(/count every item/)
    const all = JSON.stringify(items.map((i) => ({ item: i.id, qty: 1 })))
    await t.as(staffM, add('close', all), [sennichimae])
    await expect(t.as(staffM, add('temp_start', '[]', null, null, TODAY, `array[3, 3, 1]`), [sennichimae])).rejects.toThrow(/one temperature per fridge/)
    await t.as(staffM, add('temp_start', '[]', null, null, TODAY, `array[3, 3, 1, -18]`), [sennichimae])
    expect(await t.as(staffS, `select kind from public.stock_events where kind like 'temp%'`)).toEqual([{ kind: 'temp_start' }])
  })

  it('繰越 recount and 廃棄・破損 need a reason (その他 + memo); moved amounts must be > 0; both go to the 7:30 summary', async () => {
    const one = JSON.stringify([line('kimchi', 1)])
    const withReason = (kind: string, reason: string | null, note: string | null = null) =>
      `select public.add_stock_event($1, ${TODAY}, 'middle', '${kind}', '${one}'::jsonb, null, ${note ? `'${note}'` : 'null'}, null, ${reason ? `'${reason}'` : 'null'}) as id`
    await expect(t.as(staffM, withReason('loss', null), [sennichimae])).rejects.toThrow(/bad reason/)
    await expect(t.as(staffM, withReason('loss', 'miscount'), [sennichimae])).rejects.toThrow(/bad reason/)
    await expect(t.as(staffM, withReason('open', 'other'), [sennichimae])).rejects.toThrow(/note required/)
    await expect(t.as(staffM, add('in', JSON.stringify([line('kimchi', 0)]), 'vendor'), [sennichimae])).rejects.toThrow(/bad lines/)
    const [loss] = await t.as<{ id: string }>(staffM, withReason('loss', 'dropped'), [sennichimae])
    const [open] = await t.as<{ id: string }>(staffM, withReason('open', 'other', '箱がぬれていた'), [sennichimae])
    const [inRow] = await t.as<{ id: string }>(staffM, add('in', one, 'vendor'), [sennichimae])
    const [r] = await t.admin<{ reason: string }>(`select reason from public.stock_events where id = $1`, [inRow!.id])
    expect(r!.reason).toBeNull()
    const ev = await t.admin<{ ref_id: string }>(`select ref_id from public.notify_events where kind = 'stock' order by id`)
    expect(ev.map((e) => e.ref_id)).toEqual([loss!.id, open!.id])
    // a photo can be attached to the 廃棄・破損 row
    await t.admin(`insert into public.attachments (owner_id, stock_event_id, kind, file_name, mime_type, size_bytes) values ($1, $2, 'image', 'a.jpg', 'image/jpeg', 1)`, [staffM, loss!.id])
  })

  it('the writer or a manager cancels a row; others cannot', async () => {
    const [r] = await t.as<{ id: string }>(staffM, add('out', JSON.stringify([line('moyashi', 4)]), 'ebisubashi', 'ジョ'), [sennichimae])
    await expect(t.as(staffS, `select public.void_stock_event($1)`, [r!.id])).rejects.toThrow(/not allowed/)
    await t.as(staffM, `select public.void_stock_event($1)`, [r!.id])
    await expect(t.as(manager, `select public.void_stock_event($1)`, [r!.id])).rejects.toThrow(/not allowed/) // already cancelled
    const [r2] = await t.as<{ id: string }>(staffS, add('out', JSON.stringify([line('moyashi', 1)]), 'midosuji'), [sennichimae])
    await t.as(manager, `select public.void_stock_event($1)`, [r2!.id])
    const rows = await t.admin<{ voided_by_name: string }>(`select voided_by_name from public.stock_events where id in ($1, $2) order by voided_at`, [r!.id, r2!.id])
    expect(rows.map((x) => x.voided_by_name)).toEqual(['スタッフM', rows[1]!.voided_by_name])
    expect(rows[1]!.voided_by_name).not.toBe('スタッフM')
  })
})

describe('販売日報 (sales_reports)', () => {
  const save = (date: string, shift: string, data: object, submit = false) =>
    `select public.save_sales_report($1, ${date}, '${shift}', '${JSON.stringify(data)}'::jsonb, ${submit}) as id`
  const base = {
    tickets: { ramen: 154, chashu: 26, coupon: 0 },
    cash_counts: { '5000': 1, '1000': 11, '500': 7, '100': 52 },
    cash_carried: 24700,
    noodle_out: 180,
    noodle_lost: 0,
  }
  it('totals, 繰越 typed when there is no previous shift, 過不足 and 麺差引', async () => {
    const [r] = await t.as<{ id: string }>(staffS, save(TODAY, 'early', base), [sennichimae])
    const [row] = await t.admin<Record<string, unknown>>(`select ticket_total, cash_carried, cash_carried_manual, cash_actual, cash_expected, cash_diff, noodle_diff::int as noodle_diff, status from public.sales_reports where id = $1`, [r!.id])
    expect(row).toEqual({ ticket_total: 180, cash_carried: 24700, cash_carried_manual: true, cash_actual: 24700, cash_expected: 24700, cash_diff: 0, noodle_diff: 0, status: 'draft' })
  })
  it('the next shift carries the counted cash; a difference needs a reason to send; every save is logged', async () => {
    const data = { ...base, cash_carried: 1, cash_book: [{ time: '18:00', type: 'refund', detail: '券売機', name: 'A', amount: 100, reason: 'お釣りが出ない' }], cash_counts: { '1000': 24, '500': 1, '100': 1 } }
    const [r] = await t.as<{ id: string }>(staffS, save(TODAY, 'middle', data), [sennichimae])
    const [row] = await t.admin<Record<string, unknown>>(`select cash_carried, cash_carried_manual, cash_out, cash_expected, cash_actual, cash_diff from public.sales_reports where id = $1`, [r!.id])
    expect(row).toEqual({ cash_carried: 24700, cash_carried_manual: false, cash_out: 100, cash_expected: 24600, cash_actual: 24600, cash_diff: 0 })
    const off = { ...data, cash_counts: { '1000': 24 } }
    await expect(t.as(staffS, save(TODAY, 'middle', off, true), [sennichimae])).rejects.toThrow(/needs a reason/)
    await t.as(staffM, save(TODAY, 'middle', { ...off, cash_diff_reason: '数え間違い' }, true), [sennichimae])
    const log = await t.as<{ author_name: string; action: string }>(staffM, `select author_name, action from public.sales_report_log where report_id = $1 order by id`, [r!.id])
    expect(log).toEqual([{ author_name: 'スタッフS', action: 'save' }, { author_name: 'スタッフM', action: 'submit' }])
  })
  it('after 送信: writers may change it for 12 hours, then managers only; 送信 notifies (urgent when there is a difference)', async () => {
    const [r] = await t.as<{ id: string }>(staffS, save(TODAY, 'late', { ...base, cash_counts: { '1000': 24 } }, true), [sennichimae])
    // staffM never wrote it → locked for staffM; staffS (a writer) may still change it
    await expect(t.as(staffM, save(TODAY, 'late', base), [sennichimae])).rejects.toThrow(/locked/)
    await t.as(staffS, save(TODAY, 'late', { ...base, notes: '追記' }), [sennichimae])
    await t.admin(`update public.sales_reports set submitted_at = now() - interval '13 hours' where id = $1`, [r!.id])
    await expect(t.as(staffS, save(TODAY, 'late', base), [sennichimae])).rejects.toThrow(/locked/)
    await t.as(manager, save(TODAY, 'late', { ...base, notes: '管理者が修正' }), [sennichimae])
    const ev = await t.admin<{ ref_id: string; urgent: boolean }>(`select ref_id, urgent from public.notify_events where kind = 'sales' order by id`)
    // 中番 was sent with a 現金過不足 (urgent), 遅番 without
    expect(ev.map((e) => e.urgent)).toEqual([true, false])
    expect(ev[1]!.ref_id).toBe(r!.id)
  })
  it('refunds need a reason; bad values and other days are refused; no direct writes', async () => {
    await t.as(staffS, save(TODAY, 'early', { ...base, water: { '07:00': '12345' } }), [sennichimae]) // up to 5 digits
    await expect(t.as(staffS, save(TODAY, 'late', { cash_book: [{ type: 'refund', amount: 100 }] }), [sennichimae])).rejects.toThrow(/bad cash book/)
    await expect(t.as(staffS, save(TODAY, 'late', { tickets: { ramen: -1 } }), [sennichimae])).rejects.toThrow(/bad tickets/)
    await expect(t.as(staffS, save(TODAY, 'late', { water: { '23:00': '123456' } }), [sennichimae])).rejects.toThrow(/bad water/)
    await expect(t.as(staffS, save(`${TODAY} - 5`, 'late', base), [sennichimae])).rejects.toThrow(/date out of range/)
    await expect(t.as(staffS, `insert into public.sales_reports (store_id, business_date, shift) values ($1, ${TODAY}, 'late')`, [sennichimae])).rejects.toThrow(/row-level security/)
    const waiting = await t.createUser('sales-wait@example.com')
    expect(await t.as(waiting, `select id from public.sales_reports`)).toEqual([])
  })
})

describe('daily_sales (販売杯数)', () => {
  it('a sent 販売日報 writes ラーメン + チャーシューメン; a later change updates it; a draft does not; managers only read', async () => {
    await t.admin(`insert into public.daily_sales (store_id, business_date, shift, bowls, source) values ($1, ${TODAY} + 1, 'early', 999, 'excel')`, [midosuji])
    const data = (ramen: number) => JSON.stringify({ tickets: { ramen, chashu: 26, coupon: 3 }, cash_counts: { '1000': 1 }, cash_carried: 1000 })
    await t.as(staffM, `select public.save_sales_report($1, ${TODAY} + 1, 'early', '${data(100)}'::jsonb, false)`, [midosuji])
    const q = `select bowls, coupons, source from public.daily_sales where store_id = $1 and business_date = ${TODAY} + 1 and shift = 'early'`
    expect(await t.admin(q, [midosuji])).toEqual([{ bowls: 999, coupons: null, source: 'excel' }])
    await t.as(staffM, `select public.save_sales_report($1, ${TODAY} + 1, 'early', '${data(100)}'::jsonb, true)`, [midosuji])
    expect(await t.admin(q, [midosuji])).toEqual([{ bowls: 126, coupons: 3, source: 'report' }])
    await t.as(staffM, `select public.save_sales_report($1, ${TODAY} + 1, 'early', '${data(154)}'::jsonb, false)`, [midosuji])
    expect(await t.admin(q, [midosuji])).toEqual([{ bowls: 180, coupons: 3, source: 'report' }])
    expect(await t.as(staffM, `select * from public.daily_sales`)).toEqual([])
    expect((await t.as(manager, `select * from public.daily_sales`)).length).toBeGreaterThan(0)
  })
})

describe('目標杯数 v2 (six day types, events)', () => {
  it('the new day types are accepted; events: managers write, active users read', async () => {
    await t.as(manager, `insert into public.target_bowls (store_id, month, shift, day_type, bowls) values ($1, '2027-08-01', 'early', 'peak', 400)`, [midosuji])
    await expect(t.as(manager, `insert into public.target_bowls (store_id, month, shift, day_type, bowls) values ($1, '2027-08-01', 'early', 'xmas', 1)`, [midosuji])).rejects.toThrow(/day_type_check/)
    await expect(t.as(staffM, `insert into public.target_events (event_date, name) values ('2027-01-01', 'x')`)).rejects.toThrow(/row-level security/)
    await t.as(manager, `insert into public.target_events (event_date, name, middle_pct) values ('2027-01-01', '初詣', 20)`)
    expect((await t.as<{ name: string }>(staffM, `select name from public.target_events where event_date = '2027-01-01'`)).map((r) => r.name)).toEqual(['初詣'])
    const seeded = await t.admin<{ n: number }>(`select count(*)::int as n from public.target_events where name like '阪神%'`)
    expect(seeded[0]!.n).toBeGreaterThan(0)
  })
})
