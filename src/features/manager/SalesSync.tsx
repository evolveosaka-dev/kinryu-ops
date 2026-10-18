import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../components/Toast'
import { Button, Card, ErrorBox } from '../../components/ui'
import { formatShortDate } from '../../domain/time'
import { cx } from '../../lib/cx'
import { errorMessage } from '../../lib/format'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { jstDateTime } from './data'

// 販売杯数の自動取り込み (Office 365): the share link of 「金龍売り上げ杯数」 and the last run. The file is read by
// shift-sync together with the shift workbook (6:00, or 今すぐ取り込む on the card above).

interface SalesChange {
  date: string
  store: string
  shift: 'early' | 'middle' | 'late'
  kind: 'added' | 'changed'
  before: number | null
  after: number
}
interface SalesStatus {
  at: string
  ok: boolean
  last?: string | null
  added?: number
  changed?: number
  report?: number
  changes?: SalesChange[]
  error?: string
}

function useSalesSync() {
  return useQuery({
    queryKey: ['admin', 'sales_sync_status'],
    staleTime: 60_000,
    queryFn: async () => {
      const rows = unwrap<{ key: string; value: string }[]>(await supabase.from('app_kv').select('key, value').in('key', ['sales_workbook_url', 'sales_sync_status']))
      const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null
      const raw = get('sales_sync_status')
      return { url: get('sales_workbook_url'), status: raw ? (JSON.parse(raw) as SalesStatus) : null }
    },
  })
}

export function SalesSyncCard() {
  const { t } = useTranslation('manager')
  const toast = useToast()
  const queryClient = useQueryClient()
  const sync = useSalesSync()
  const [editing, setEditing] = useState(false)
  const [url, setUrl] = useState('')
  const save = useMutation({
    mutationFn: async (v: string) => unwrap(await supabase.rpc('set_sales_workbook_url', { p_url: v })),
    onSuccess: () => {
      setEditing(false)
      toast(t('shiftSync.saved'))
      void queryClient.invalidateQueries({ queryKey: ['admin', 'sales_sync_status'] })
    },
  })
  const s = sync.data?.status
  const changes = s?.changes ?? []
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="font-bold">🍜 {t('salesSync.title')}</h2>
      <p className="text-sm text-muted">{t('salesSync.note')}</p>
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
      {s && (
        <p className={cx('rounded-lg p-2 text-sm font-bold', s.ok ? 'bg-green-50 text-green-900' : 'bg-red-50 text-red-900')}>
          {s.ok
            ? `✓ ${t('salesSync.lastOk', { at: jstDateTime(s.at).slice(5), last: s.last ? formatShortDate(s.last) : '—', added: s.added ?? 0, changed: s.changed ?? 0 })}`
            : `✗ ${t('shiftSync.lastFail', { at: jstDateTime(s.at).slice(5), error: s.error })}`}
        </p>
      )}
      {sync.data?.url && <p className="text-xs text-muted">{t('salesSync.runHint')}</p>}
      {changes.length > 0 && (
        <details className="rounded-xl bg-slate-50 ring-1 ring-line">
          <summary className="cursor-pointer p-3 text-sm font-bold">{t('salesSync.changes', { n: changes.length })}</summary>
          <ul className="flex flex-col gap-1 p-3 pt-0 text-sm">
            {changes.map((c) => (
              <li key={`${c.date}${c.store}${c.shift}`} className="flex flex-wrap items-center gap-x-2">
                <span className={cx('rounded px-1.5 py-0.5 text-xs font-bold', c.kind === 'added' ? 'bg-green-100 text-green-900' : 'bg-amber-100 text-amber-900')}>
                  {t(`salesSync.kind.${c.kind}`)}
                </span>
                {formatShortDate(c.date)} {t(`salesSync.store.${c.store}`)} {t(`common:shift.${c.shift}`)}
                <b className="tabular-nums">
                  {c.kind === 'changed' && (
                    <>
                      <s className="font-normal text-muted">{c.before}</s> →{' '}
                    </>
                  )}
                  {c.after}
                </b>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  )
}
