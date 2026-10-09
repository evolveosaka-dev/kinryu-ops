// Rewrites the Google Sheets copy of all records (daily at 07:30 JST via pg_cron, or on demand by a manager).
// Values are written RAW so free text such as "=..." is never evaluated as a formula.
import { ensureFolder, google, kvGet, kvSet, ROOT_FOLDER_NAME } from '../_shared/google.ts'
import { adminClient, env, HttpError, requireUser, serve } from '../_shared/http.ts'

const TITLE = '金龍 朝礼・巡回 データ'
const SHIFT = { early: '早番', middle: '中番', late: '遅番' } as Record<string, string>
const JUDGE = { good: '良好', improve: '要改善', coaching: '即日指導' } as Record<string, string>
const STATUS = { valid: '有効', void: '無効' } as Record<string, string>
const PATROL_TYPE = { before_shift: '勤務前', in_shift: '勤務中', after_shift: '勤務後', random: 'ランダム' } as Record<string, string>
const STEPS = { greeting: '挨拶', philosophy: '経営理念', phrases: '接客用語', handover: '引継ぎ', grooming: '身だしなみ', closing: '締め' } as Record<string, string>

type Cell = string | number | boolean | null

const FIELD_JA: Record<string, string> = { stock_text: '在庫', caution_text: '注意点', skip_reason: '理由', good_points: '良かった点', improvements: '改善点', remarks: '備考' }
/** "[vi] 良かった点: … / 改善点: …" for translated records, empty otherwise */
const originals = (texts: Record<string, string> | null, lang: string | null) =>
  texts ? `[${lang ?? '?'}] ` + Object.entries(texts).map(([k, v]) => `${FIELD_JA[k] ?? k}: ${v}`).join(' / ') : ''

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

serve(async (req) => {
  const admin = adminClient()
  const cronSecret = req.headers.get('x-cron-secret')
  if (cronSecret) {
    if (cronSecret !== env('SHEETS_SYNC_SECRET')) throw new HttpError(401, 'bad cron secret')
  } else {
    const caller = await requireUser(req, admin)
    if (!caller.isManager) throw new HttpError(403, 'managers only')
  }

  const [stores, profiles, chorei, patrols, attachments] = await Promise.all([
    admin.from('stores').select('id, name_ja'),
    admin.from('profiles').select('id, display_name, full_name'),
    admin.from('chorei_records').select('*').order('business_date', { ascending: false }).order('shift'),
    admin.from('patrol_checks').select('*').neq('status', 'draft').order('business_date', { ascending: false }).order('started_at', { ascending: false }),
    admin.from('attachments').select('*').eq('status', 'uploaded').order('created_at', { ascending: false }),
  ])
  for (const r of [stores, profiles, chorei, patrols, attachments]) if (r.error) throw new HttpError(500, r.error.message)

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
      ['日付', '店舗', 'シフト', '種類', '巡回者（氏名）', '巡回者（表示名）', '開始', '終了', '分', '①笑顔', 'マスク', '②声出し', '③身だしなみ', '④清潔', '⑤提供品質', '合計', '満点', '判定', '対象スタッフ', '良かった点', '改善点・指導内容', '備考', '時間確認', '状態', '添付数', '原文（翻訳前）', 'テスト', 'ID'],
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
        p.staff_on_shift,
        p.good_points ?? '',
        p.improvements ?? '',
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
        const parent = a.chorei_id ? choreiById.get(a.chorei_id) : patrolById.get(a.patrol_id)
        return [
          parent?.business_date ?? '',
          parent ? (storeName.get(parent.store_id) ?? '') : '',
          parent ? (SHIFT[parent.shift] ?? '') : '',
          a.chorei_id ? '朝礼' : '巡回',
          person.get(a.owner_id) ?? '',
          a.kind === 'video' ? '動画' : '写真',
          a.file_name,
          Math.round((a.size_bytes / 1024 / 1024) * 10) / 10,
          a.duration_sec,
          a.drive_url ?? '',
          jst(a.created_at),
          a.chorei_id ?? a.patrol_id,
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
