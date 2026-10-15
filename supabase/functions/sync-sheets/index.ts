// Rewrites the Google Sheets copy of all records (daily at 07:30 JST via pg_cron, or on demand by a manager).
// Values are written RAW so free text such as "=..." is never evaluated as a formula.
import { ensureFolder, google, googleToken, kvGet, kvSet, ROOT_FOLDER_NAME } from '../_shared/google.ts'
import { adminClient, env, HttpError, requireUser, serve } from '../_shared/http.ts'

const TITLE = '金龍 朝礼・巡回 データ'
const SHIFT = { early: '早番', middle: '中番', late: '遅番' } as Record<string, string>
const JUDGE = { good: '良好', improve: '要改善', coaching: '即日指導' } as Record<string, string>
const STATUS = { valid: '有効', void: '無効' } as Record<string, string>
const PATROL_TYPE = { before_shift: '勤務前', in_shift: '勤務中', after_shift: '勤務後', random: 'ランダム' } as Record<string, string>
const STEPS = { greeting: '挨拶', philosophy: '経営理念', phrases: '接客用語', handover: '引継ぎ', grooming: '身だしなみ', closing: '締め' } as Record<string, string>

type Cell = string | number | boolean | null

const FIELD_JA: Record<string, string> = { stock_text: '在庫', caution_text: '注意点', skip_reason: '理由', good_points: '良かった点', improvements: '改善点', remarks: '備考', customer_reason: '⑥いいえの理由' }
/** "[vi] 良かった点: … / 改善点: …" for translated records, empty otherwise */
const originals = (texts: Record<string, string> | null, lang: string | null) =>
  texts ? `[${lang ?? '?'}] ` + Object.entries(texts).map(([k, v]) => `${FIELD_JA[k] ?? k}: ${v}`).join(' / ') : ''

const ISSUE_JA: Record<string, string> = { smile: '笑顔', voice: '声出し・接客用語', grooming: '身だしなみ', clean: '清潔', quality: '提供品質', other: 'その他' }
/** "カン（声出し・接客用語、清潔）、ド（笑顔）" / "全体" / "" (sent before tags existed) */
const issueTags = (tags: { staff: string; category: string }[] | null) => {
  if (!tags) return ''
  if (!tags.length) return '全体'
  const by = new Map<string, string[]>()
  for (const t of tags) by.set(t.staff, [...(by.get(t.staff) ?? []), ISSUE_JA[t.category] ?? t.category])
  return [...by].map(([s, c]) => `${s}（${c.join('、')}）`).join('、')
}

const jst = (ts: string | null) =>
  ts ? new Date(ts).toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 16) : ''

