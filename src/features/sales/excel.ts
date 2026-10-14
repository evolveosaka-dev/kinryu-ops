import { MEALS_ENABLED, WATER_TIMES, type SalesReport } from '../../domain/sales'
import type { StockEvent } from '../../domain/stock'
import { weekdayOf } from '../../domain/time'
import type { Store } from '../../lib/types'

// 販売日報 → .xlsx in the layout of the paper 日報 (1ページ表): one sheet per shift, plus a 一覧 sheet.

const SHIFT_JA: Record<string, string> = { early: '早番', middle: '中番', late: '遅番' }
const STATUS_JA: Record<string, string> = { normal: '', late: '遅刻', early_leave: '早退', overtime: '残業', absent: '欠勤' }
const CASH_JA: Record<string, string> = { in: '入金', out: '出金', refund: '返金' }
const LOSS_JA: Record<string, string> = { dropped: '落とした・こぼした', spoiled: '傷んでいた・期限切れ', quality: '異物・品質の問題', mistake: '作り間違い', other: 'その他' }
const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土']
const DENOMS: [string, string][] = [['10000', '1万円'], ['5000', '5千円'], ['2000', '2千円'], ['1000', '千円'], ['500', '500円'], ['100', '100円'], ['50', '50円'], ['10', '10円'], ['5', '5円'], ['1', '1円']]

type Cell = {
  value?: string | number | null
  columnSpan?: number
  fontWeight?: 'bold'
  fontSize?: number
  align?: 'left' | 'center' | 'right'
  alignVertical?: 'top' | 'center' | 'bottom'
  wrap?: boolean
  backgroundColor?: string
  color?: string
  borderStyle?: 'thin'
  borderColor?: string
  type?: StringConstructor | NumberConstructor
} | null

const B = { borderStyle: 'thin' as const, borderColor: '#000000' }
const c = (value: string | number | null | undefined, opt: Omit<NonNullable<Cell>, 'value'> = {}): Cell => ({ value: value ?? '', ...B, alignVertical: 'center', ...opt })
const head = (value: string, opt: Omit<NonNullable<Cell>, 'value'> = {}): Cell => c(value, { fontWeight: 'bold', backgroundColor: '#E5E7EB', ...opt })
/** a spanned cell followed by the null placeholders the library expects */
const span = (cell: Cell, n: number): Cell[] => [{ ...cell!, columnSpan: n }, ...Array.from({ length: n - 1 }, () => null)]
const pad = (row: Cell[]) => [...row, ...Array.from({ length: Math.max(0, 8 - row.length) }, () => c(''))]

const reiwa = (date: string) => `令和${Number(date.slice(0, 4)) - 2018}年${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日（${WEEKDAY[weekdayOf(date)]}）曜日`
const diffText = (n: number | null | undefined) => (n === null || n === undefined ? '' : n === 0 ? '0±' : `${n > 0 ? '+' : '−'}${Math.abs(n)}`)
const hm = (iso: string) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(11, 16)

