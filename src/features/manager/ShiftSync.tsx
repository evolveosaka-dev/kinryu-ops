import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../../components/Sheet'
import { useToast } from '../../components/Toast'
import { Button, Card, ErrorBox } from '../../components/ui'
import { addDays, formatShortDate, tokyoParts, weekdayOf } from '../../domain/time'
import { cx } from '../../lib/cx'
import { errorMessage } from '../../lib/format'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { jstDateTime } from './data'
import { importDay, useShiftImportLog, useShiftSyncStatus, type ShiftChange, type ShiftImportLog } from './shiftSyncData'

// シフト表の自動取り込み (Office 365): the share link, last run, 今すぐ取り込む, and the changes of each import.

function ChangeRows({ changes }: { changes: ShiftChange[] }) {
  const { t } = useTranslation('manager')
  const wd = t('shiftSync.weekdays').split(',')
  const dates = [...new Set(changes.map((c) => c.date))]
  return (
    <ul className="flex flex-col gap-2">
      {dates.map((d) => (
        <li key={d} className="rounded-xl border border-line bg-white p-2">
          <p className="font-bold">
            {formatShortDate(d)}（{wd[weekdayOf(d)]}）
          </p>
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {changes
              .filter((c) => c.date === d)
              .map((c) => (
                <li key={`${c.shift}${c.name}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span
                    className={cx(
                      'rounded px-1.5 py-0.5 text-xs font-bold whitespace-nowrap',
                      c.kind === 'added' ? 'bg-green-100 text-green-900' : c.kind === 'removed' ? 'bg-red-100 text-red-900' : 'bg-amber-100 text-amber-900',
                    )}
                  >
                    {t(`shiftSync.kind.${c.kind}`)}
                  </span>
                  <span className="whitespace-nowrap">{t(`common:shift.${c.shift}`)}</span>
                  <b>{c.name}</b>
                  <span className="whitespace-nowrap">
                    {c.kind === 'changed' ? (
                      <>
                        <s className="text-muted">{c.before}</s> → <b>{c.after}</b>
                      </>
                    ) : c.kind === 'added' ? (
                      c.after
                    ) : (
                      <s className="text-muted">{c.before}</s>
                    )}
                  </span>
                </li>
              ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}

function LogDetail({ log, open }: { log: ShiftImportLog; open?: boolean }) {
  const { t } = useTranslation('manager')
  const day = importDay(log)
  const past = log.changes.filter((c) => c.date < day)
  const coming = log.changes.filter((c) => c.date >= day)
  return (
    <details open={open} className="rounded-xl bg-slate-50 ring-1 ring-line">
      <summary className="cursor-pointer p-3 font-bold">
        {jstDateTime(log.imported_at).slice(5)} {t(`shiftSync.source.${log.source}`)}
        <span className="block text-sm font-normal">
          {t('shiftSync.month', { m: Number(log.month.slice(5, 7)) })}・{t('shiftSync.count', { n: log.n_changes })}
          {past.length > 0 && <b className="text-red-800">（{t('shiftSync.pastCount', { n: past.length })}）</b>}
        </span>
      </summary>
      <div className="flex flex-col gap-3 p-3 pt-0">
        {past.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="rounded-lg bg-red-50 p-2 text-sm font-bold text-red-900">⏪ {t('shiftSync.past', { n: past.length, to: formatShortDate(addDays(day, -1)) })}</h3>
            <ChangeRows changes={past} />
          </section>
        )}
        {coming.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="rounded-lg bg-sky-50 p-2 text-sm font-bold text-sky-900">⏩ {t('shiftSync.coming', { n: coming.length, from: formatShortDate(day) })}</h3>
            <ChangeRows changes={coming} />
          </section>
        )}
      </div>
    </details>
  )
}

/** The changes of the given imports (newest first; the first one open). */
export function ShiftChangesSheet({ logs, onClose }: { logs: ShiftImportLog[]; onClose: () => void }) {
  const { t } = useTranslation('manager')
  return (
    <Sheet title={`📅 ${t('shiftSync.sheetTitle')}`} onClose={onClose}>
      <p className="rounded-xl bg-sky-50 p-3 text-sm font-bold text-sky-900">{t('shiftSync.sheetHelp')}</p>
      <p className="text-sm text-muted">{t('shiftSync.legend')}</p>
      <div className="flex flex-col gap-2">
        {logs.map((l, i) => (
          <LogDetail key={l.id} log={l} open={i === 0} />
        ))}
      </div>
    </Sheet>
  )
}

/** 設定 → シフト表の読み込み: the Office 365 link, last run, 今すぐ取り込む, history. */
export function ShiftSyncCard() {
  const { t } = useTranslation('manager')
  const toast = useToast()
  const queryClient = useQueryClient()
  const sync = useShiftSyncStatus()
  const logs = useShiftImportLog()
  const [editing, setEditing] = useState(false)
  const [url, setUrl] = useState('')
  const [shown, setShown] = useState<ShiftImportLog | null>(null)
  const refresh = () => {
    for (const k of [['admin', 'shift_sync_status'], ['admin', 'shift_import_log'], ['shift_assignments'], ['shift_coworkers'], ['staff_roster'], ['admin', 'shift-month-count'], ['admin', 'sales_sync_status'], ['analysis']])
      void queryClient.invalidateQueries({ queryKey: k })
  }
  const save = useMutation({
    mutationFn: async (v: string) => unwrap(await supabase.rpc('set_shift_workbook_url', { p_url: v })),
    onSuccess: () => {
      setEditing(false)
      toast(t('shiftSync.saved'))
      refresh()
    },
  })
  const run = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<{ rows: number; changes: number }>('shift-sync', { body: {} })
      if (error) {
        const body = (await (error as { context?: Response }).context?.json?.().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? error.message)
      }
      return data!
    },
    onSuccess: (r) => toast(t('shiftSync.ran', { rows: r.rows, n: r.changes })),
    onSettled: refresh,
  })
  const s = sync.data?.status
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="font-bold">☁️ {t('shiftSync.title')}</h2>
      <p className="text-sm text-muted">{t('shiftSync.note')}</p>
      {editing || !sync.data?.url ? (
        <div className="flex flex-col gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…sharepoint.com/…"
            aria-label={t('shiftSync.link')}
            className="min-h-12 min-w-0 rounded-xl border border-line px-3"
          />
          {save.error && <ErrorBox message={errorMessage(save.error).includes('invalid_url') ? t('shiftSync.badUrl') : errorMessage(save.error)} />}
          <div className="flex gap-2">
            <Button className="flex-1" disabled={save.isPending || !url.trim()} onClick={() => save.mutate(url.trim())}>
              {t('shiftSync.saveLink')}
            </Button>
            {editing && (
              <Button variant="secondary" className="flex-1" onClick={() => setEditing(false)}>
                {t('shiftSync.cancel')}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <p className="flex items-center justify-between gap-2 text-sm">
          <span className="min-w-0 truncate">🔗 {sync.data.url}</span>
          <button
            type="button"
            className="shrink-0 font-bold text-brand underline"
            onClick={() => {
              setUrl(sync.data?.url ?? '')
              setEditing(true)
            }}
          >
            {t('shiftSync.change')}
          </button>
        </p>
      )}
      {s && s.months && s.months.length > 1 ? (
        <div className={cx('flex flex-col gap-0.5 rounded-lg p-2 text-sm font-bold', s.ok ? 'bg-green-50 text-green-900' : 'bg-red-50 text-red-900')}>
          <span>{t('shiftSync.lastRun', { at: jstDateTime(s.at).slice(5) })}</span>
          {s.months.map((m) => (
            <span key={m.month} className={cx(!m.ok && 'text-red-800', m.ok && !m.found && 'font-normal text-slate-600')}>
              {!m.found
                ? `・${t('shiftSync.monthNone', { m: Number(m.month.slice(5, 7)) })}`
                : m.ok
                  ? `✓ ${t('shiftSync.monthOk', { m: Number(m.month.slice(5, 7)), rows: m.rows, n: m.changes })}`
                  : `✗ ${t('shiftSync.monthFail', { m: Number(m.month.slice(5, 7)), error: m.error })}`}
            </span>
          ))}
        </div>
      ) : (
        s && (
          <p className={cx('rounded-lg p-2 text-sm font-bold', s.ok ? 'bg-green-50 text-green-900' : 'bg-red-50 text-red-900')}>
            {s.ok
              ? `✓ ${t('shiftSync.lastOk', { at: jstDateTime(s.at).slice(5), m: Number(s.month?.slice(5, 7)), rows: s.rows, n: s.changes })}`
              : `✗ ${t('shiftSync.lastFail', { at: jstDateTime(s.at).slice(5), error: s.error })}`}
          </p>
        )
      )}
      {run.error && <ErrorBox message={errorMessage(run.error)} />}
      {sync.data?.url && (
        <Button variant="secondary" disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? t('shiftSync.running') : `🔄 ${t('shiftSync.runNow')}`}
        </Button>
      )}
      <h3 className="mt-2 font-bold">{t('shiftSync.history')}</h3>
      {(logs.data ?? []).length === 0 ? (
        <p className="text-sm text-muted">{t('shiftSync.noHistory')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {(logs.data ?? []).map((l) => {
            const past = l.changes.filter((c) => c.date < tokyoParts(new Date(l.imported_at)).date).length
            return (
              <li key={l.id}>
                <button type="button" onClick={() => setShown(l)} className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl bg-white px-3 text-left text-sm ring-1 ring-line">
                  <span>
                    {jstDateTime(l.imported_at).slice(5)} {t(`shiftSync.source.${l.source}`)}
                    {past > 0 && <span className="block text-xs font-bold text-red-800">{t('shiftSync.pastCount', { n: past })}</span>}
                  </span>
                  <span className="shrink-0 font-bold">{t('shiftSync.count', { n: l.n_changes })} ›</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {shown && <ShiftChangesSheet logs={[shown]} onClose={() => setShown(null)} />}
    </Card>
  )
}
