// 給与計算 (System Admin only): the formulas of the payroll workbook (sheet 給与計算, one block per person),
// computed from the shift workbook's sheets (PayrollSource) + rates + each person's settings and monthly inputs.
// Every figure keeps how it was made (daily rows, formula) so the screen can show it.
import type { PayrollSource, PayShift } from '../../supabase/functions/_shared/payrollWorkbook'

export interface PayrollRates {
  normal: number // 通常時給
  night: number // 深夜時給
  overtime: number // 超過時給
  training_normal: number // 研修通常時給
  training_night: number // 研修深夜時給
  day_leader_unit: number // 当日リーダー手当 / h
  training_allowance_unit: number // 研修手当 / h
  busy_unit: number // 繁忙手当 / h
}

export interface PayrollStaff {
  roster_name: string
  staff_code: string | null
  kind: string // 早番 / 中番 / 遅番 / 正社員
  commute_unit: number // 交通費 / 出勤
  leader_unit: number // リーダー・サブリーダー手当 / h
  shift_make_amount: number // シフト作成手当 / month
}

export interface PayrollInput {
  paid_daily: number // 有給日給額
  paid_days: number
  busy_hours: number
  other1_amount: number
  other1_note: string | null
  other2_amount: number
  other2_note: string | null
  commute_adjust: number // 出勤回数調整
  referral_amount: number
  referral_note: string | null
}

export const EMPTY_INPUT: PayrollInput = {
  paid_daily: 0,
  paid_days: 0,
  busy_hours: 0,
  other1_amount: 0,
  other1_note: null,
  other2_amount: 0,
  other2_note: null,
  commute_adjust: 0,
  referral_amount: 0,
  referral_note: null,
}

/** 法定労働時間 of the month (40 h × days / 7, as written in the workbook). */
export function legalHours(month: string): number {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return days === 31 ? 177.14 : days === 30 ? 171.42 : days === 29 ? 165.71 : 160
}

export interface PayrollDay {
  day: number
  early: string
  earlyTraining: number
  middle: string
  middleTraining: number
  late: string
  lateTraining: number
  normal: number // K 通常 (勤務時間リスト)
  normalAdj: number // L 調整 (休憩 ±, 登録外, 時間調整)
  normalExtra: number // M シフト外
  night: number // N 深夜
  nightAdj: number // O
  nightExtra: number // P
  total: number // Q
  stm: number // R (研修1回目: シフト外)
  trainingNormal: number // S (研修2–10回: オーダー外 通常)
  trainingNight: number // T
}

export interface PayrollResult {
  staff: PayrollStaff
  days: PayrollDay[]
  workDays: number // 出勤日数
  sums: Record<'normal' | 'normalAdj' | 'normalExtra' | 'night' | 'nightAdj' | 'nightExtra' | 'total' | 'stm' | 'trainingNormal' | 'trainingNight', number>
  normalTotal: number // K37
  nightTotal: number // N37
  totalHours: number // Q37
  legal: number
  overtimeHours: number // N40
  trainingNormalHours: number // I41
  trainingNightHours: number // L41
  normalHours: number // I40
  nightHours: number // L40
  trainingCount: number // 研修回数
  pay: { normal: number; night: number; overtime: number; trainingNormal: number; trainingNight: number; hourly: number }
  allowances: {
    paid: number
    leader: number
    shiftMake: number
    dayLeader: number
    dayLeaderHours: number
    trainingAllowance: number
    trainingAllowanceHours: number
    busy: number
    other1: number
    other2: number
    commute: number
    commuteDays: number
    referral: number
  }
  total: number // 支給額合計
  /** 月次報告 rows (時間数): シフト外 excluded from 通常 / 深夜, 研修 split into 11–30 and up to 10 */
  report: {
    normal: number
    night: number
    overtime: number
    training11Normal: number
    training11Night: number
    training10Normal: number
    training10Night: number
    extraNormal: number
    extraNight: number
  }
  input: PayrollInput
  missingCodes: string[] // shift cells not in 勤務時間リスト
}

