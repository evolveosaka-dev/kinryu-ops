import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Card, ErrorBox, PageTitle, Segmented, Spinner } from '../../components/ui'
import { EMPTY_ANSWERS, nextMonth, SHEET_NAME, sheetRows, type DayChoice, type ExportRequest, type ShiftAnswers } from '../../domain/shiftRequest'
import { tokyoParts } from '../../domain/time'
import { SHIFTS, type Shift } from '../../domain/types'
import { errorMessage } from '../../lib/format'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { exportXlsx, jstDateTime, usePeople } from './data'
import { ManagerTabs } from './ManagerTabs'

interface Row {
  id: string
  user_id: string
  shifts: Shift[]
  days: Record<string, DayChoice>
  answers: Partial<ShiftAnswers>
  submitted_at: string
  updated_at: string
}

/** シフト希望: who submitted for a month, and the export in the workbook layout. */
export function ShiftRequestsAdminPage() {
  const { t } = useTranslation('manager')
  const today = tokyoParts(new Date()).date
  const months = [`${today.slice(0, 7)}-01`, nextMonth(today), nextMonth(nextMonth(today))]
  const [month, setMonth] = useState(months[1]!)
  const people = usePeople()
  const [exportError, setExportError] = useState<string | null>(null)
  const emails = useQuery({
    queryKey: ['admin', 'emails'],
    queryFn: async () => unwrap<{ id: string; email: string | null }[]>(await supabase.from('profiles').select('id, email')),
  })
  const requests = useQuery({
    queryKey: ['admin', 'shift_requests', month],
    queryFn: async () => unwrap<Row[]>(await supabase.from('shift_requests').select('*').eq('month', month).order('submitted_at')),
  })

  if (requests.isLoading || people.isLoading) return <Spinner />
  if (requests.error) return <ErrorBox message={errorMessage(requests.error)} />

  const rows = requests.data ?? []
  const submittedIds = new Set(rows.map((r) => r.user_id))
  const missing = (people.data ?? []).filter((p) => p.status === 'active' && !submittedIds.has(p.id))
  const emailOf = (id: string) => emails.data?.find((e) => e.id === id)?.email ?? ''
  const label = (m: string) => `${m.slice(0, 4)}/${Number(m.slice(5, 7))}`

  const doExport = async () => {
    setExportError(null)
    const list: ExportRequest[] = rows.map((r) => ({
      name: people.name(r.user_id),
      email: emailOf(r.user_id),
      submittedAt: jstDateTime(r.updated_at).replace(/-/g, '/'),
      shifts: r.shifts,
      days: r.days,
      answers: { ...EMPTY_ANSWERS, ...r.answers },
    }))
    try {
      await exportXlsx(
        `金龍_シフト希望_${month.slice(0, 7)}.xlsx`,
        SHIFTS.map((s) => ({ name: SHEET_NAME[s], rows: sheetRows(s, month, list) })),
      )
    } catch (err) {
      setExportError(errorMessage(err))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ManagerTabs />
      <PageTitle title={t('shiftRequests.title')} />
      <Segmented label="" value={month} onChange={setMonth} options={months.map((m) => ({ value: m, label: label(m) }))} />
      <Button variant="secondary" onClick={() => void doExport()} disabled={rows.length === 0}>
        {t('shiftRequests.export')}
      </Button>
      <p className="text-sm text-muted">{t('shiftRequests.note')}</p>
      {exportError && <ErrorBox message={exportError} />}

      <Card className="flex flex-col gap-2">
        <h2 className="font-bold">{t('shiftRequests.submitted', { n: rows.length })}</h2>
        {rows.length === 0 && <p className="text-sm text-muted">{t('shiftRequests.none')}</p>}
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col py-2">
              <span className="font-bold">{people.name(r.user_id)}</span>
              <span className="text-sm text-muted">
                {r.shifts
                  .map((s) => t('shiftRequests.days', { shift: t(`common:shift.${s}`), n: Object.values(r.days).filter((d) => d[s]).length }))
                  .join(' ・ ')}
                {' ・ '}
                {t('shiftRequests.updated', { at: jstDateTime(r.updated_at).slice(5) })}
              </span>
              {r.answers.message && <span className="text-sm">💬 {r.answers.message}</span>}
              {(r.answers.homeTrip === 'yes' || r.answers.resign === 'yes' || r.answers.paidLeave === 'want') && (
                <span className="text-sm font-bold text-amber-800">
                  {[r.answers.homeTrip === 'yes' && `一時帰国 ${r.answers.homeTripWhen ?? ''}`, r.answers.paidLeave === 'want' && `有給 ${r.answers.paidLeaveComment ?? ''}`, r.answers.resign === 'yes' && `退職 ${r.answers.resignWhen ?? ''}`]
                    .filter(Boolean)
                    .join(' ／ ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {missing.length > 0 && (
        <Card className="flex flex-col gap-2">
          <h2 className="font-bold">
            {t('shiftRequests.notSubmitted')}（{missing.length}）
          </h2>
          <ul className="flex flex-wrap gap-2 text-sm">
            {missing.map((p) => (
              <li key={p.id} className="rounded-full bg-surface px-3 py-1">
                {p.full_name || p.display_name}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
