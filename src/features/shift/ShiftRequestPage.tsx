import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useMe } from '../../app/auth'
import { useToast } from '../../components/Toast'
import { Button, Card, Checkbox, ErrorBox, PageTitle, Segmented, SectionTitle, Spinner, StickyActions, TextArea, TextInput } from '../../components/ui'
import {
  EMPTY_ANSWERS,
  monthDates,
  nextMonth,
  validateRequest,
  type AnswerError,
  type DayChoice,
  type ShiftAnswers,
} from '../../domain/shiftRequest'
import { formatTokyoTime, tokyoParts, weekdayOf } from '../../domain/time'
import { SHIFTS, type Shift } from '../../domain/types'
import { cx } from '../../lib/cx'
import { errorMessage, isNetworkError } from '../../lib/format'
import { unwrap, useHolidays } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { TranslationCancelled, useTranslationGate } from '../translate/useTranslationGate'

interface StoredRequest {
  id: string
  month: string
  shifts: Shift[]
  days: Record<string, DayChoice>
  answers: Partial<ShiftAnswers>
  submitted_at: string
  updated_at: string
}

/** Chip options per shift: [value, label]. Times are the same in every language. */
const OPTIONS: Record<Shift, [string, string][]> = {
  early: [
    ['full', '7-17'],
    ['morning', '7-11'],
    ['afternoon', '11-17'],
  ],
  middle: [
    ['ok', '17-23'],
    ['from_1730', '17:30～'],
  ],
  late: [
    ['ok', '23-7'],
    ['from_2200', '22:00～'],
  ],
}

function Chip({ on, onClick, children, tone = 'blue' }: { on: boolean; onClick: () => void; children: React.ReactNode; tone?: 'blue' | 'grey' }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        'min-h-10 rounded-lg border-[1.5px] px-0.5 text-sm font-bold tracking-tight whitespace-nowrap',
        on ? (tone === 'blue' ? 'border-brand bg-brand text-white' : 'border-slate-700 bg-slate-700 text-white') : 'border-line bg-white text-ink',
      )}
    >
      {children}
    </button>
  )
}

export function ShiftRequestPage() {
  const me = useMe()
  const today = tokyoParts(new Date()).date
  const months = [nextMonth(today), nextMonth(nextMonth(today))]
  const [month, setMonth] = useState(months[0]!)
  const existing = useQuery({
    queryKey: ['shift_request', me.id, month],
    queryFn: async () =>
      unwrap<StoredRequest | null>(await supabase.from('shift_requests').select('*').eq('user_id', me.id).eq('month', month).maybeSingle()),
  })
  if (existing.isLoading) return <Spinner />
  // remount the form per month so it starts from the saved request
  return <ShiftRequestForm key={month} month={month} months={months} onMonth={setMonth} saved={existing.data ?? null} />
}