function reportSheet(r: SalesReport, store: string, losses: { e: StockEvent; qty: number }[]): Cell[][] {
  const rows: Cell[][] = []
  const t = r.tickets
  rows.push([...span(c(`日報(1ページ表)：${store}（${SHIFT_JA[r.shift]}）`, { fontWeight: 'bold', fontSize: 13 }), 5), ...span(c(reiwa(r.business_date), { align: 'right' }), 3)])
  rows.push([head('食券枚数'), c('ラーメン'), c(t.ramen ?? '', { align: 'right' }), c('チャーシューメン'), c(t.chashu ?? '', { align: 'right' }), c('クーポン'), c(t.coupon ?? '', { align: 'right' }), c(`合計 ${r.ticket_total}枚`, { fontWeight: 'bold' })])
  const meals = MEALS_ENABLED ? (r.noodle_meals ?? 0) : 0
  const formula = r.noodle_out === null ? '（在庫の終わりの数が未入力）' : `${r.ticket_total} −（${r.noodle_out} − ${meals} − ${r.noodle_lost ?? 0}）= ${diffText(r.noodle_diff)}`
  rows.push([head('計算'), ...span(c(formula, { fontSize: 13 }), 4), c('計算開始時間'), ...span(c(r.submitted_at ? hm(r.submitted_at) : ''), 2)])
  rows.push([head(''), ...span(c(r.target_bowls ? `目標 ${r.target_bowls}杯（${Math.round((r.ticket_total / r.target_bowls) * 100)}%）` : ''), 4), c('計算者名'), ...span(c(r.submitted_by_name ?? r.updated_by_name ?? ''), 2)])
  rows.push([head(''), ...span(c(r.noodle_reason ? `理由：${r.noodle_reason}` : '', { wrap: true }), 4), c('差引'), ...span(c(`${diffText(r.noodle_diff)} 個`, { fontWeight: 'bold', color: r.noodle_diff ? '#B91C1C' : undefined }), 2)])

  if (MEALS_ENABLED || r.meals.length) {
    rows.push(pad([head('食事'), ...r.meals.slice(0, 7).map((m) => c(`${m.name} ${m.qty}`))]))
  }

  rows.push([head('その他払出'), head('名前'), head('時間'), head('数量'), ...span(head('明細'), 4)])
  for (const l of losses.length ? losses : [null]) {
    rows.push(l ? [c(''), c(l.e.author_name), c(hm(l.e.created_at)), c(l.qty), ...span(c(`麺 廃棄・破損（${LOSS_JA[l.e.reason ?? ''] ?? ''}）${l.e.note ? ` ${l.e.note}` : ''}`), 4)] : pad([c('')]))
  }

  rows.push([head(`スタッフ（${SHIFT_JA[r.shift]}）`), head('名前'), head('時間'), head('状態'), ...span(head('メモ'), 4)])
  for (const s of r.staff.length ? r.staff : [null]) {
    rows.push(s ? [c(''), c(s.name), c(`${s.start}–${s.end}`), c(STATUS_JA[s.status] ?? ''), ...span(c(s.note ?? ''), 4)] : pad([c('')]))
  }

  rows.push([head('現金出納帳'), head('時間'), ...span(head('明細'), 3), head('名前'), ...span(head('金額'), 2)])
  const book = [...r.cash_book, ...Array.from({ length: Math.max(0, 5 - r.cash_book.length) }, () => null)]
  book.forEach((b, i) =>
    rows.push(
      b
        ? [c(i + 1, { align: 'center' }), c(b.time), ...span(c(`${CASH_JA[b.type]}：${b.detail}${b.reason ? `（理由：${b.reason}）` : ''}${b.staff ? `（担当：${b.staff}）` : ''}`, { wrap: true }), 3), c(b.customer ? 'お客様' : b.name), ...span(c(`${b.type === 'in' ? '' : '−'}${b.amount.toLocaleString('ja-JP')}円`, { align: 'right' }), 2)]
        : pad([c(i + 1, { align: 'center' })]),
    ),
  )

  const summary: [string, string][] = [
    ['前のシフト繰越', r.cash_carried === null ? '' : `${r.cash_carried.toLocaleString('ja-JP')}円${r.cash_carried_manual ? '（手入力）' : ''}`],
    ['入金合計', `${r.cash_in.toLocaleString('ja-JP')}円`],
    ['出金合計', `${r.cash_out.toLocaleString('ja-JP')}円`],
    ['計算上の合計', r.cash_expected === null ? '' : `${r.cash_expected.toLocaleString('ja-JP')}円`],
    ['現金過不足', `${diffText(r.cash_diff)}円`],
    ['過不足の理由', r.cash_diff_reason ?? ''],
  ]
  const notesNone = r.notes === 'なし' && Object.values(r.water).every((v) => !v)
  const notes = notesNone
    ? ['なし']
    : [...WATER_TIMES[r.shift].map((h) => `水道メーター検針：${Number(h.slice(0, 2))}時 ${r.water[h] || ''}`), ...(r.notes ?? '').split('\n').filter(Boolean)]
  rows.push([head('現金実際有高'), head('枚'), ...span(head('現金集計'), 2), head(''), ...span(head('連絡事項'), 3)])
  DENOMS.forEach(([k, label], i) => {
    const s = summary[i]
    rows.push([
      c(`${label} ×`, { align: 'right' }),
      c(r.cash_counts[k] ?? '', { align: 'right' }),
      ...span(c(s?.[0] ?? '', { fontWeight: s ? 'bold' : undefined }), 2),
      c(s?.[1] ?? '', { align: 'right', fontWeight: s?.[0] === '現金過不足' ? 'bold' : undefined, color: s?.[0] === '現金過不足' && r.cash_diff ? '#B91C1C' : undefined, wrap: true }),
      ...span(c(notes[i] ?? '', { wrap: true }), 3),
    ])
  })
  rows.push([
    head('合計'),
    c(r.cash_actual === null ? '' : `${r.cash_actual.toLocaleString('ja-JP')}円`, { fontWeight: 'bold', align: 'right' }),
    ...span(c('現金計算者'), 2),
    c(r.submitted_by_name ?? r.updated_by_name ?? ''),
    ...span(c(notes.slice(DENOMS.length).join(' / '), { wrap: true }), 3),
  ])
  rows.push(pad([c(r.status === 'submitted' ? `送信：${r.submitted_at ? new Date(r.submitted_at).toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 16) : ''}` : '下書き（未送信）', { fontSize: 9 })]))
  return rows
}

