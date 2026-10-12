// Manager e-mail notifications through Resend.
//  - action "instant" (pg_cron every minute while events wait): one mail per event to the recipients in
//    'instant' mode, and to everyone for urgent events (即日指導, sign-up).
//  - action "digest" (pg_cron 7:30 JST): one summary mail per 'digest' recipient.
//  - action "test" (a manager, 設定 → 通知メール): a test mail to one recipient.
// The cron caller sends x-cron-secret (checked against Vault); managers send their access token.
import { adminClient, env, HttpError, requireUser, serve } from '../_shared/http.ts'

type Admin = ReturnType<typeof adminClient>
type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

interface Recipient {
  id: string
  email: string
  name: string
  mode: 'instant' | 'digest'
  kinds: string[]
  active: boolean
}
interface NotifyEvent {
  id: number
  kind: string
  urgent: boolean
  ref_table: string
  ref_id: string
  actor_id: string | null
  data: Row
  dedupe_key: string | null
  created_at: string
  attempts: number
}
interface Mail {
  to: string
  subject: string
  text: string
}

const SHIFT: Record<string, string> = { early: '早番', middle: '中番', late: '遅番' }
const MEETING: Record<string, string> = { early: '7:00', middle: '17:00', late: '23:00' }
const JUDGE: Record<string, string> = { good: '良好', improve: '要改善', coaching: '即日指導' }
const PATROL_TYPE: Record<string, string> = { before_shift: '勤務前', in_shift: '勤務中', after_shift: '勤務後', random: 'ランダム', early: '勤務前' }
const STEPS: Record<string, string> = { greeting: 'はじめの挨拶', philosophy: '経営理念', phrases: '接客用語', handover: '引継ぎ', grooming: '身だしなみ', closing: '締めの挨拶' }
const ITEMS: [string, string][] = [['score_smile', '笑顔'], ['score_voice', '声出し'], ['score_grooming', '身だしなみ'], ['score_clean', '清潔'], ['score_quality', '提供品質']]
const ACTION: Record<string, string> = { void: '取消', time: '時間の修正', follow_up: '面談済み', update: '修正' }
const KIND: Record<string, string> = { chorei: '朝礼記録', chorei_note: '朝礼の追記', patrol: '巡回チェック', shift_request: 'シフト希望', signup: '新規登録', edit: '修正・取消' }
const TABLE: Record<string, string> = { chorei_records: '朝礼記録', patrol_checks: '巡回チェック', shift_requests: 'シフト希望' }
const FIELD: Record<string, string> = {
  status: '状態', void_reason: '取消の理由', started_at: '開始', ended_at: '終了', needs_time_review: '時間確認',
  follow_up_done_at: '面談日時', follow_up_note: '面談メモ', shifts: '希望の勤番', days: '希望日', answers: '質問の回答',
}
const STATUS: Record<string, string> = { valid: '有効', void: '取消', draft: '下書き' }
const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土']
const SHIFT_WAIT_MIN = 10 // シフト希望 edits within 10 minutes become one mail