async function ensureSpreadsheet(admin: ReturnType<typeof adminClient>, sheetNames: string[]): Promise<string> {
  let id = await kvGet(admin, 'sheets_id')
  if (id) {
    try {
      await google(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=spreadsheetId`)
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) id = null
      else throw err
    }
  }
  if (!id) {
    const created = await google<{ spreadsheetId: string; spreadsheetUrl: string }>('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      body: JSON.stringify({
        properties: { title: TITLE, locale: 'ja_JP', timeZone: 'Asia/Tokyo' },
        sheets: sheetNames.map((title) => ({ properties: { title, gridProperties: { frozenRowCount: 1 } } })),
      }),
    })
    id = created.spreadsheetId
    const folder = await ensureFolder(admin, [])
    await google(`https://www.googleapis.com/drive/v3/files/${id}?addParents=${folder}&removeParents=root&fields=id`, { method: 'PATCH', body: '{}' })
    await kvSet(admin, 'sheets_id', id)
    await kvSet(admin, 'sheets_url', created.spreadsheetUrl)
  }
  // add any sheet that someone deleted
  const meta = await google<{ sheets: { properties: { title: string } }[] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties.title`,
  )
  const existing = new Set(meta.sheets.map((s) => s.properties.title))
  const missing = sheetNames.filter((n) => !existing.has(n))
  if (missing.length) {
    await google(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: missing.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) }),
    })
  }
  return id
}

// ---- バックアップ (owner, 2026-10-15): every Monday 4:30 JST (and from 管理 → システム状態) every business
// table goes to Drive as one gzip-compressed JSON file per table in 金龍 朝礼・巡回/バックアップ/<date>/.
// Backups older than 12 weeks are deleted. No secrets are in these tables; photos are already in Drive.

const BACKUP_TABLES = [
  'stores', 'profiles', 'bootstrap_accounts', 'staff_roster', 'holidays', 'target_bowls', 'target_events',
  'chorei_records', 'chorei_notes', 'chorei_comments', 'chorei_misses', 'patrol_checks', 'patrol_comments', 'staff_interviews',
  'attachments', 'shift_requests', 'shift_assignments', 'duty_assignments', 'shift_changes', 'shift_offers', 'staff_limits',
  'attendance_overrides', 'stock_items', 'stock_events', 'sales_reports', 'sales_report_log', 'daily_sales', 'incidents',
  'emergency_contacts', 'emergency_contact_log', 'lost_items', 'lost_item_comments',
  'learn_items', 'notify_recipients', 'ai_reports', 'audit_log',
]
const KEEP_DAYS = 84

async function gzipJson(value: unknown): Promise<Uint8Array> {
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function uploadFile(folderId: string, name: string, bytes: Uint8Array) {
  const boundary = `kinryu${crypto.randomUUID()}`
  const meta = JSON.stringify({ name, parents: [folderId], mimeType: 'application/gzip' })
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/gzip\r\n\r\n`,
    bytes,
    `\r\n--${boundary}--`,
  ])
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await googleToken()}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  if (!res.ok) throw new HttpError(502, `drive upload ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

async function allRows(admin: ReturnType<typeof adminClient>, table: string) {
  const out: unknown[] = []
  for (let i = 0; ; i += 1000) {
    const { data, error } = await admin.from(table).select('*').range(i, i + 999)
    if (error) throw new Error(error.message)
    out.push(...data)
    if (data.length < 1000) return out
  }
}

async function runBackup(admin: ReturnType<typeof adminClient>) {
  const date = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  const folderId = await ensureFolder(admin, ['バックアップ', date])
  const tables: Record<string, number> = {}
  const errors: Record<string, string> = {}
  let bytes = 0
  for (const t of BACKUP_TABLES) {
    try {
      const rows = await allRows(admin, t)
      const gz = await gzipJson({ table: t, exported_at: new Date().toISOString(), rows })
      await uploadFile(folderId, `${t}.json.gz`, gz)
      tables[t] = rows.length
      bytes += gz.length
    } catch (err) {
      errors[t] = err instanceof Error ? err.message : String(err)
    }
  }
  // keep 12 weeks: the date folders under バックアップ older than that go to the trash
  const parent = await ensureFolder(admin, ['バックアップ'])
  const cutoff = new Date(Date.now() + 9 * 3600_000 - KEEP_DAYS * 86400_000).toISOString().slice(0, 10)
  const list = await google<{ files: { id: string; name: string }[] }>(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${parent}' in parents and trashed = false`)}&fields=files(id,name)&pageSize=200`,
  )
  let removed = 0
  for (const f of list.files) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(f.name) && f.name < cutoff) {
      await google(`https://www.googleapis.com/drive/v3/files/${f.id}`, { method: 'PATCH', body: JSON.stringify({ trashed: true }) })
      removed++
    }
  }
  await kvSet(admin, 'backup_at', new Date().toISOString())
  await kvSet(admin, 'backup_url', `https://drive.google.com/drive/folders/${folderId}`)
  await kvSet(admin, 'backup_result', JSON.stringify({ tables: Object.keys(tables).length, rows: Object.values(tables).reduce((a, b) => a + b, 0), bytes, errors }))
  return { date, tables, bytes, errors, removed, url: `https://drive.google.com/drive/folders/${folderId}` }
}