/** Excel ROUND (half away from zero) and ROUNDUP (away from zero) to an integer. */
export const xlRound = (x: number) => Math.sign(x) * Math.round(Math.abs(x) + 1e-9)
export const xlRoundUp = (x: number) => Math.sign(x) * Math.ceil(Math.abs(x) - 1e-9)

const SHIFTS: PayShift[] = ['early', 'middle', 'late']

export function computePayroll(src: PayrollSource, staff: PayrollStaff, rates: PayrollRates, input: PayrollInput = EMPTY_INPUT): PayrollResult {
  const name = staff.roster_name
  const [y, m] = src.month.split('-').map(Number) as [number, number]
  const nDays = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const missing = new Set<string>()
  const kt = (k: PayShift, day: number, col: string) =>
    src.kintai[k].filter((r) => r.day === day && r.name === name).reduce((s, r) => s + (r.v[col] ?? 0), 0)
  const look = (k: PayShift, code: string) => {
    if (!code) return { normal: 0, night: 0 }
    const h = src.hours[k][code]
    if (!h) missing.add(code)
    return h ?? { normal: 0, night: 0 }
  }

  const days: PayrollDay[] = []
  for (let d = 1; d <= nDays; d++) {
    const cell = (k: PayShift) => src.shifts[k][name]?.[String(d)] ?? { code: '', training: 0 }
    const [e, md, l] = SHIFTS.map(cell) as [{ code: string; training: number }, { code: string; training: number }, { code: string; training: number }]
    const normal = look('early', e.code).normal + look('middle', md.code).normal + look('late', l.code).normal
    const night = look('middle', md.code).night + look('late', l.code).night
    const normalAdj =
      -kt('early', d, 'N') + kt('early', d, 'Q') + kt('early', d, 'S') - kt('middle', d, 'P') + kt('middle', d, 'U') + kt('middle', d, 'Y') - kt('late', d, 'P') + kt('late', d, 'U') + kt('late', d, 'Y')
    const nightAdj = -kt('middle', d, 'R') + kt('middle', d, 'W') + kt('middle', d, 'Z') - kt('late', d, 'R') + kt('late', d, 'W') + kt('late', d, 'Z')
    const normalExtra = kt('early', d, 'V') + kt('middle', d, 'AC') + kt('late', d, 'AC')
    const nightExtra = kt('early', d, 'W') + kt('middle', d, 'AD') + kt('late', d, 'AD')
    const total = normal + normalAdj + normalExtra + night + nightAdj + nightExtra
    const tr = [e.training, md.training, l.training]
    const first = tr.some((t) => t === 1)
    const upTo10 = tr.some((t) => t >= 2 && t <= 10)
    days.push({
      day: d,
      early: e.code,
      earlyTraining: e.training,
      middle: md.code,
      middleTraining: md.training,
      late: l.code,
      lateTraining: l.training,
      normal,
      normalAdj,
      normalExtra,
      night,
      nightAdj,
      nightExtra,
      total,
      stm: first ? normalExtra + nightExtra : 0,
      trainingNormal: upTo10 ? normal + normalAdj : 0,
      trainingNight: upTo10 ? night + nightAdj : 0,
    })
  }
  const sum = (f: (x: PayrollDay) => number) => days.reduce((s, x) => s + f(x), 0)
  const sums = {
    normal: sum((x) => x.normal),
    normalAdj: sum((x) => x.normalAdj),
    normalExtra: sum((x) => x.normalExtra),
    night: sum((x) => x.night),
    nightAdj: sum((x) => x.nightAdj),
    nightExtra: sum((x) => x.nightExtra),
    total: sum((x) => x.total),
    stm: sum((x) => x.stm),
    trainingNormal: sum((x) => x.trainingNormal),
    trainingNight: sum((x) => x.trainingNight),
  }
  const normalTotal = sums.normal + sums.normalAdj + sums.normalExtra
  const nightTotal = sums.night + sums.nightAdj + sums.nightExtra
  const totalHours = normalTotal + nightTotal
  const legal = legalHours(src.month)
  const overtimeHours = totalHours > legal ? totalHours - legal : 0
  // 研修 hours: SUMIFS over days with a training number in each sheet, minus the pairs (as the workbook does)
  const anyTraining = sum((x) => x.earlyTraining + x.middleTraining + x.lateTraining) > 0
  const weight = (x: PayrollDay) => {
    const a = x.earlyTraining !== 0 ? 1 : 0
    const b = x.middleTraining !== 0 ? 1 : 0
    const c = x.lateTraining !== 0 ? 1 : 0
    return a + b + c - a * b - b * c - a * c
  }
  const trainingNormalHours = anyTraining ? sum((x) => weight(x) * (x.normal + x.normalAdj + x.normalExtra)) : 0
  const trainingNightHours = anyTraining ? sum((x) => weight(x) * (x.night + x.nightAdj + x.nightExtra)) : 0
  const normalHours = normalTotal - trainingNormalHours - overtimeHours
  const nightHours = nightTotal - trainingNightHours
  const trainingCount = new Set(days.flatMap((x) => [x.earlyTraining, x.middleTraining, x.lateTraining]).filter((t) => t !== 0)).size

  const pay = {
    normal: rates.normal * normalHours,
    night: rates.night * nightHours,
    overtime: rates.overtime * overtimeHours,
    trainingNormal: rates.training_normal * trainingNormalHours,
    trainingNight: rates.training_night * trainingNightHours,
    hourly: 0,
  }
  pay.hourly = pay.normal + pay.night + pay.overtime + pay.trainingNormal + pay.trainingNight

  const workDays = days.filter((x) => x.total > 0).length
  const dayLeaderHours = src.dayLeader.filter((r) => r.name === name).reduce((s, r) => s + r.hours, 0)
  const trainingAllowanceHours = src.trainingAllowance.filter((r) => r.name === name).reduce((s, r) => s + r.hours, 0)
  const commuteDays = workDays + input.commute_adjust
  const allowances = {
    paid: xlRound(input.paid_daily * input.paid_days),
    leader: xlRound(staff.leader_unit * totalHours),
    shiftMake: staff.shift_make_amount,
    dayLeader: xlRound(rates.day_leader_unit * dayLeaderHours),
    dayLeaderHours,
    trainingAllowance: xlRound(rates.training_allowance_unit * trainingAllowanceHours),
    trainingAllowanceHours,
    busy: rates.busy_unit * input.busy_hours,
    other1: input.other1_amount,
    other2: input.other2_amount,
    commute: staff.commute_unit * commuteDays,
    commuteDays,
    referral: input.referral_amount,
  }
  const allowanceSum =
    allowances.paid + allowances.leader + allowances.shiftMake + allowances.dayLeader + allowances.trainingAllowance + allowances.busy + allowances.other1 + allowances.other2 + allowances.commute + allowances.referral
  const total = xlRoundUp(pay.hourly + allowanceSum)

  const training10Normal = sums.stm + sums.trainingNormal
  return {
    staff,
    days,
    workDays,
    sums,
    normalTotal,
    nightTotal,
    totalHours,
    legal,
    overtimeHours,
    trainingNormalHours,
    trainingNightHours,
    normalHours,
    nightHours,
    trainingCount,
    pay,
    allowances,
    total,
    report: {
      normal: normalHours - sums.normalExtra,
      night: nightHours - sums.nightExtra,
      overtime: overtimeHours,
      training11Normal: trainingNormalHours - training10Normal,
      training11Night: trainingNightHours - sums.trainingNight,
      training10Normal,
      training10Night: sums.trainingNight,
      extraNormal: sums.normalExtra,
      extraNight: sums.nightExtra,
    },
    input,
    missingCodes: [...missing],
  }
}