const appUrl = (path: string) => `${env('APP_URL', 'https://evolveosaka-dev.github.io/kinryu-ops/')}#${path}`
const day = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}(${WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()]})`
const jst = (ts: string | null | undefined) => (ts ? new Date(ts).toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 16) : '—')
const hm = (ts: string | null | undefined) => jst(ts).slice(11)
const tokyoToday = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 10)
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10)
const FOOTER = '\n\n――――――――――\n金龍ラーメン専用アプリ\n通知の設定: 管理 → 設定 → 通知メール'

class Lookup {
  stores = new Map<string, string>()
  people = new Map<string, Row>()
  constructor(private admin: Admin) {}
  async load() {
    const [s, p] = await Promise.all([
      this.admin.from('stores').select('id, name_ja'),
      this.admin.from('profiles').select('id, display_name, full_name, email, roster_name'),
    ])
    if (s.error || p.error) throw new HttpError(500, (s.error ?? p.error)!.message)
    for (const r of s.data) this.stores.set(r.id, r.name_ja)
    for (const r of p.data) this.people.set(r.id, r)
    return this
  }
  store = (id: string) => this.stores.get(id) ?? '?'
  person = (id: string | null | undefined) => {
    const p = id ? this.people.get(id) : null
    return p ? p.full_name || p.display_name || p.email || '?' : '—'
  }
}

async function fetchRow(admin: Admin, table: string, id: string): Promise<Row | null> {
  const { data, error } = await admin.from(table).select('*').eq('id', id).maybeSingle()
  if (error) throw new HttpError(500, error.message)
  return data
}

async function photoCount(admin: Admin, column: 'chorei_id' | 'patrol_id', id: string) {
  const { count } = await admin.from('attachments').select('id', { count: 'exact', head: true }).eq(column, id).neq('status', 'failed')
  return count ?? 0
}

const slot = (L: Lookup, r: Row) => `${L.store(r.store_id)} ${day(r.business_date)} ${SHIFT[r.shift] ?? r.shift}`

function choreiLines(L: Lookup, r: Row, photos: number): string[] {
  const skipped = Object.entries(r.steps_done ?? {}).filter(([, v]) => v === false).map(([k]) => STEPS[k] ?? k)
  return [
    `店舗・勤番: ${slot(L, r)}（${MEETING[r.shift] ?? ''}）`,
    `誘導者: ${L.person(r.leader_id)}`,
    `参加: ${(r.participants?.length ?? 0) + (r.participants_extra?.length ?? 0)}名${r.participants_extra?.length ? `（${r.participants_extra.join('、')}）` : ''}`,
    `在庫: ${r.stock_none ? '特になし' : r.stock_text}`,
    `目標杯数: ${r.target_bowls ?? '—'}杯`,
    `注意点: ${r.caution_text || '—'}`,
    `6ステップ: ${skipped.length ? `未実施 ${skipped.join('、')}（理由: ${r.skip_reason ?? ''}）` : 'すべて実施'}`,
    `写真・動画: ${photos}件`,
    `送信: ${jst(r.submitted_at)}`,
  ]
}

function patrolLines(L: Lookup, r: Row, photos: number): string[] {
  const items = ITEMS.map(([k, n]) => `${n} ${r[k] ?? '－'}`).join(' / ')
  return [
    `店舗・勤番: ${slot(L, r)}`,
    `巡回者: ${L.person(r.patroller_id)}（${PATROL_TYPE[r.patrol_type] ?? r.patrol_type}）`,
    `時間: ${hm(r.started_at)}–${hm(r.ended_at)}（${r.duration_min ?? '—'}分）${r.needs_time_review ? ' ⚠ 時間確認が必要' : ''}`,
    `点数: ${r.total} / ${r.max_total}　判定: ${JUDGE[r.judgement] ?? r.judgement}`,
    `内訳: ${items}${r.mask_worn ? '（マスク利用）' : ''}`,
    ...(r.customer_none ? ['⑥お客様の満足度: お客様なし'] : r.customer_satisfied === true ? ['⑥お客様の満足度: はい'] : r.customer_satisfied === false ? [`⚠ ⑥お客様の満足度: いいえ（理由: ${r.customer_reason ?? ''}）`] : []),
    `勤務者: ${r.staff_names?.length ? r.staff_names.join('、') : r.staff_on_shift}`,
    `良かった点: ${r.good_points ?? ''}`,
    `改善点・指導内容: ${r.improvements ?? ''}`,
    ...(r.remarks ? [`備考: ${r.remarks}`] : []),
    `写真・動画: ${photos}件`,
  ]
}

function shiftRequestLines(L: Lookup, r: Row): string[] {
  const days = Object.values(r.days ?? {}).filter((d) => d && Object.keys(d as Row).length > 0).length
  const msg = (r.answers?.message ?? '').trim()
  return [
    `名前: ${L.person(r.user_id)}`,
    `対象月: ${Number(String(r.month).slice(5, 7))}月`,
    `希望の勤番: ${(r.shifts ?? []).map((s: string) => SHIFT[s] ?? s).join('・')}`,
    `出勤できる日: ${days}日`,
    ...(msg ? [`メッセージ: ${msg}`] : []),
    `提出: ${jst(r.submitted_at)}　最終更新: ${jst(r.updated_at)}`,
  ]
}

const showValue = (v: unknown) => {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)) return jst(v)
  if (typeof v === 'string') return STATUS[v] ?? v
  if (typeof v === 'boolean') return v ? 'はい' : 'いいえ'
  return JSON.stringify(v).slice(0, 80)
}

/** Subject + body of one event; null when its record is gone. */
async function renderEvent(admin: Admin, L: Lookup, e: NotifyEvent): Promise<{ subject: string; lines: string[]; link: string } | null> {
  if (e.kind === 'chorei') {
    const r = await fetchRow(admin, 'chorei_records', e.ref_id)
    if (!r) return null
    return { subject: `朝礼記録 ${slot(L, r)} — ${L.person(r.leader_id)}`, lines: choreiLines(L, r, await photoCount(admin, 'chorei_id', r.id)), link: appUrl('/manager/chorei') }
  }
  if (e.kind === 'chorei_note') {
    const n = await fetchRow(admin, 'chorei_notes', e.ref_id)
    const r = n && (await fetchRow(admin, 'chorei_records', n.chorei_id))
    if (!n || !r) return null
    return {
      subject: `朝礼の追記 ${slot(L, r)} — ${L.person(n.author_id)}`,
      lines: [`朝礼: ${slot(L, r)}（誘導者 ${L.person(r.leader_id)}）`, `追記した人: ${L.person(n.author_id)}`, `内容: ${n.body}`, `時刻: ${jst(n.created_at)}`],
      link: appUrl('/manager/chorei'),
    }
  }
  if (e.kind === 'patrol') {
    const r = await fetchRow(admin, 'patrol_checks', e.ref_id)
    if (!r) return null
    const head = r.judgement === 'coaching' ? '⚠ 即日指導 ' : ''
    return {
      subject: `${head}巡回チェック ${slot(L, r)} ${r.total}/${r.max_total} ${JUDGE[r.judgement] ?? ''} — ${L.person(r.patroller_id)}`,
      lines: patrolLines(L, r, await photoCount(admin, 'patrol_id', r.id)),
      link: appUrl('/manager/patrol'),
    }
  }
  if (e.kind === 'shift_request') {
    const r = await fetchRow(admin, 'shift_requests', e.ref_id)
    if (!r) return null
    const what = e.data.first ? 'シフト希望の提出' : 'シフト希望の変更'
    return { subject: `${what} ${Number(String(r.month).slice(5, 7))}月 — ${L.person(r.user_id)}`, lines: shiftRequestLines(L, r), link: appUrl('/manager/shift-requests') }
  }
  if (e.kind === 'signup') {
    const p = await fetchRow(admin, 'profiles', e.ref_id)
    if (!p) return null
    const what = e.data.reapply ? '承認の再申請' : '新規登録'
    return {
      subject: `${what}（承認待ち） — ${p.full_name || p.display_name || p.email}`,
      lines: [`氏名: ${p.full_name || '（未入力）'}`, `表示名: ${p.display_name || '—'}`, `メール: ${p.email ?? '—'}`, `日時: ${jst(e.created_at)}`, '', '管理 → 設定 → ユーザー で「承認」または「却下」してください。'],
      link: appUrl('/manager/users'),
    }
  }
  if (e.kind === 'edit') {
    const r = await fetchRow(admin, e.ref_table, e.ref_id)
    if (!r) return null
    const action = ACTION[e.data.action] ?? '修正'
    const what = TABLE[e.ref_table] ?? e.ref_table
    const target = e.ref_table === 'shift_requests' ? `${Number(String(r.month).slice(5, 7))}月 ${L.person(r.user_id)}` : slot(L, r)
    const changes = Object.entries((e.data.changes ?? {}) as Record<string, { old: unknown; new: unknown }>)
      .map(([k, v]) => `・${FIELD[k] ?? k}: ${showValue(v.old)} → ${showValue(v.new)}`)
    return {
      subject: `${action}: ${what} ${target} — ${L.person(e.actor_id)}`,
      lines: [`対象: ${what} ${target}`, `操作: ${action}`, `操作した人: ${L.person(e.actor_id)}`, `日時: ${jst(e.created_at)}`, ...(changes.length ? ['変更内容:', ...changes] : [])],
      link: appUrl(e.ref_table === 'patrol_checks' ? '/manager/patrol' : e.ref_table === 'chorei_records' ? '/manager/chorei' : '/manager/shift-requests'),
    }
  }
  return null
}

async function sendBatch(mails: Mail[], idempotencyKey: string) {
  for (let i = 0; i < mails.length; i += 100) {
    const chunk = mails.slice(i, i + 100)
    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `${idempotencyKey}-${i}`,
      },
      body: JSON.stringify(chunk.map((m) => ({
        from: env('RESEND_FROM', '金龍ラーメン専用アプリ <support@avecvous-evolve.com>'),
        reply_to: env('NOTIFY_REPLY_TO', 'evolve.osaka@gmail.com'),
        to: [m.to],
        subject: `【金龍】${m.subject}`,
        text: m.text,
      }))),
    })
    if (!res.ok) throw new HttpError(502, `Resend ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
}

