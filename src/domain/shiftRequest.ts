// シフト希望提出 — options and questions copied from the Google Form sheets 早番希望 / 中番希望 / 遅番希望
// of the monthly shift workbook. The export reproduces those sheets so managers can paste it in.
import { addDays, weekdayOf } from './time'
import type { Shift } from './types'

export type EarlyChoice = 'full' | 'morning' | 'afternoon'
export type MiddleChoice = 'ok' | 'from_1730'
export type LateChoice = 'ok' | 'from_2200'

export interface DayChoice {
  early?: EarlyChoice
  early_until_1730?: boolean
  middle?: MiddleChoice
  late?: LateChoice
}

export const CHOICES = {
  early: ['full', 'morning', 'afternoon'] as const,
  middle: ['ok', 'from_1730'] as const,
  late: ['ok', 'from_2200'] as const,
}

/** Exact wording of the workbook sheets. */
export const SHEET_VALUE = {
  early: { full: '出勤可（7-17）', morning: '7-11のみ可', afternoon: '11-17のみ可' },
  early_until_1730: '17:30まで勤務可',
  middle: { ok: '出勤可', from_1730: '出勤可（17:30～）' },
  late: { ok: '出勤可', from_2200: '22:00出勤可' },
} as const

export const SHEET_NAME: Record<Shift, string> = { early: '早番希望', middle: '中番希望', late: '遅番希望' }

export type YesNoUnknown = 'no' | 'yes' | 'unknown'

export interface ShiftAnswers {
  message: string
  homeTrip: YesNoUnknown
  homeTripWhen: string
  paidLeave: 'none' | 'want'
  paidLeaveComment: string
  schoolHoliday: string
  resign: 'no' | 'yes'
  resignWhen: string
  checkedNotice: boolean
  checkedIrregular: boolean
}

export const EMPTY_ANSWERS: ShiftAnswers = {
  message: '',
  homeTrip: 'no',
  homeTripWhen: '',
  paidLeave: 'none',
  paidLeaveComment: '',
  schoolHoliday: '',
  resign: 'no',
  resignWhen: '',
  checkedNotice: false,
  checkedIrregular: false,
}

const ANSWER_VALUE = {
  homeTrip: { no: 'いいえ、ありません。', yes: 'はい、あります。', unknown: 'わからない' },
  paidLeave: { none: 'なし', want: '有給休暇の取得を希望する' },
  resign: { no: 'いいえ。まだ退職予定はありません。', yes: 'はい。退職予定があります。' },
  checked: '確認しました。',
} as const

/** Question rows (column A) as in the sheets. */
export const QUESTIONS_JA = [
  'シフトのことで\u3000つたえたいこと',
  '一時帰国の予定（よてい）はありますか？',
  'いつ一時帰国しますか？（例：4/30～5/5）',
  '有給希望',
  'コメント（日数など）',
  '学校の長期休暇期間',
  '退職（金龍アルバイトを辞める）予定はありますか？',
  '退職予定月日\u3000または\u3000退職時期',
  '↑\u3000「会社への届け出について」を確認しましたか？',
  '↑\u3000「イレギュラー対応シート」の記入について」を確認しましたか？',
]

export type AnswerError = 'shifts' | 'homeTripWhen' | 'resignWhen' | 'checks'

export function validateRequest(shifts: Shift[], answers: ShiftAnswers): AnswerError[] {
  const errors: AnswerError[] = []
  if (shifts.length === 0) errors.push('shifts')
  if (answers.homeTrip === 'yes' && !answers.homeTripWhen.trim()) errors.push('homeTripWhen')
  if (answers.resign === 'yes' && !answers.resignWhen.trim()) errors.push('resignWhen')
  if (!answers.checkedNotice || !answers.checkedIrregular) errors.push('checks')
  return errors
}

/** All dates of a month ('YYYY-MM-01'). */
export function monthDates(month: string): string[] {
  const out: string[] = []
  for (let d = month; d.slice(0, 7) === month.slice(0, 7); d = addDays(d, 1)) out.push(d)
  return out
}

/** First day of the next month (default month for requests). */
export function nextMonth(today: string): string {
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + 1)
  return d.toISOString().slice(0, 10)
}

const WD_JA = ['日', '月', '火', '水', '木', '金', '土']

/** Row label as in the sheets: "10月 [1日\u3000(木)]". */
export function sheetDayLabel(date: string): string {
  return `${Number(date.slice(5, 7))}月 [${Number(date.slice(8, 10))}日\u3000(${WD_JA[weekdayOf(date)]})]`
}

/** Cell value for one day and one shift ('' = not available). */
export function sheetCell(shift: Shift, day: DayChoice | undefined): string {
  if (!day) return ''
  if (shift === 'early') {
    const parts = [day.early ? SHEET_VALUE.early[day.early] : '', day.early_until_1730 ? SHEET_VALUE.early_until_1730 : ''].filter(Boolean)
    return parts.join(', ')
  }
  if (shift === 'middle') return day.middle ? SHEET_VALUE.middle[day.middle] : ''
  return day.late ? SHEET_VALUE.late[day.late] : ''
}

export function answerCells(a: ShiftAnswers): string[] {
  return [
    a.message,
    ANSWER_VALUE.homeTrip[a.homeTrip],
    a.homeTripWhen,
    ANSWER_VALUE.paidLeave[a.paidLeave],
    a.paidLeaveComment,
    a.schoolHoliday,
    ANSWER_VALUE.resign[a.resign],
    a.resignWhen,
    a.checkedNotice ? ANSWER_VALUE.checked : '',
    a.checkedIrregular ? ANSWER_VALUE.checked : '',
  ]
}

export interface ExportRequest {
  name: string
  email: string
  submittedAt: string // shown as given (already Tokyo time)
  shifts: Shift[]
  days: Record<string, DayChoice>
  answers: ShiftAnswers
}

/**
 * One sheet in the workbook layout: one column per person, rows = タイムスタンプ / メールアドレス /
 * 名前 / one row per day / the extra questions.
 */
export function sheetRows(shift: Shift, month: string, requests: ExportRequest[]): string[][] {
  const people = requests.filter((r) => r.shifts.includes(shift))
  const rows: string[][] = [
    ['タイムスタンプ', ...people.map((p) => p.submittedAt)],
    ['メールアドレス', ...people.map((p) => p.email)],
    ['名前', ...people.map((p) => p.name)],
    ...monthDates(month).map((d) => [sheetDayLabel(d), ...people.map((p) => sheetCell(shift, p.days[d]))]),
  ]
  QUESTIONS_JA.forEach((q, i) => rows.push([q, ...people.map((p) => answerCells({ ...EMPTY_ANSWERS, ...p.answers })[i] ?? '')]))
  return rows
}
