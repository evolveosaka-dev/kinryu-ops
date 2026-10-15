// Manager e-mail notifications through Resend.
//  - action "instant" (pg_cron every minute while events wait): one mail per event to the recipients in
//    'instant' mode, and to everyone for urgent events (即日指導, sign-up).
//  - action "digest" (pg_cron 7:30 JST): one summary mail per 'digest' recipient. 在庫 (kind 'stock': 繰越のずれ,
//    廃棄・破損) is sent only here, also to 'instant' recipients who have the kind. 販売日報 (kind 'sales'): urgent when
//    麺差引 / 現金過不足 ≠ 0 (sent at once to everyone), otherwise only in the summary, like 在庫.
//  - action "test" (a manager, 設定 → 通知メール): a test mail to one recipient.
//  - action "report" (pg_cron 8:00 JST daily, or a manager): AIレポート — Monday → last week, the 1st → last month;
//    figures from report_data(), 要点・提案 by Claude, saved in ai_reports and mailed to the recipients with kind 'report'.
// The cron caller sends x-cron-secret (checked against Vault); managers send their access token.
import Anthropic from 'npm:@anthropic-ai/sdk'
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
const KIND: Record<string, string> = { chorei: '朝礼記録', chorei_note: '朝礼の追記', patrol: '巡回チェック', shift_request: 'シフト希望', signup: '新規登録', edit: '修正・取消', staff_alert: '面談指導の通知', stock: '在庫（繰越のずれ・廃棄・破損）', sales: '販売日報', shift_change: '休み・遅刻・早退の連絡', visa_hours: '留学・家族滞在の週28時間超え', incident: 'クレーム・事故', lost_item: '忘れ物・落とし物' }
// keep in sync with src/domain/types.ts MISS_REASONS / chorei.json miss.reason
const MISS_REASON: Record<string, string> = { busy: 'お客様が多かった', no_manager: '管理者がいなかった', alone: '1人だけの勤務だった', forgot: '忘れた', other: 'その他' }
// keep in sync with src/domain/stock.ts OPEN_REASONS / LOSS_REASONS
const STOCK_REASON: Record<string, string> = {
  miscount: '前のシフトの数え間違い・記入ミス', unrecorded: '店間移動・受入の記入漏れ', unknown: '原因不明', no_record: '前のシフトの記録がない',
  dropped: '落とした・こぼした', spoiled: '傷んでいた・期限切れ', quality: '異物・品質の問題', mistake: '作り間違い', other: 'その他',
}
// keep in sync with src/domain/shiftChange.ts CHANGE_REASONS
const CHANGE_KIND: Record<string, string> = { absence: '休み', late: '遅刻', early_leave: '早退' }
const CHANGE_REASON: Record<string, string> = { sick: '体調不良', family: '家族の用事', transport: '交通の原因', personal: '私用', paid_leave: '有給休暇', store: '店の都合', other: 'その他' }
// keep in sync with src/domain/incident.ts
const INCIDENT_KIND: Record<string, string> = { complaint: 'お客様のクレーム', injury: 'ケガ・事故', foreign_object: '異物混入', equipment: '設備の故障', food_poisoning: '食中毒の疑い', lost_item: '忘れ物・落とし物', phone_message: '電話の伝言', other: 'その他' }
const STOCK_UNIT: Record<string, string> = { piece: '個', bag: '袋', box: '箱', stick: '本', liter: 'L' }
const PREV_SHIFT: Record<string, [number, string]> = { early: [-1, 'late'], middle: [0, 'early'], late: [0, 'middle'] }
const TABLE: Record<string, string> = { chorei_records: '朝礼記録', patrol_checks: '巡回チェック', shift_requests: 'シフト希望' }
const FIELD: Record<string, string> = {
  status: '状態', void_reason: '取消の理由', started_at: '開始', ended_at: '終了', needs_time_review: '時間確認',
  follow_up_done_at: '面談日時', follow_up_note: '面談メモ', shifts: '希望の勤番', days: '希望日', answers: '質問の回答',
}
const STATUS: Record<string, string> = { valid: '有効', void: '取消', draft: '下書き' }
const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土']
const CATEGORY: Record<string, string> = { smile: '笑顔', voice: '声出し・接客用語', grooming: '身だしなみ', clean: '清潔', quality: '提供品質', other: 'その他' }
// keep in sync with src/domain/issues.ts
const ESCALATION_STEPS = [
  '再面談：改善目標を本人と一緒に決め、2週間後にもう一度確認する',
  '配置・シフトの見直しと、再研修（OJT）を検討する',
  '本部（責任者）との面談で、今後の対応を検討する',
]
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
    ...(r.issue_tags ? [`改善点の対象: ${r.issue_tags.length ? Object.entries((r.issue_tags as { staff: string; category: string }[]).reduce<Record<string, string[]>>((a, t) => ({ ...a, [t.staff]: [...(a[t.staff] ?? []), CATEGORY[t.category] ?? t.category] }), {})).map(([n, c]) => `${n}（${c.join('、')}）`).join('、') : '全体'}`] : []),
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
  if (e.kind === 'staff_alert') {
    const d = e.data as { staff: string; category: string; interviews: number; last_interview: string | null; occurrences: number; level: string }
    const cat = CATEGORY[d.category] ?? d.category
    let q = admin
      .from('patrol_checks')
      .select('store_id, business_date, shift, improvements')
      .eq('status', 'valid')
      .eq('is_test', false)
      .contains('issue_tags', JSON.stringify([{ staff: d.staff, category: d.category }]))
      .order('business_date')
    q = d.last_interview ? q.gt('business_date', d.last_interview) : q.gt('business_date', addDays(tokyoToday(), -30))
    const { data: list, error } = await q
    if (error) throw new HttpError(500, error.message)
    const records = (list ?? []).map((r) => `・${slot(L, r)}: ${r.improvements ?? ''}`)
    const link = appUrl(`/manager/staff?name=${encodeURIComponent(d.staff)}`)
    if (d.level === 'interview') {
      return {
        subject: `⚠ 面談が必要: ${d.staff}（${cat}）30日で${d.occurrences}回`,
        lines: [
          `スタッフ: ${d.staff}`,
          `改善点の種類: ${cat}`,
          `直近30日で ${d.occurrences}回 指摘されています。面談指導の予定を立ててください。`,
          '',
          '指摘の記録:',
          ...records,
          '',
          '面談のあとは 管理 → スタッフ別 で「面談記録」を残してください（その後の再発を数えます）。',
        ],
        link,
      }
    }
    const step = ESCALATION_STEPS[Math.min(Math.max(d.interviews, 1), ESCALATION_STEPS.length) - 1]
    return {
      subject: `⚠ 面談後の再発${d.occurrences}回: ${d.staff}（${cat}）— 対応策の検討`,
      lines: [
        `スタッフ: ${d.staff}`,
        `改善点の種類: ${cat}`,
        `面談 ${d.interviews}回（最後: ${d.last_interview ? day(d.last_interview) : '—'}）のあと、${d.occurrences}回 再発しています。`,
        `次の対応（会社のステップ）: ${step}`,
        '',
        '再発の記録:',
        ...records,
        '',
        'アプリの 管理 → スタッフ別 で、AIによる具体的な対応策の提案を見られます。',
      ],
      link,
    }
  }
  if (e.kind === 'stock') return renderStock(admin, L, e)
  if (e.kind === 'sales') return renderSales(admin, L, e)
  if (e.kind === 'shift_change') return renderShiftChange(admin, L, e)
  if (e.kind === 'lost_item') {
    const r = await fetchRow(admin, 'lost_items', e.ref_id)
    if (!r) return null
    const owner = { customer: 'お客様', staff: 'スタッフ', unknown: '不明' }[r.owner_type as string] ?? r.owner_type
    const event = (e.data?.event as string) ?? 'found'
    const head = { found: '忘れ物の記録', returned: '返却の記録（承認待ち）', police: '警察への届出（承認待ち）' }[event] ?? '忘れ物'
    const { count } = await admin.from('attachments').select('id', { count: 'exact', head: true }).eq('lost_item_id', r.id).neq('status', 'failed')
    return {
      subject: `${head}: ${r.description} — ${slot(L, r)}`,
      lines: [
        `品物: ${r.description}`,
        `店舗・勤番: ${slot(L, r)}（見つけた時刻 ${jst(r.found_at)}${r.found_place ? `・${r.found_place}` : ''}）`,
        `持ち主: ${owner}${r.owner_name ? `（${[r.owner_name, r.owner_phone].filter(Boolean).join(' ')}）` : ''}`,
        `保管場所: ${r.storage_place ?? '—'}`,
        `記録した人: ${r.reporter_name}`,
        ...(event === 'returned'
          ? [`返却: ${jst(r.outcome_at)} ${r.outcome_to_name ?? ''}（${r.outcome_by_name}）`, `顔の撮影: ${r.consent_face ? '同意あり' : 'なし'}・宣伝に使う: ${r.consent_marketing ? '同意あり' : 'なし'}`]
          : event === 'police'
            ? [`警察: ${jst(r.outcome_at)} ${r.police_station ?? ''} ${r.police_number ?? ''}（${r.outcome_by_name}）`]
            : []),
        `写真: ${count ?? 0}件`,
        '',
        event === 'found' ? 'アプリの 管理 → 忘れ物 で確認できます。' : 'アプリの 管理 → 忘れ物 で承認してください。',
      ],
      link: appUrl('/manager/lost-items'),
    }
  }
  if (e.kind === 'incident') {
    const r = await fetchRow(admin, 'incidents', e.ref_id)
    if (!r) return null
    const kind = INCIDENT_KIND[r.kind] ?? r.kind
    const { count } = await admin.from('attachments').select('id', { count: 'exact', head: true }).eq('incident_id', r.id).neq('status', 'failed')
    return {
      subject: `${e.urgent ? '⚠ ' : ''}${kind}: ${slot(L, r)} — ${r.reporter_name}`,
      lines: [
        `種類: ${kind}`,
        `店舗・勤番: ${slot(L, r)}（発生 ${jst(r.occurred_at)}）`,
        `記録した人: ${r.reporter_name}`,
        `内容: ${r.description}`,
        ...(r.injured_who ? [`ケガをした人: ${(r.injured_who as string[]).map((w) => (w === 'staff' ? `スタッフ${r.injured_staff ? `（${r.injured_staff}）` : ''}` : 'お客様')).join('・')}`] : []),
        ...(r.caller_type ? [`電話をかけてきた人: ${{ vendor: '業者', kinryu: '金龍', customer: 'お客様' }[r.caller_type as string]}`] : []),
        ...(r.customer_name || r.customer_phone ? [`${r.caller_type && r.caller_type !== 'customer' ? '相手' : 'お客様'}: ${[r.customer_name, r.customer_phone].filter(Boolean).join(' ')}`] : []),
        `管理者への連絡: ${{ phone: '電話', line: 'LINE', none: '連絡しない（急ぎではない）' }[r.contact_method as string] ?? '—'}`,
        `その場の対応: ${r.action_taken ?? '—'}${r.action_source === 'ai' ? '（AIの提案どおり）' : ''}`,
        `写真・動画: ${count ?? 0}件`,
        '',
        'アプリの 管理 → クレーム・事故 で、担当者・対応・再発防止を記録してください。',
      ],
      link: appUrl('/manager/incidents'),
    }
  }
  if (e.kind === 'visa_hours') {
    const d = e.data
    const visa = d.visa === 'dependent' ? '家族滞在ビザ' : '留学ビザ'
    const { data: rows } = await admin
      .from('shift_assignments')
      .select('business_date, shift, store_mark, start_min, end_min')
      .eq('roster_name', d.roster_name)
      .gte('business_date', d.from)
      .lte('business_date', d.to)
      .order('business_date')
    return {
      subject: `⚠ 週28時間超え: ${d.roster_name}（${visa}） ${day(d.from)}〜${day(d.to)}`,
      lines: [
        `${d.roster_name}さん（${visa}）のシフトが、連続7日間で28時間を超えています（最大 ${Math.round((d.minutes / 60) * 10) / 10}時間）。`,
        `期間: ${day(d.from)}〜${day(d.to)}`,
        '',
        'この期間のシフト:',
        ...(rows ?? []).map((r) => `・${day(r.business_date)} ${SHIFT[r.shift] ?? r.shift} ${minText(r.start_min)}–${minText(r.end_min)} ${r.store_mark}（${Math.round(((r.end_min - r.start_min) / 60) * 10) / 10}時間）`),
        '',
        'シフトを減らすか、代わりの人に入ってもらってください（資格外活動は どの7日間でも28時間まで）。',
      ],
      link: appUrl('/manager'),
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

/** 繰越のずれ / 廃棄・破損 of 在庫・仕入; null when cancelled. */
async function renderStock(admin: Admin, L: Lookup, e: NotifyEvent) {
  const r = await fetchRow(admin, 'stock_events', e.ref_id)
  if (!r || r.voided_at) return null
  const { data: items } = await admin.from('stock_items').select('id, name_ja, unit').eq('store_id', r.store_id)
  const item = new Map((items ?? []).map((i) => [i.id, i]))
  const name = (id: string) => item.get(id)?.name_ja ?? '?'
  const unit = (id: string) => STOCK_UNIT[item.get(id)?.unit ?? ''] ?? ''
  const num = (n: number) => String(Math.round(n * 10) / 10)
  let lines: string[]
  if (r.kind === 'open') {
    const [d, shift] = PREV_SHIFT[r.shift]
    const { data: prev } = await admin
      .from('stock_events')
      .select('lines')
      .eq('store_id', r.store_id).eq('business_date', addDays(r.business_date, d)).eq('shift', shift).eq('kind', 'close').is('voided_at', null)
      .order('created_at')
    const before = new Map<string, number>()
    for (const p of prev ?? []) for (const l of p.lines as { item: string; qty: number }[]) before.set(l.item, l.qty)
    lines = (r.lines as { item: string; qty: number }[]).map((l) => {
      const b = before.get(l.item)
      const diff = b === undefined ? '' : `（${l.qty - b >= 0 ? '+' : '−'}${num(Math.abs(l.qty - b))}）`
      return `・${name(l.item)}: ${b === undefined ? '前のシフトの記録なし' : `${num(b)}${unit(l.item)}`} → ${num(l.qty)}${unit(l.item)}${diff}`
    })
  } else {
    lines = (r.lines as { item: string; qty: number }[]).map((l) => `・${name(l.item)}: ${num(l.qty)}${unit(l.item)}`)
  }
  const { data: store } = await admin.from('stores').select('code').eq('id', r.store_id).maybeSingle()
  const { count } = await admin.from('attachments').select('id', { count: 'exact', head: true }).eq('stock_event_id', r.id).neq('status', 'failed')
  const what = r.kind === 'open' ? '繰越のずれ' : '廃棄・破損'
  const reason = STOCK_REASON[r.reason] ?? r.reason ?? '—'
  return {
    subject: `${what} ${slot(L, r)}（${reason}） — ${r.author_name}`,
    lines: [
      `店舗・勤番: ${slot(L, r)}`,
      `記録した人: ${r.author_name}（${jst(r.created_at)}）`,
      `理由: ${reason}`,
      ...(r.note ? [`メモ: ${r.note}`] : []),
      ...lines,
      ...(r.kind === 'loss' ? [`写真・動画: ${count ?? 0}件`] : []),
    ],
    link: appUrl(`/stock?store=${store?.code ?? ''}&date=${r.business_date}&shift=${r.shift}`),
  }
}

const SALES_STATUS: Record<string, string> = { normal: '', late: '遅刻', early_leave: '早退', overtime: '残業', absent: '欠勤' }
const signedNum = (n: number | null | undefined, unit = '') =>
  n === null || n === undefined ? '—' : n === 0 ? `0±${unit}` : `${n > 0 ? '+' : '−'}${Math.abs(n).toLocaleString('ja-JP')}${unit}`
const yenText = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toLocaleString('ja-JP')}円`)

/** 販売日報 when sent; null when gone. */
async function renderSales(admin: Admin, L: Lookup, e: NotifyEvent) {
  const r = await fetchRow(admin, 'sales_reports', e.ref_id)
  if (!r) return null
  const { data: store } = await admin.from('stores').select('code').eq('id', r.store_id).maybeSingle()
  const noodleDiff = r.noodle_diff === null ? null : Number(r.noodle_diff)
  const bad = Boolean(noodleDiff) || Boolean(r.cash_diff)
  const t = r.tickets ?? {}
  const staff = (r.staff ?? []) as { name: string; start: string; end: string; status: string; note?: string }[]
  const book = (r.cash_book ?? []) as { time: string; type: string; detail: string; name: string; customer?: boolean; staff?: string; amount: number; reason?: string }[]
  const rate = r.target_bowls ? `（目標 ${r.target_bowls}杯・${Math.round((r.ticket_total / r.target_bowls) * 100)}%）` : ''
  const noodle =
    r.noodle_out === null
      ? '麺の照合: 在庫の終わりの数が未入力'
      : `${noodleDiff ? '⚠ ' : ''}麺の照合: ${r.ticket_total} −（${Number(r.noodle_out)} − ${r.noodle_meals ?? 0} − ${Number(r.noodle_lost ?? 0)}）= ${signedNum(noodleDiff)}${r.noodle_reason ? `（理由: ${r.noodle_reason}）` : ''}`
  const cash = `${r.cash_diff ? '⚠ ' : ''}現金: 繰越 ${yenText(r.cash_carried)} + 入金 ${yenText(r.cash_in)} − 出金 ${yenText(r.cash_out)} = ${yenText(r.cash_expected)} / 実際 ${yenText(r.cash_actual)} → 過不足 ${signedNum(r.cash_diff, '円')}${r.cash_diff_reason ? `（理由: ${r.cash_diff_reason}）` : ''}`
  const kind = (b: { type: string }) => (b.type === 'in' ? '入金' : b.type === 'refund' ? '返金' : '出金')
  return {
    subject: `${bad ? '⚠ ' : ''}販売日報 ${slot(L, r)} 食券${r.ticket_total}枚 麺${signedNum(noodleDiff)} 現金${signedNum(r.cash_diff, '円')} — ${r.submitted_by_name ?? ''}`,
    lines: [
      `店舗・勤番: ${slot(L, r)}`,
      `送信: ${r.submitted_by_name ?? ''}（${jst(r.submitted_at)}）`,
      `食券: ラーメン ${t.ramen ?? 0} / チャーシューメン ${t.chashu ?? 0} / クーポン ${t.coupon ?? 0} = 合計 ${r.ticket_total}枚${rate}`,
      noodle,
      cash,
      ...book.map((b) => `・${b.time} ${kind(b)} ${yenText(b.amount)} ${b.detail}${b.customer ? '（お客様）' : b.name ? `（${b.name}）` : ''}${b.staff ? ` 担当: ${b.staff}` : ''}${b.reason ? ` 理由: ${b.reason}` : ''}`),
      `スタッフ: ${staff.map((s) => `${s.name} ${s.start}–${s.end}${SALES_STATUS[s.status] ? `（${SALES_STATUS[s.status]}${s.note ? `: ${s.note}` : ''}）` : ''}`).join('、') || '—'}`,
      `水道メーター: ${Object.entries((r.water ?? {}) as Record<string, string>).map(([h, v]) => `${Number(h.slice(0, 2))}時 ${v || '—'}`).join(' / ') || '—'}`,
      ...(r.notes ? [`連絡事項: ${r.notes}`] : []),
    ],
    link: appUrl(`/sales?store=${store?.code ?? ''}&date=${r.business_date}&shift=${r.shift}`),
  }
}

const minText = (m: number) => `${Math.floor(m / 60) % 24}:${String(m % 60).padStart(2, '0')}`
const noticeText = (min: number) =>
  min < 0 ? `勤務開始の${Math.ceil(-min / 60 * 10) / 10}時間後に連絡` : min < 120 ? `開始の${min}分前に連絡` : `開始の${Math.floor(min / 60)}時間前に連絡`

/** 休み・遅刻・早退の連絡 (event report) or a 代わりに入れます offer (event offer). */
async function renderShiftChange(admin: Admin, L: Lookup, e: NotifyEvent) {
  const r = await fetchRow(admin, 'shift_changes', e.ref_id)
  if (!r || r.status === 'cancelled') return null
  const store = r.store_id ? L.store(r.store_id) : r.store_mark
  const where = `${store} ${day(r.business_date)} ${SHIFT[r.shift] ?? r.shift} ${minText(r.start_min)}–${minText(r.end_min)}`
  const what =
    r.kind === 'late' ? `遅刻（約${r.late_min}分）` : r.kind === 'early_leave' ? `早退（${minText(r.leave_min)}に退勤）` : CHANGE_KIND[r.kind] ?? r.kind
  const link = appUrl('/manager/attendance')
  if (e.data.event === 'reminder') {
    // only while still waiting
    if (r.status !== 'open') return null
    const { count } = await admin.from('shift_offers').select('id', { count: 'exact', head: true }).eq('change_id', r.id).eq('status', 'offered')
    return {
      subject: `⏰ 未対応（勤務まで${e.data.hours}時間以内）: ${r.roster_name}の${what} ${day(r.business_date)} ${SHIFT[r.shift] ?? ''}`,
      lines: [
        `${r.roster_name}さんの${what}が、まだ確認待ちです。勤務開始まで${e.data.hours}時間を切りました。`,
        `勤務: ${where}`,
        `代わり: ${r.proposed_cover ? `本人が指名 ${r.proposed_cover}さん` : r.recruit ? `募集中（代われる人 ${count ?? 0}人）` : '募集しない（管理者が手配）'}`,
        '',
        'アプリの 管理 → 出勤 で、承認または却下してください。',
      ],
      link,
    }
  }
  if (e.data.event === 'offer') {
    const o = await fetchRow(admin, 'shift_offers', e.data.offer)
    if (!o || o.status !== 'offered' || r.status !== 'open') return null
    return {
      subject: `代わりに入れます: ${o.roster_name} → ${r.roster_name}の${what} ${day(r.business_date)} ${SHIFT[r.shift] ?? ''}`,
      lines: [
        `${o.roster_name}さんが代わりに入れます。`,
        `対象: ${r.roster_name}さんの${what}（${where}）`,
        ...(o.give_date ? [`交換: ${o.roster_name}さんの ${day(o.give_date)} ${SHIFT[o.give_shift] ?? ''} を ${r.roster_name}さんへ`] : []),
        ...(o.note ? [`メモ: ${o.note}`] : []),
        '',
        'アプリの 管理 → 出勤 で承認すると、シフトが入れ替わります。',
      ],
      link,
    }
  }
  return {
    subject: `${e.urgent ? '⚠ ' : ''}${what}: ${r.roster_name} ${day(r.business_date)} ${SHIFT[r.shift] ?? ''}（${CHANGE_REASON[r.reason] ?? r.reason}）`,
    lines: [
      `スタッフ: ${r.roster_name}${r.by_manager ? `（${L.person(r.requester_id)}が記録）` : ''}`,
      `勤務: ${where}`,
      `内容: ${what}`,
      `理由: ${CHANGE_REASON[r.reason] ?? r.reason}${r.note ? `（${r.note}）` : ''}`,
      `連絡: ${jst(r.reported_at)}（${noticeText(r.notice_min)}）`,
      `代わり: ${r.kind === 'late' ? '—' : r.proposed_cover ? `本人が指名 ${r.proposed_cover}さん（話し合い済み・承認待ち）` : r.recruit ? `募集中${r.swap_ok ? '（交換も可）' : ''}` : '募集しない（管理者が手配）'}`,
      '',
      'アプリの 管理 → 出勤 で、代わりの人を選んで承認してください。',
    ],
    link,
  }
}

/** Sends through Resend and counts the mails in mail_log (管理 → システム状態). */
// ---- AIレポート

const REPORT_MODELS = ['claude-sonnet-5-5', 'claude-sonnet-4-5']
const REPORT_SYSTEM = `あなたは大阪のラーメン店「金龍ラーメン」（御堂筋店・千日前店、どちらも24時間営業、早番7-17・中番17-23・遅番23-7）の運営アドバイザーです。
管理者向けの定期レポートを日本語で書きます。読み手は店長・社長です。
与えられたJSONの数字だけを使い、データにないことは推測で書かないでください。数字は具体的に書いてください（例：達成率85%、前週より+3pt）。
- 杯数（bowls）＝ラーメン＋チャーシューメン。target は送信済みの販売日報の目標杯数（目標のある勤番だけ）。達成率＝bowls_with_target ÷ target。前年比＝bowls_with_last_year ÷ last_year（364日前の同じ勤番）。
- 巡回：avg25 は25点満点の平均（目標20）。items は各項目の5点満点の平均。coaching は即日指導の回数。
- 朝礼：done ÷ due が実施率。missing_by_reason は記録のない勤番の理由（unreported＝理由の報告なし）。
- 出勤：absence_same_day は当日の休み、told_after_start は開始後の連絡、not_reported は販売日報にだけ書かれた遅刻・早退・欠勤（連絡なし）、covered は代わりが見つかった数、visa_over_people は週28時間を超えた留学・家族滞在の人数。
- previous は比較用の前の期間です。
個人の名前は書かないでください。
出力の形（この見出しだけを使い、全体で700字以内）：
【要点】
・（3〜5個。良い点と問題点の両方。数字入り）
【提案】
・（2〜3個。誰が・いつ・何をするか具体的に。朝礼の注意点や巡回で使える形で）`

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
const pct = (a: number | null | undefined, b: number | null | undefined) => (a && b ? `${Math.round((a / b) * 100)}%` : '—')

function reportTitle(kind: string, from: string, to: string) {
  return kind === 'monthly' ? `【月報】${from.slice(0, 4)}年${Number(from.slice(5, 7))}月` : `【週報】${day(from)}〜${day(to)}`
}

/** Key numbers as plain lines (mail). */
function reportLines(d: Row): string[] {
  const s = d.sales ?? {}
  const p = d.patrol ?? {}
  const c = d.chorei ?? {}
  const a = d.attendance ?? {}
  const i = d.incidents ?? {}
  const inc = Object.entries((i.by_kind ?? {}) as Record<string, number>).map(([k, n]) => `${INCIDENT_KIND[k] ?? k} ${n}`).join('、')
  return [
    `杯数: ${s.bowls ?? 0}杯（目標比 ${pct(s.bowls_with_target, s.target)} / 前年比 ${pct(s.bowls_with_last_year, s.last_year)}）`,
    `巡回: ${p.count ?? 0}回・平均 ${p.avg25 ?? '—'}点（目標20）・即日指導 ${p.coaching ?? 0}回`,
    `朝礼: 実施率 ${pct(c.done, c.due)}（${c.done ?? 0}/${c.due ?? 0}）`,
    `出勤: 休み ${a.absence ?? 0}（当日 ${a.absence_same_day ?? 0}）・遅刻 ${a.late ?? 0}・早退 ${a.early_leave ?? 0}・連絡なし ${a.not_reported ?? 0}・代わり ${a.covered ?? 0}${a.visa_over_people ? `・28時間超え ${a.visa_over_people}人` : ''}`,
    `クレーム・事故: ${inc || 'なし'}（未完了 ${i.open_now ?? 0}件）`,
  ]
}

function previousPeriod(kind: string, from: string, to: string): [string, string] {
  if (kind === 'weekly') return [addDays(from, -7), addDays(to, -7)]
  const d = new Date(`${from}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() - 1)
  return [d.toISOString().slice(0, 10), addDays(from, -1)]
}