async function recipients(admin: Admin): Promise<Recipient[]> {
  const { data, error } = await admin.from('notify_recipients').select('*').eq('active', true)
  if (error) throw new HttpError(500, error.message)
  return data as Recipient[]
}

async function sendInstant(admin: Admin) {
  const { data, error } = await admin.from('notify_events').select('*').is('instant_done_at', null).order('id').limit(50)
  if (error) throw new HttpError(500, error.message)
  const events = data as NotifyEvent[]
  if (!events.length) return { sent: 0 }
  const [L, people] = await Promise.all([new Lookup(admin).load(), recipients(admin)])
  const now = Date.now()
  let sent = 0
  for (const e of events) {
    const done = (patch: Row = {}) => admin.from('notify_events').update({ instant_done_at: new Date().toISOString(), ...patch }).eq('id', e.id)
    if (e.dedupe_key) {
      const { count } = await admin.from('notify_events').select('id', { count: 'exact', head: true }).eq('dedupe_key', e.dedupe_key).gt('id', e.id)
      if (count) {
        // a newer event replaces this one; it keeps the "first submission" wording
        if (e.data.first) await admin.from('notify_events').update({ data: { first: true } }).eq('dedupe_key', e.dedupe_key).gt('id', e.id)
        await done({ digest_done_at: new Date().toISOString(), last_error: 'superseded' })
        continue
      }
      if (e.kind === 'shift_request' && now - Date.parse(e.created_at) < SHIFT_WAIT_MIN * 60_000) continue
    }
    const to = people.filter((p) => p.kinds.includes(e.kind) && (p.mode === 'instant' || e.urgent))
    if (!to.length) {
      await done()
      continue
    }
    try {
      const m = await renderEvent(admin, L, e)
      if (!m) {
        await done({ last_error: 'record not found' })
        continue
      }
      const text = `${m.lines.join('\n')}\n\n▶ アプリで見る: ${m.link}${FOOTER}`
      await sendBatch(to.map((p) => ({ to: p.email, subject: m.subject, text })), `notify-${e.id}`)
      await done({ last_error: null, attempts: e.attempts + 1 })
      sent += to.length
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (e.attempts + 1 >= 5) await done({ attempts: e.attempts + 1, last_error: message })
      else await admin.from('notify_events').update({ attempts: e.attempts + 1, last_error: message }).eq('id', e.id)
    }
  }
  return { sent }
}

