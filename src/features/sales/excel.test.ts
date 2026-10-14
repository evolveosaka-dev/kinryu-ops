// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { SalesReport } from '../../domain/sales'
import type { StockEvent } from '../../domain/stock'
import { buildSalesSheets } from './excel'

const report: SalesReport = {
  id: 'r1', store_id: 's', business_date: '2025-09-12', shift: 'early',
  tickets: { ramen: 154, chashu: 26, coupon: 0 }, ticket_total: 180, target_bowls: 187, meals: [],
  staff: [{ name: 'アーノ', start: '07:00', end: '11:00', status: 'normal' }, { name: 'ケイ', start: '11:00', end: '17:00', status: 'late', note: '電車' }],
  cash_book: [{ time: '12:10', type: 'refund', detail: '券売機', name: 'ハナ', amount: 100, reason: 'お釣りが出なかった' }],
  cash_counts: { '5000': 1, '1000': 11, '500': 7, '100': 52 }, cash_carried: 24800, cash_carried_manual: false,
  cash_in: 0, cash_out: 100, cash_expected: 24700, cash_actual: 24700, cash_diff: 0, cash_diff_reason: null,
  noodle_out: 180, noodle_lost: 2, noodle_meals: null, noodle_diff: 2, noodle_reason: '数え間違い',
  water: { '07:00': '5903', '11:00': '', '17:00': '5915' }, notes: '修理業者が来店', original_texts: null, source_lang: null,
  status: 'submitted', submitted_at: '2025-09-12T07:30:00Z', submitted_by_name: 'ハナ', updated_at: '', updated_by_name: 'ハナ',
}
const loss = { id: 'l', store_id: 's', business_date: '2025-09-12', shift: 'early', kind: 'loss', reason: 'dropped', note: null, author_name: 'ケイ', created_at: '2025-09-12T03:00:00Z', lines: [{ item: 'n', qty: 2 }] } as unknown as StockEvent

describe('販売日報 Excel', () => {
  it('one list sheet + one sheet per shift in the paper layout', () => {
    const sheets = buildSalesSheets([report], [{ id: 's', code: 'sennichimae', name_ja: '千日前店', name_en: '', sort_order: 1, active: true }], [loss], new Set(['n']))
    expect(sheets.map((s) => s.sheet)).toEqual(['一覧', '0912千日前早番'])
    const text = JSON.stringify(sheets[1]!.data)
    for (const s of ['令和7年9月12日（金）曜日', '180 −（180 − 0 − 2）= +2', '麺 廃棄・破損（落とした・こぼした）', '返金：券売機（理由：お釣りが出なかった）', '水道メーター検針：7時 5903', '24,700円', '遅刻']) {
      expect(text).toContain(s)
    }
    // every row of the report sheet has 8 cells
    expect(sheets[1]!.data.every((r) => r.length === 8)).toBe(true)
  })
})