/** Periods due on a given Tokyo date (the job runs at 8:00 JST). */
function duePeriods(today: string): { kind: 'weekly' | 'monthly'; from: string; to: string }[] {
  const out: { kind: 'weekly' | 'monthly'; from: string; to: string }[] = []
  if (new Date(`${today}T00:00:00Z`).getUTCDay() === 1) out.push({ kind: 'weekly', from: addDays(today, -7), to: addDays(today, -1) })
  if (today.slice(8) === '01') {
    const [from] = previousPeriod('monthly', today, today)
    out.push({ kind: 'monthly', from, to: addDays(today, -1) })
  }
  return out
}

async function makeReport(admin: Admin, kind: 'weekly' | 'monthly', from: string, to: string, createdBy: string | null, mail: boolean) {
  const data = await admin.rpc('report_data', { p_from: from, p_to: to })
  if (data.error) throw new HttpError(500, data.error.message)
  const [pf, pt] = previousPeriod(kind, from, to)
  const prev = await admin.rpc('report_data', { p_from: pf, p_to: pt })
  if (prev.error) throw new HttpError(500, prev.error.message)
  const workspaceId = Deno.env.get('ANTHROPIC_WORKSPACE_ID')
  const client = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY'), defaultHeaders: workspaceId ? { 'anthropic-workspace-id': workspaceId } : undefined })
  const input = `<report kind="${kind === 'weekly' ? '週報' : '月報'}" from="${from}" to="${to}">\n<data>${JSON.stringify(data.data)}</data>\n<previous from="${pf}" to="${pt}">${JSON.stringify(prev.data)}</previous>\n</report>`
  let response: Anthropic.Message | null = null
  let model = REPORT_MODELS[0]!
  for (const m of REPORT_MODELS) {
    model = m
    try {
      response = await client.messages.create({ model: m, max_tokens: 2000, system: REPORT_SYSTEM, messages: [{ role: 'user', content: input }] })
      break
    } catch (err) {
      if (err instanceof Anthropic.NotFoundError && m !== REPORT_MODELS.at(-1)) continue
      if (err instanceof Anthropic.APIError) throw new HttpError(502, `AI failed (${err.status}): ${err.message}`)
      throw err
    }
  }
  const block = response?.content.find((b) => b.type === 'text')
  if (!response || !block || block.type !== 'text') throw new HttpError(502, 'empty AI answer')
  const summary = block.text.trim()
  const { data: saved, error } = await admin
    .from('ai_reports')
    .upsert({ kind, period_from: from, period_to: to, data: data.data, summary, model, created_by: createdBy, created_at: new Date().toISOString() }, { onConflict: 'kind,period_from' })
    .select('id')
    .single()
  if (error) throw new HttpError(500, error.message)
  await admin.from('translation_log').insert({
    user_id: createdBy,
    chars: input.length,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    model,
  })
  let sent = 0
  if (mail) {
    const to_ = (await recipients(admin)).filter((p) => p.kinds.includes('report'))
    const text = `${reportTitle(kind, from, to)}\n\n${summary}\n\n■ 主な数字\n${reportLines(data.data as Row).join('\n')}\n\n▶ アプリで見る（印刷・PDF保存もできます）: ${appUrl('/manager/reports')}${FOOTER}`
    if (to_.length) await sendBatch(to_.map((p) => ({ to: p.email, subject: reportTitle(kind, from, to), text })), `report-${saved.id}-${Date.now()}`, 'report', admin)
    await admin.from('ai_reports').update({ mailed_at: new Date().toISOString() }).eq('id', saved.id)
    sent = to_.length
  }
  return { id: saved.id, sent }
}