// ---- 天気 (Namba): Open-Meteo hourly → business date × shift (遅番 23:00–6:59 belongs to the day it starts)
const WX_LAT = 34.67
const WX_LON = 135.5
const WX_FROM = '2025-01-01'
type Hourly = { time: string[]; temperature_2m: (number | null)[]; precipitation: (number | null)[] }

function addDay(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function weatherRows(h: Hourly, source: 'archive' | 'forecast') {
  const m = new Map<string, { t: number[]; p: number[]; n: number }>()
  h.time.forEach((t, i) => {
    const date = t.slice(0, 10)
    const hr = Number(t.slice(11, 13))
    const [d, shift] = hr >= 7 && hr < 17 ? [date, 'early'] : hr >= 17 && hr < 23 ? [date, 'middle'] : hr >= 23 ? [date, 'late'] : [addDay(date, -1), 'late']
    const k = `${d}|${shift}`
    const v = m.get(k) ?? { t: [], p: [], n: 0 }
    if (h.temperature_2m[i] !== null) v.t.push(h.temperature_2m[i]!)
    if (h.precipitation[i] !== null) v.p.push(h.precipitation[i]!)
    if (h.temperature_2m[i] !== null || h.precipitation[i] !== null) v.n++
    m.set(k, v)
  })
  const full = { early: 10, middle: 6, late: 8 } as Record<string, number>
  const r1 = (x: number) => Math.round(x * 10) / 10
  return [...m]
    .filter(([k, v]) => v.n >= full[k.split('|')[1]!]!) // only complete shifts
    .map(([k, v]) => {
      const [business_date, shift] = k.split('|')
      return {
        business_date,
        shift,
        temp_avg: v.t.length ? r1(v.t.reduce((a, x) => a + x, 0) / v.t.length) : null,
        temp_min: v.t.length ? r1(Math.min(...v.t)) : null,
        temp_max: v.t.length ? r1(Math.max(...v.t)) : null,
        precip_mm: r1(v.p.reduce((a, x) => a + x, 0)),
        rain_hours: v.p.filter((x) => x >= 0.5).length,
        hours: v.n,
        source,
        fetched_at: new Date().toISOString(),
      }
    })
}

/** Archive from the last archived day (or 2025-01-01) to yesterday, then the forecast (7 days back … 16 ahead) for the rest. */
async function runWeather(admin: ReturnType<typeof adminClient>) {
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  const { data: last } = await admin.from('weather_shifts').select('business_date').eq('source', 'archive').order('business_date', { ascending: false }).limit(1)
  const from = last?.[0] ? addDay(last[0].business_date as string, -3) : WX_FROM
  const q = `latitude=${WX_LAT}&longitude=${WX_LON}&hourly=temperature_2m,precipitation&timezone=Asia%2FTokyo`
  const [a, f] = await Promise.all([
    fetch(`https://archive-api.open-meteo.com/v1/archive?${q}&start_date=${from}&end_date=${addDay(today, -1)}`),
    fetch(`https://api.open-meteo.com/v1/forecast?${q}&past_days=7&forecast_days=16`),
  ])
  if (!a.ok || !f.ok) throw new HttpError(502, `open-meteo ${a.status} / ${f.status}`)
  const archive = weatherRows(((await a.json()) as { hourly: Hourly }).hourly, 'archive')
  const archived = new Set(archive.map((r) => `${r.business_date}|${r.shift}`))
  const forecast = weatherRows(((await f.json()) as { hourly: Hourly }).hourly, 'forecast').filter((r) => !archived.has(`${r.business_date}|${r.shift}`))
  const rows = [...archive, ...forecast]
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await admin.from('weather_shifts').upsert(rows.slice(i, i + 1000), { onConflict: 'business_date,shift' })
    if (error) throw new HttpError(500, error.message)
  }
  return { from, archive: archive.length, forecast: forecast.length }
}