/** Sheets of the 販売日報 of a period: 一覧 + one per shift in the paper layout. */
export function buildSalesSheets(reports: SalesReport[], stores: Store[], losses: StockEvent[], noodleIds: Set<string>) {
  const storeName = new Map(stores.map((s) => [s.id, s.name_ja]))
  const order = { early: 0, middle: 1, late: 2 }
  const list = [...reports].sort((a, b) => a.business_date.localeCompare(b.business_date) || (storeName.get(a.store_id) ?? '').localeCompare(storeName.get(b.store_id) ?? '') || order[a.shift] - order[b.shift])

  const summary: Cell[][] = [
    ['日付', '店舗', '勤番', '食券合計', '目標杯数', '達成率', '麺差引', '現金過不足', '現金（実際）', '状態', '送信者'].map((h) => head(h)),
    ...list.map((r) => [
      c(r.business_date),
      c(storeName.get(r.store_id) ?? ''),
      c(SHIFT_JA[r.shift]),
      c(r.ticket_total),
      c(r.target_bowls ?? ''),
      c(r.target_bowls ? `${Math.round((r.ticket_total / r.target_bowls) * 100)}%` : ''),
      c(diffText(r.noodle_diff), { color: r.noodle_diff ? '#B91C1C' : undefined }),
      c(diffText(r.cash_diff), { color: r.cash_diff ? '#B91C1C' : undefined }),
      c(r.cash_actual ?? ''),
      c(r.status === 'submitted' ? '送信済み' : '下書き'),
      c(r.submitted_by_name ?? ''),
    ]),
  ]

  const used = new Set<string>()
  const sheetName = (r: SalesReport) => {
    let name = `${r.business_date.slice(5).replace('-', '')}${(storeName.get(r.store_id) ?? '').replace('店', '')}${SHIFT_JA[r.shift]}`.slice(0, 31)
    while (used.has(name)) name = `${name}_`.slice(-31)
    used.add(name)
    return name
  }
  const cols = [14, 12, 12, 14, 12, 12, 12, 14].map((width) => ({ width }))
  return [
      { sheet: '一覧', data: summary, columns: [12, 10, 8, 10, 10, 8, 10, 12, 12, 10, 12].map((width) => ({ width })) },
      ...list.map((r) => ({
        sheet: sheetName(r),
        columns: cols,
        data: reportSheet(
          r,
          storeName.get(r.store_id) ?? '',
          losses
            .filter((e) => e.store_id === r.store_id && e.business_date === r.business_date && e.shift === r.shift)
            .flatMap((e) => e.lines.filter((l) => noodleIds.has(l.item)).map((l) => ({ e, qty: l.qty }))),
        ),
      })),
  ]
}

/** Download the 販売日報 of a period as .xlsx (the library is loaded only when a manager exports). */
export async function exportSalesXlsx(fileName: string, reports: SalesReport[], stores: Store[], losses: StockEvent[], noodleIds: Set<string>) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  await writeXlsxFile(buildSalesSheets(reports, stores, losses, noodleIds) as never, { fontFamily: 'Meiryo', fontSize: 10 } as never).toFile(fileName)
}