/** Scheduled: the reports due today that were not mailed yet. */
async function scheduledReports(admin: Admin) {
  const out = []
  for (const p of duePeriods(tokyoToday())) {
    const { data } = await admin.from('ai_reports').select('mailed_at').eq('kind', p.kind).eq('period_from', p.from).maybeSingle()
    if (data?.mailed_at) continue
    out.push(await makeReport(admin, p.kind, p.from, p.to, null, true))
  }
  return { reports: out }
}

async function sendBatch(mails: Mail[], idempotencyKey: string, kind: string, admin: Admin = adminClient()) {
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
    await admin.from('mail_log').insert({ kind, mails: chunk.length })
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
    // 在庫 and ordinary 販売日報 go only into the 7:30 summary; a 販売日報 with a difference goes out at once
    const summaryOnly = e.kind === 'stock' || (e.kind === 'sales' && !e.urgent)
    const to = summaryOnly ? [] : people.filter((p) => p.kinds.includes(e.kind) && (p.mode === 'instant' || e.urgent))
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
      await sendBatch(to.map((p) => ({ to: p.email, subject: m.subject, text })), `notify-${e.id}`, e.kind, admin)
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
  // 朝礼できなかった reports: a manager's ✓ counts as held, a reason is shown
  const { data: misses } = await admin.from('chorei_misses').select('store_id, shift, kind, reason, note').eq('business_date', date).eq('by_test_account', false)
  const missBy = new Map((misses ?? []).map((m) => [`${m.store_id}:${m.shift}`, m]))
  const out: string[] = []
  for (const [id, name] of L.stores)
    for (const s of ['early', 'middle', 'late']) {
      const key = `${id}:${s}`
      const m = missBy.get(key)
      if (done.has(key) || m?.kind === 'done') continue
      out.push(`${name} ${SHIFT[s]}${m?.reason ? `（${MISS_REASON[m.reason] ?? m.reason}${m.note ? `：${m.note}` : ''}）` : '（理由の報告なし）'}`)
    }
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
  // 'instant' recipients get the summary only for 在庫 and ordinary 販売日報 (urgent ones were sent at once)
  const people = (await recipients(admin))
    .map((p) => (p.mode === 'digest' ? p : { ...p, kinds: p.kinds.filter((k) => k === 'stock' || k === 'sales') }))
    .filter((p) => p.kinds.length > 0)
  const L = await new Lookup(admin).load()
  const today = tokyoToday()
  const yesterday = addDays(today, -1)

  const rendered = new Map<number, { subject: string } | null>()
  for (const e of events) rendered.set(e.id, await renderEvent(admin, L, e))
  const missing = await missingChorei(admin, L, yesterday)

  const mails: Mail[] = []
  for (const p of people) {
    const mine = events.filter((e) => p.kinds.includes(e.kind) && rendered.get(e.id) && !(p.mode === 'instant' && e.urgent))
    const sections: string[] = []
    if (p.mode === 'digest' && p.kinds.includes('chorei') && missing) sections.push(`■ 昨日（${day(yesterday)}）の朝礼: ${missing.length ? `未提出 ${missing.join('、')}` : 'すべて提出済み'}`)
    for (const kind of Object.keys(KIND)) {
      const list = mine.filter((e) => e.kind === kind)
      if (!list.length) continue
      sections.push(`■ ${KIND[kind]}（${list.length}件）\n${list.map((e) => `・${e.urgent ? '⚠ ' : ''}${rendered.get(e.id)!.subject}`).join('\n')}`)
    }
    if (!mine.length && !(p.mode === 'digest' && p.kinds.includes('chorei') && missing)) continue
    mails.push({
      to: p.email,
      subject: `まとめ ${day(today)} 7:30（${mine.length}件）`,
      text: `この24時間の報告です。\n\n${sections.join('\n\n')}${mine.length ? '' : '\n\n新しい報告はありません。'}\n\n▶ アプリで見る: ${appUrl('/manager')}${FOOTER}`,
    })
  }
  if (mails.length) await sendBatch(mails, `digest-${today}`, 'digest', admin)
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
    'test',
    admin,
  )
  return { sent: 1 }
}

