import { FunctionsHttpError } from '@supabase/supabase-js'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMe } from '../../app/auth'
import { useToast } from '../../components/Toast'
import { Button, Card, ErrorBox, PageTitle, Spinner } from '../../components/ui'
import { MAIL_DAY_LIMIT, MAIL_WARN, systemProblems, type SystemStatus } from '../../domain/systemStatus'
import { VideoSizeGuide } from '../attachments/VideoSizeGuide'
import { cx } from '../../lib/cx'
import { errorMessage } from '../../lib/format'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { jstDateTime, useSystemStatus } from './data'
import { ManagerTabs } from './ManagerTabs'

function Row({ label, value, bad, children }: { label: string; value: React.ReactNode; bad?: boolean; children?: React.ReactNode }) {
  return (
    <div className={cx('flex flex-col gap-1 rounded-xl p-3', bad ? 'bg-red-50' : 'bg-surface')}>
      <span className="flex items-center justify-between gap-2">
        <span className="font-bold">
          {bad ? '⚠ ' : '✓ '}
          {label}
        </span>
        <b className={cx('tabular-nums', bad ? 'text-red-700' : 'text-green-800')}>{value}</b>
      </span>
      {children}
    </div>
  )
}

/** Weekly backup to Drive: last one, its result, 今すぐバックアップ. */
function BackupCard({ s, bad }: { s: SystemStatus; bad: boolean }) {
  const { t } = useTranslation('manager')
  const me = useMe()
  const queryClient = useQueryClient()
  const run = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<{ tables: Record<string, number> }>('sync-sheets', { body: { action: 'backup' } })
      if (error) {
        const detail = error instanceof FunctionsHttpError ? ((await (error.context as Response).json().catch(() => ({}))) as { error?: string }).error : null
        throw new Error(detail ?? error.message)
      }
      return data!
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'system_status'] }),
  })
  const r = s.backup_result
  const errors = Object.entries(r?.errors ?? {})
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="font-bold">💾 {t('system.backupTitle')}</h2>
      <Row label={t('system.backupLast')} value={s.backup_at ? jstDateTime(s.backup_at).slice(5) : t('system.backupNever')} bad={bad}>
        {r && <span className="text-xs text-muted">{t('system.backupResult', { tables: r.tables, rows: r.rows.toLocaleString(), kb: Math.round(r.bytes / 1024) })}</span>}
        {errors.map(([k, v]) => (
          <span key={k} className="text-xs text-red-800">
            {k}: {v}
          </span>
        ))}
        {s.backup_url && (
          <a href={s.backup_url} target="_blank" rel="noreferrer" className="text-sm font-bold text-brand underline">
            {t('system.backupOpen')} ↗
          </a>
        )}
      </Row>
      <p className="text-xs text-muted">{t('system.backupNote')}</p>
      {!me.is_test_account && (
        <Button variant="secondary" onClick={() => run.mutate()} disabled={run.isPending}>
          {run.isPending ? t('system.backupRunning') : t('system.backupNow')}
        </Button>
      )}
      {run.error && <ErrorBox message={errorMessage(run.error)} />}
    </Card>
  )
}

const fileSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const agoMin = (at: string) => Math.max(0, Math.round((Date.now() - Date.parse(at)) / 60_000))

type Pending = NonNullable<SystemStatus['uploads_pending_list']>[number]

/** One file waiting > 1 hour: where it is, and 本人に連絡 / 欠落として閉じる (migration 20261019000002). */
function PendingFile({ u }: { u: Pending }) {
  const { t } = useTranslation('manager')
  const toast = useToast()
  const queryClient = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const nudge = useMutation({
    mutationFn: async () => unwrap<boolean>(await supabase.rpc('nudge_upload_owner', { p_owner: u.owner })),
    onSuccess: (sent) => toast(sent ? t('system.nudged', { name: u.name }) : t('system.noPush', { name: u.name })),
  })
  const close = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('close_pending_upload', { p_id: u.id })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'system_status'] }),
  })
  return (
    <li className="flex flex-col gap-1.5 rounded-lg bg-white p-2 text-sm">
      <span className="font-bold text-red-800">
        {jstDateTime(u.at).slice(5)} {u.name} — {u.parent ? `${t(`system.parent.${u.parent}`)} ` : ''}
        {u.kind === 'video' ? '🎥' : '📷'} {fileSize(u.size)}
      </span>
      {u.id && (
        <>
          <span className="text-xs text-muted">{u.seen ? t('system.seenOnPhone', { min: agoMin(u.seen) }) : t('system.notSeen')}</span>
          {confirm ? (
            <span className="flex flex-col gap-1.5 rounded-lg bg-amber-50 p-2">
              <span className="text-xs font-bold text-amber-900">{t('system.closeConfirm')}</span>
              <span className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => setConfirm(false)}>
                  {t('system.cancel')}
                </Button>
                <Button onClick={() => close.mutate()} disabled={close.isPending}>
                  {t('system.closeLost')}
                </Button>
              </span>
            </span>
          ) : (
            <span className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => nudge.mutate()} disabled={nudge.isPending || !u.push}>
                📣 {u.push ? t('system.nudge') : t('system.pushOff')}
              </Button>
              <Button variant="secondary" onClick={() => setConfirm(true)}>
                {t('system.closeLost')}
              </Button>
            </span>
          )}
          {(nudge.error || close.error) && <ErrorBox message={errorMessage(nudge.error ?? close.error)} />}
        </>
      )}
    </li>
  )
}