serve(async (req) => {
  const admin = adminClient()
  const cronSecret = req.headers.get('x-cron-secret')
  if (cronSecret) {
    if (cronSecret !== env('SHEETS_SYNC_SECRET')) throw new HttpError(401, 'bad cron secret')
  } else {
    const caller = await requireUser(req, admin)
    if (!caller.isManager) throw new HttpError(403, 'managers only')
    if (caller.isTestAccount) throw new HttpError(403, 'test account: read only')
  }
  const body = (await req.clone().json().catch(() => ({}))) as { action?: string }
  if (body.action === 'backup') return runBackup(admin)
  if (body.action === 'weather') return runWeather(admin)

  const [stores, profiles, chorei, patrols, attachments, misses, stockLosses] = await Promise.all([
    admin.from('stores').select('id, name_ja'),
    admin.from('profiles').select('id, display_name, full_name'),
    admin.from('chorei_records').select('*').eq('by_test_account', false).order('business_date', { ascending: false }).order('shift'),
    admin.from('patrol_checks').select('*').eq('by_test_account', false).neq('status', 'draft').order('business_date', { ascending: false }).order('started_at', { ascending: false }),
    admin.from('attachments').select('*').eq('status', 'uploaded').is('incident_id', null).is('lost_item_id', null).order('created_at', { ascending: false }),
    admin.from('chorei_misses').select('id, store_id, business_date, shift').eq('by_test_account', false),
    admin.from('stock_events').select('id, store_id, business_date, shift').eq('kind', 'loss').eq('by_test_account', false),
  ])
  for (const r of [stores, profiles, chorei, patrols, attachments, misses, stockLosses]) if (r.error) throw new HttpError(500, r.error.message)

  const storeName = new Map(stores.data!.map((s) => [s.id, s.name_ja]))
  // 氏名 for aggregation; the short display name is kept in its own column
  const person = new Map(profiles.data!.map((p) => [p.id, p.full_name || `${p.display_name || '?'}（氏名未登録）`]))
  const shortName = new Map(profiles.data!.map((p) => [p.id, p.display_name || '']))
  const attachCount = new Map<string, number>()
  for (const a of attachments.data!) {
    const key = a.chorei_id ?? a.patrol_id
    attachCount.set(key, (attachCount.get(key) ?? 0) + 1)
  }
  const choreiById = new Map(chorei.data!.map((c) => [c.id, c]))
  const patrolById = new Map(patrols.data!.map((p) => [p.id, p]))
  const missById = new Map(misses.data!.map((m) => [m.id, m]))
  const lossById = new Map(stockLosses.data!.map((m) => [m.id, m]))

  const sheets: Record<string, Cell[][]> = {
    朝礼記録: [
      ['日付', '店舗', 'シフト', '誘導者（氏名）', '誘導者（表示名）', '参加者', '在庫', '目標杯数', '注意点', '未実施の手順', '理由', '送信日時', '状態', '無効の理由', '添付数', '原文（翻訳前）', 'テスト', 'ID'],
      ...chorei.data!.map((c) => [
        c.business_date,
        storeName.get(c.store_id) ?? '',
        SHIFT[c.shift] ?? c.shift,
        person.get(c.leader_id) ?? '',
        shortName.get(c.leader_id) ?? '',
        [...(c.participants as string[]).map((id) => person.get(id) ?? '?'), ...(c.participants_extra as string[])].join('、'),
        c.stock_none ? 'なし' : (c.stock_text ?? ''),
        c.target_bowls,
        c.caution_text ?? '',
        Object.entries(c.steps_done as Record<string, boolean>).filter(([, done]) => !done).map(([k]) => STEPS[k] ?? k).join('、'),
        c.skip_reason ?? '',
        jst(c.submitted_at),
        STATUS[c.status] ?? c.status,
        c.void_reason ?? '',
        attachCount.get(c.id) ?? 0,
        originals(c.original_texts, c.source_lang),
        c.is_test ? 'テスト' : '',
        c.id,
      ]),
    ],
    巡回チェック: [
      ['日付', '店舗', 'シフト', '種類', '巡回者（氏名）', '巡回者（表示名）', '開始', '終了', '分', '①笑顔', 'マスク', '②声出し', '③身だしなみ', '④清潔', '⑤提供品質', '合計', '満点', '判定', '⑥お客様の満足度', '⑥いいえの理由', '対象スタッフ', '良かった点', '改善点・指導内容', '改善点の対象', '備考', '時間確認', '状態', '添付数', '原文（翻訳前）', 'テスト', 'ID'],
      ...patrols.data!.map((p) => [
        p.business_date,
        storeName.get(p.store_id) ?? '',
        SHIFT[p.shift] ?? p.shift,
        PATROL_TYPE[p.patrol_type] ?? p.patrol_type,
        person.get(p.patroller_id) ?? '',
        shortName.get(p.patroller_id) ?? '',
        jst(p.started_at),
        jst(p.ended_at),
        p.duration_min,
        p.score_smile,
        p.mask_worn ? 'あり' : '',
        p.score_voice,
        p.score_grooming,
        p.score_clean,
        p.score_quality ?? '－',
        p.total,
        p.max_total,
        JUDGE[p.judgement] ?? '',
        p.customer_none ? 'お客様なし' : p.customer_satisfied === true ? 'はい' : p.customer_satisfied === false ? 'いいえ' : '',
        p.customer_reason ?? '',
        p.staff_on_shift,
        p.good_points ?? '',
        p.improvements ?? '',
        issueTags(p.issue_tags),
        p.remarks ?? '',
        p.needs_time_review ? '要確認' : '',
        STATUS[p.status] ?? p.status,
        attachCount.get(p.id) ?? 0,
        originals(p.original_texts, p.source_lang),
        p.is_test ? 'テスト' : '',
        p.id,
      ]),
    ],
    添付ファイル: [
      ['日付', '店舗', 'シフト', '記録', '投稿者（氏名）', '種類', 'ファイル名', 'サイズ(MB)', '秒', 'Driveリンク', '登録日時', '記録ID'],
      ...attachments.data!.map((a) => {
        const parent = a.chorei_id ? choreiById.get(a.chorei_id) : a.patrol_id ? patrolById.get(a.patrol_id) : a.miss_id ? missById.get(a.miss_id) : lossById.get(a.stock_event_id)
        return [
          parent?.business_date ?? '',
          parent ? (storeName.get(parent.store_id) ?? '') : '',
          parent ? (SHIFT[parent.shift] ?? '') : '',
          a.chorei_id ? '朝礼' : a.patrol_id ? '巡回' : a.miss_id ? '朝礼なし（理由）' : '在庫（廃棄・破損）',
          person.get(a.owner_id) ?? '',
          a.kind === 'video' ? '動画' : '写真',
          a.file_name,
          Math.round((a.size_bytes / 1024 / 1024) * 10) / 10,
          a.duration_sec,
          a.drive_url ?? '',
          jst(a.created_at),
          a.chorei_id ?? a.patrol_id ?? a.miss_id ?? a.stock_event_id,
        ]
      }),
    ],
  }

  const names = Object.keys(sheets)
  const id = await ensureSpreadsheet(admin, names)
  await google(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchClear`, {
    method: 'POST',
    body: JSON.stringify({ ranges: names.map((n) => `'${n}'`) }),
  })
  await google(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: names.map((n) => ({ range: `'${n}'!A1`, values: sheets[n]!.map((row) => row.map((v) => v ?? '')) })),
    }),
  })
  const syncedAt = new Date().toISOString()
  await kvSet(admin, 'sheets_synced_at', syncedAt)
  return {
    ok: true,
    url: await kvGet(admin, 'sheets_url'),
    syncedAt,
    folder: ROOT_FOLDER_NAME,
    rows: Object.fromEntries(names.map((n) => [n, sheets[n]!.length - 1])),
  }
})