serve(async (req) => {
  const admin = adminClient()
  const body = (await req.json().catch(() => ({}))) as { action?: string; recipient_id?: string; kind?: string; from?: string; to?: string; mail?: boolean }
  const cronSecret = req.headers.get('x-cron-secret')
  if (cronSecret) {
    const { data: ok, error } = await admin.rpc('notify_secret_ok', { p: cronSecret })
    if (error || !ok) throw new HttpError(401, 'bad cron secret')
    if (body.action === 'digest') return sendDigest(admin)
    if (body.action === 'report') return scheduledReports(admin)
    return sendInstant(admin)
  }
  const caller = await requireUser(req, admin)
  if (!caller.isManager) throw new HttpError(403, 'managers only')
  if (caller.isTestAccount) throw new HttpError(403, 'test account: read only')
  if (body.action === 'test' && body.recipient_id) return sendTest(admin, body.recipient_id)
  if (body.action === 'report') {
    const ok = (d?: string) => Boolean(d && /^\d{4}-\d{2}-\d{2}$/.test(d))
    if ((body.kind !== 'weekly' && body.kind !== 'monthly') || !ok(body.from) || !ok(body.to) || body.from! > body.to!) throw new HttpError(400, 'bad period')
    return makeReport(admin, body.kind, body.from!, body.to!, caller.id, Boolean(body.mail))
  }
  throw new HttpError(400, 'unknown action')
})