function ShiftRequestForm({ month, months, onMonth, saved }: { month: string; months: string[]; onMonth: (m: string) => void; saved: StoredRequest | null }) {
  const { t } = useTranslation('shift')
  const me = useMe()
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const holidays = useHolidays()
  const translation = useTranslationGate()

  const [shifts, setShifts] = useState<Shift[]>(saved?.shifts ?? [])
  const [days, setDays] = useState<Record<string, DayChoice>>(saved?.days ?? {})
  const [answers, setAnswers] = useState<ShiftAnswers>({ ...EMPTY_ANSWERS, ...saved?.answers })
  const [errors, setErrors] = useState<AnswerError[]>([])
  const [error, setError] = useState<string | null>(null)
  const dates = monthDates(month)
  const set = (patch: Partial<ShiftAnswers>) => setAnswers((a) => ({ ...a, ...patch }))

  const setDay = (date: string, patch: DayChoice) =>
    setDays((d) => {
      const next = { ...d[date], ...patch }
      for (const k of Object.keys(next) as (keyof DayChoice)[]) if (next[k] === undefined || next[k] === false) delete next[k]
      return { ...d, [date]: next }
    })
  const fillAll = (shift: Shift) => setDays((d) => Object.fromEntries(dates.map((date) => [date, { ...d[date], [shift]: OPTIONS[shift][0]![0] }])))
  const clearAll = (shift: Shift) =>
    setDays((d) =>
      Object.fromEntries(
        dates.map((date) => {
          const next = { ...d[date] }
          delete next[shift]
          if (shift === 'early') delete next.early_until_1730
          return [date, next]
        }),
      ),
    )
  const countDays = (shift: Shift) => dates.filter((d) => days[d]?.[shift]).length

  const submit = useMutation({
    mutationFn: async () => {
      const problems = validateRequest(shifts, answers)
      setErrors(problems)
      if (problems.length) throw new Error('validation')
      // free text in other languages → Japanese, confirmed by the writer
      const tr = await translation.prepare([
        { key: 'message', label: t('q.message'), text: answers.message.trim() || null },
        { key: 'paidLeaveComment', label: t('q.paidLeaveComment'), text: answers.paidLeaveComment.trim() || null },
        { key: 'homeTripWhen', label: t('q.homeTripWhen'), text: answers.homeTripWhen.trim() || null },
        { key: 'schoolHoliday', label: t('q.schoolHoliday'), text: answers.schoolHoliday.trim() || null },
        { key: 'resignWhen', label: t('q.resignWhen'), text: answers.resignWhen.trim() || null },
      ])
      const finalAnswers: ShiftAnswers = { ...answers }
      for (const k of ['message', 'paidLeaveComment', 'homeTripWhen', 'schoolHoliday', 'resignWhen'] as const) finalAnswers[k] = tr.values[k] ?? ''
      // keep only the chosen shifts in the day data
      const cleanDays = Object.fromEntries(
        Object.entries(days)
          .map(([date, d]) => {
            const kept: DayChoice = {}
            if (shifts.includes('early') && d.early) Object.assign(kept, { early: d.early, early_until_1730: d.early_until_1730 || undefined })
            if (shifts.includes('middle') && d.middle) kept.middle = d.middle
            if (shifts.includes('late') && d.late) kept.late = d.late
            return [date, JSON.parse(JSON.stringify(kept)) as DayChoice]
          })
          .filter(([, d]) => Object.keys(d as object).length > 0),
      )
      unwrap(
        await supabase.from('shift_requests').upsert(
          {
            user_id: me.id,
            month,
            shifts,
            days: cleanDays,
            answers: finalAnswers,
            original_texts: tr.originals,
            source_lang: tr.sourceLang,
            submitted_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,month' },
        ),
      )
    },
    onSuccess: () => {
      toast(t('done'))
      void queryClient.invalidateQueries({ queryKey: ['shift_request'] })
      void navigate('/')
    },
    onError: (err) => {
      if (err.message === 'validation' || err instanceof TranslationCancelled) return setError(null)
      setError(isNetworkError(err) ? t('common:error.network') : `${t('common:error.generic')} (${errorMessage(err)})`)
    },
  })

  const monthLabel = (m: string) => t('monthLabel', { y: m.slice(0, 4), m: Number(m.slice(5, 7)) })
  const isOff = (date: string) => {
    const wd = weekdayOf(date)
    return wd === 0 || wd === 6 || holidays.data?.has(date)
  }

  return (
    <div className="flex flex-col gap-4">
      {translation.review}
      <PageTitle title={t('title')} />
      {saved && (
        <p className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-bold text-green-900">
          ✓ {t('submitted', { date: `${saved.updated_at.slice(5, 10).replace('-', '/')} ${formatTokyoTime(new Date(saved.updated_at))}` })}
        </p>
      )}

      <Card className="flex flex-col gap-4">
        <Segmented label={t('month')} value={month} onChange={onMonth} options={months.map((m) => ({ value: m, label: monthLabel(m) }))} />
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[15px] font-bold">{t('shifts.label')}</legend>
          {SHIFTS.map((s) => (
            <Checkbox key={s} checked={shifts.includes(s)} onChange={(on) => setShifts((xs) => (on ? SHIFTS.filter((x) => x === s || xs.includes(x)) : xs.filter((x) => x !== s)))}>
              <b>{t(`shifts.${s}`)}</b>
            </Checkbox>
          ))}
          {errors.includes('shifts') && <ErrorBox message={t('err.shifts')} />}
        </fieldset>
      </Card>

      {shifts.length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionTitle>{t('days.title')}</SectionTitle>
          <p className="text-sm text-muted">{t('days.hint')}</p>
          {shifts.map((s) => (
            <div key={s} className="flex flex-wrap items-center gap-2 text-sm">
              <b className="min-w-16">{t(`common:shift.${s}`)}</b>
              <span className="text-muted">{t('days.count', { n: countDays(s) })}</span>
              <Button variant="secondary" className="min-h-10 px-3 text-sm" onClick={() => fillAll(s)}>
                {t('days.allOk')}
              </Button>
              <Button variant="ghost" className="min-h-10 text-sm" onClick={() => clearAll(s)}>
                {t('days.clear')}
              </Button>
            </div>
          ))}
          <ul className="flex flex-col gap-1 text-xs text-muted">
            {shifts.map((s) => (
              <li key={s}>
                <b>{t(`common:shift.${s}`)}</b>: {t(`days.legend${s.charAt(0).toUpperCase()}${s.slice(1)}`)}
              </li>
            ))}
          </ul>
          <Card className="p-0">
            <ul className="divide-y divide-line">
              {dates.map((date) => {
                const d = days[date] ?? {}
                return (
                  <li key={date} className="flex items-start gap-2 px-3 py-2.5">
                    <span className={cx('w-11 shrink-0 pt-2 font-bold', isOff(date) && 'text-red-700')}>
                      {Number(date.slice(8, 10))}
                      <span className="ml-1 text-xs">{t(`common:wd.${weekdayOf(date)}`)}</span>
                    </span>
                    <div className="flex flex-1 flex-col gap-1.5">
                      {shifts.map((s) => (
                        <div key={s} className="flex flex-col gap-0.5">
                          {shifts.length > 1 && <span className="text-xs text-muted">{t(`common:shift.${s}`)}</span>}
                          <div className="grid grid-cols-4 gap-1.5">
                          {OPTIONS[s].map(([value, label]) => (
                            <Chip key={value} on={d[s] === value} onClick={() => setDay(date, { [s]: d[s] === value ? undefined : value } as DayChoice)}>
                              {label}
                            </Chip>
                          ))}
                          {s === 'early' && (
                            <Chip tone="grey" on={Boolean(d.early_until_1730)} onClick={() => setDay(date, { early_until_1730: !d.early_until_1730 })}>
                              +17:30
                            </Chip>
                          )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </li>
                )
              })}
            </ul>
          </Card>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <SectionTitle>{t('questionsTitle')}</SectionTitle>
        <Card className="flex flex-col gap-4">
          <TextArea label={t('q.message')} value={answers.message} onChange={(e) => set({ message: e.target.value })} maxLength={1000} />
          <Segmented
            label={t('q.homeTrip')}
            value={answers.homeTrip}
            onChange={(homeTrip) => set({ homeTrip })}
            options={(['no', 'yes', 'unknown'] as const).map((v) => ({ value: v, label: t(`opt.homeTrip.${v}`) }))}
          />
          {answers.homeTrip !== 'no' && (
            <TextInput
              label={t('q.homeTripWhen')}
              hint={t('q.homeTripWhenHint')}
              value={answers.homeTripWhen}
              onChange={(e) => set({ homeTripWhen: e.target.value })}
              error={errors.includes('homeTripWhen') ? t('err.homeTripWhen') : null}
            />
          )}
          <Segmented
            label={t('q.paidLeave')}
            value={answers.paidLeave}
            onChange={(paidLeave) => set({ paidLeave })}
            options={(['none', 'want'] as const).map((v) => ({ value: v, label: t(`opt.paidLeave.${v}`) }))}
          />
          {answers.paidLeave === 'want' && (
            <TextInput label={t('q.paidLeaveComment')} value={answers.paidLeaveComment} onChange={(e) => set({ paidLeaveComment: e.target.value })} />
          )}
          <TextInput label={t('q.schoolHoliday')} hint={t('q.schoolHolidayHint')} value={answers.schoolHoliday} onChange={(e) => set({ schoolHoliday: e.target.value })} />
          <Segmented
            label={t('q.resign')}
            value={answers.resign}
            onChange={(resign) => set({ resign })}
            options={(['no', 'yes'] as const).map((v) => ({ value: v, label: t(`opt.resign.${v}`) }))}
          />
          {answers.resign === 'yes' && (
            <TextInput
              label={t('q.resignWhen')}
              value={answers.resignWhen}
              onChange={(e) => set({ resignWhen: e.target.value })}
              error={errors.includes('resignWhen') ? t('err.resignWhen') : null}
            />
          )}
          <div className="flex flex-col gap-1 rounded-xl bg-surface p-2">
            <Checkbox checked={answers.checkedNotice} onChange={(checkedNotice) => set({ checkedNotice })}>
              {t('q.checkNotice')}
            </Checkbox>
            <Checkbox checked={answers.checkedIrregular} onChange={(checkedIrregular) => set({ checkedIrregular })}>
              {t('q.checkIrregular')}
            </Checkbox>
          </div>
          {errors.includes('checks') && <ErrorBox message={t('err.checks')} />}
        </Card>
      </section>

      <StickyActions>
        {error && <ErrorBox message={error} />}
        {errors.length > 0 && <ErrorBox message={t(`err.${errors[0]}`)} />}
        <Button className="mt-2 w-full" onClick={() => submit.mutate()} disabled={submit.isPending}>
          {submit.isPending ? t('common:action.loading') : t('common:action.submit')}
        </Button>
      </StickyActions>
    </div>
  )
}