/** 管理 → 設定 → システム状態. */
export function SystemPage() {
  const { t } = useTranslation('manager')
  const q = useSystemStatus()
  if (q.isLoading) return <Spinner />
  if (q.error) return <ErrorBox message={errorMessage(q.error)} />
  const s = q.data!
  const problems = systemProblems(s, new Date())
  const has = (p: (typeof problems)[number]) => problems.includes(p)
  const pct = Math.min(100, Math.round((s.mails_today / MAIL_DAY_LIMIT) * 100))
  return (
    <div className="flex flex-col gap-3">
      <ManagerTabs />
      <PageTitle title={t('system.title')} subtitle={t('system.subtitle')} />
      <p className={cx('rounded-xl p-3 font-bold', problems.length ? 'bg-red-100 text-red-900' : 'bg-green-100 text-green-900')}>
        {problems.length ? `⚠ ${t('system.problems', { n: problems.length })}` : `✓ ${t('system.allOk')}`}
      </p>

      <Card className="flex flex-col gap-2">
        <h2 className="font-bold">✉️ {t('system.mailTitle')}</h2>
        <Row label={t('system.mailsToday')} value={`${s.mails_today} / ${MAIL_DAY_LIMIT}`} bad={has('mails')}>
          <div className="h-2.5 overflow-hidden rounded-full bg-white">
            <div className={cx('h-full', s.mails_today >= MAIL_WARN ? 'bg-red-500' : 'bg-green-600')} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs text-muted">
            {Object.entries(s.mails_by_kind)
              .map(([k, n]) => `${t(`system.mailKind.${k}`, { defaultValue: k })} ${n}`)
              .join(' ・ ') || t('system.noMails')}
          </span>
          <span className="text-xs text-muted">{t('system.mailNote', { warn: MAIL_WARN })}</span>
        </Row>
        <Row label={t('system.notifyFailed')} value={s.notify_failed.length} bad={has('notifyFailed')}>
          {s.notify_failed.slice(0, 5).map((e) => (
            <span key={e.id} className="text-xs text-red-800">
              {jstDateTime(e.at)} {t(`notify.kind.${e.kind}`, { defaultValue: e.kind })}: {e.error}
            </span>
          ))}
        </Row>
        <Row label={t('system.notifyWaiting')} value={s.notify_waiting} bad={has('notifyWaiting')} />
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="font-bold">📷 {t('system.uploadTitle')}</h2>
        <Row label={t('system.uploadsFailed')} value={s.uploads_failed} bad={has('uploadsFailed')} />
        <Row label={t('system.uploadsPending')} value={s.uploads_pending} bad={has('uploadsPending')}>
          <ul className="flex flex-col gap-1.5">
            {(s.uploads_pending_list ?? []).map((u, i) => (
              <PendingFile key={u.id ?? i} u={u} />
            ))}
          </ul>
        </Row>
        <p className="text-xs text-muted">{t('system.uploadNote')}</p>
        {(s.uploads_lost_list ?? []).length > 0 && (
          <details className="rounded-xl bg-surface p-3 text-sm">
            <summary className="cursor-pointer font-bold">📭 {t('system.lostTitle', { n: s.uploads_lost_list!.length })}</summary>
            <p className="mt-1 text-xs text-muted">{t('system.lostNote')}</p>
            <ul className="mt-1 flex flex-col gap-1">
              {s.uploads_lost_list!.map((u, i) => (
                <li key={i} className="text-xs">
                  {jstDateTime(u.at).slice(5)} {u.name} — {u.parent ? `${t(`system.parent.${u.parent}`)} ` : ''}
                  {u.kind === 'video' ? '🎥' : '📷'} {u.reason ? `（${t(`system.lostReason.${u.reason}`)}）` : ''}
                </li>
              ))}
            </ul>
          </details>
        )}
        <details className="text-sm">
          <summary className="min-h-10 cursor-pointer font-bold text-blue-800">🎥 {t('system.videoGuide')}</summary>
          <VideoSizeGuide />
        </details>
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="font-bold">⏱️ {t('system.jobsTitle')}</h2>
        {s.jobs.length === 0 ? (
          <p className="text-sm text-muted">{t('system.noJobs')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {s.jobs.map((j) => (
              <li key={j.name} className={cx('flex flex-col rounded-lg px-2 py-1.5 text-sm', j.status === 'failed' ? 'bg-red-50' : 'bg-surface')}>
                <span className="flex justify-between gap-2">
                  <b>{t(`system.job.${j.name}`, { defaultValue: j.name })}</b>
                  <span className={j.status === 'failed' ? 'font-bold text-red-700' : 'text-green-800'}>
                    {j.status === 'failed' ? `✗ ${t('system.failed')}` : j.status ? '✓' : '—'} {j.at ? jstDateTime(j.at).slice(5) : ''}
                  </span>
                </span>
                {j.status === 'failed' && j.message && <span className="text-xs text-red-800">{j.message}</span>}
              </li>
            ))}
          </ul>
        )}
        <Row label={t('system.sheets')} value={s.sheets_synced_at ? jstDateTime(s.sheets_synced_at).slice(5) : '—'} bad={has('sheets')} />
      </Card>

      <BackupCard s={s} bad={has('backup')} />

      <Card className="flex flex-col gap-1 text-sm">
        <h2 className="font-bold">🤖 {t('system.aiTitle')}</h2>
        <p>{t('system.aiUsage', { calls: s.ai_tokens_month.calls, input: s.ai_tokens_month.input, output: s.ai_tokens_month.output })}</p>
      </Card>
    </div>
  )
}