/** 朝礼 slots of `date` without a record; null before the operation start. */
async function missingChorei(admin: Admin, L: Lookup, date: string): Promise<string[] | null> {
  if (date < '2026-10-12') return null
  const { data } = await admin.from('chorei_records').select('store_id, shift').eq('business_date', date).eq('status', 'valid').eq('by_test_account', false)
  const done = new Set((data ?? []).map((r) => `${r.store_id}:${r.shift}`))
  const out: string[] = []
  for (const [id, name] of L.stores) for (const s of ['early', 'middle', 'late']) if (!done.has(`${id}:${s}`)) out.push(`${name} ${SHIFT[s]}`)
  return out
}

async function sendDigest(admin: Admin) {
  const until = new Date().toISOString()
  const { data, error } = await admin.from('notify_events').select('*').is('digest_done_at', null).lte('created_at', until).order('id')
  if (error) throw new HttpError(500, error.message)
  // the latest event per dedupe key
  const latest = new Map<string, NotifyEvent>()
  for (const e of data as NotifyEvent[]) latest.set(e.dedupe_key ?? `id:${e.id}`, e)
  const events = [...latest.values()]
  const people = (await recipients(admin)).filter((p) => p.mode === 'digest')
  const L = await new Lookup(admin).load()
  const today = tokyoToday()
  const yesterday = addDays(today, -1)

  const rendered = new Map<number, { subject: string } | null>()
  for (const e of events) rendered.set(e.id, await renderEvent(admin, L, e))
  const missing = await missingChorei(admin, L, yesterday)

  const mails: Mail[] = []
  for (const p of people) {
    const mine = events.filter((e) => p.kinds.includes(e.kind) && rendered.get(e.id))
    const sections: string[] = []
    if (p.kinds.includes('chorei') && missing) sections.push(`■ 昨日（${day(yesterday)}）の朝礼: ${missing.length ? `未提出 ${missing.join('、')}` : 'すべて提出済み'}`)
    for (const kind of Object.keys(KIND)) {
      const list = mine.filter((e) => e.kind === kind)
      if (!list.length) continue
      sections.push(`■ ${KIND[kind]}（${list.length}件）\n${list.map((e) => `・${e.urgent ? '⚠ ' : ''}${rendered.get(e.id)!.subject}`).join('\n')}`)
    }
    if (!mine.length && !(p.kinds.includes('chorei') && missing)) continue
    mails.push({
      to: p.email,
      subject: `まとめ ${day(today)} 7:30（${mine.length}件）`,
      text: `この24時間の報告です。\n\n${sections.join('\n\n')}${mine.length ? '' : '\n\n新しい報告はありません。'}\n\n▶ アプリで見る: ${appUrl('/manager')}${FOOTER}`,
    })
  }
  if (mails.length) await sendBatch(mails, `digest-${today}`)
  const ids = (data as NotifyEvent[]).map((e) => e.id)
  for (let i = 0; i < ids.length; i += 500) {
    await admin.from('notify_events').update({ digest_done_at: until }).in('id', ids.slice(i, i + 500))
  }
  return { sent: mails.length, events: events.length }
}

async function sendTest(admin: Admin, recipientId: string) {
  const { data: p } = await admin.from('notify_recipients').select('*').eq('id', recipientId).maybeSingle()
  if (!p) throw new HttpError(404, 'recipient not found')
  const mode = p.mode === 'digest' ? 'まとめ（毎朝7:30に1通）' : 'すぐに送る'
  const kinds = (p.kinds as string[]).map((k) => KIND[k] ?? k).join('、') || '（なし）'
  await sendBatch(
    [{
      to: p.email,
      subject: 'テストメール（通知の設定）',
      text: `${p.name || p.email} さん\n\nこれは金龍ラーメン専用アプリの通知のテストメールです。\n\n受け取り方: ${mode}\n通知の種類: ${kinds}\n※ 即日指導と新規登録は、まとめの設定でもすぐに送ります。\n\n▶ アプリで見る: ${appUrl('/manager/notify')}${FOOTER}`,
    }],
    `test-${p.id}-${Date.now()}`,
  )
  return { sent: 1 }
}

serve(async (req) => {
  const admin = adminClient()
  const body = (await req.json().catch(() => ({}))) as { action?: string; recipient_id?: string }
  const cronSecret = req.headers.get('x-cron-secret')
  if (cronSecret) {
    const { data: ok, error } = await admin.rpc('notify_secret_ok', { p: cronSecret })
    if (error || !ok) throw new HttpError(401, 'bad cron secret')
    if (body.action === 'digest') return sendDigest(admin)
    return sendInstant(admin)
  }
  const caller = await requireUser(req, admin)
  if (!caller.isManager) throw new HttpError(403, 'managers only')
  if (caller.isTestAccount) throw new HttpError(403, 'test account: read only')
  if (body.action === 'test' && body.recipient_id) return sendTest(admin, body.recipient_id)
  throw new HttpError(400, 'unknown action')
})
