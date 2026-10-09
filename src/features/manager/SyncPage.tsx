import { FunctionsHttpError } from '@supabase/supabase-js'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Button, Card, ErrorBox, Spinner, PageTitle } from '../../components/ui'
import { errorMessage } from '../../lib/format'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { ManagerTabs } from './ManagerTabs'

interface SyncResult {
  url: string | null
  syncedAt: string
  rows: Record<string, number>
}

const jst = (iso: string) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 16)

export function SyncPage() {
  const { t } = useTranslation('manager')
  const queryClient = useQueryClient()
  const kv = useQuery({
    queryKey: ['app_kv'],
    queryFn: async () => {
      const rows = unwrap<{ key: string; value: string }[]>(await supabase.from('app_kv').select('key, value'))
      return Object.fromEntries(rows.map((r) => [r.key, r.value])) as { sheets_url?: string; sheets_synced_at?: string }
    },
  })

  const sync = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<SyncResult>('sync-sheets', { body: {} })
      if (error) {
        const detail = error instanceof FunctionsHttpError ? ((await (error.context as Response).json().catch(() => ({}))) as { error?: string }).error : null
        throw new Error(detail ?? error.message)
      }
      return data!
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['app_kv'] }),
  })

  const url = sync.data?.url ?? kv.data?.sheets_url
  const syncedAt = sync.data?.syncedAt ?? kv.data?.sheets_synced_at

  return (
    <div className="flex flex-col gap-4">
      <ManagerTabs />
      <PageTitle title={t('sync.title')} />
      {kv.isLoading ? (
        <Spinner />
      ) : (
        <Card className="flex flex-col gap-3">
          <p className="text-sm">{syncedAt ? t('sync.last', { time: jst(syncedAt) }) : t('sync.never')}</p>
          <p className="text-xs text-slate-600">{t('sync.daily')}</p>
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="flex min-h-11 items-center justify-center rounded-xl bg-green-700 font-bold text-white">
              {t('sync.open')} ↗
            </a>
          )}
          <Button variant="secondary" onClick={() => sync.mutate()} disabled={sync.isPending}>
            {sync.isPending ? t('sync.running') : t('sync.run')}
          </Button>
          {sync.data && (
            <p className="rounded-xl bg-green-50 p-3 text-sm font-bold text-green-800">
              ✓ {t('sync.done', { c: sync.data.rows['朝礼記録'] ?? 0, p: sync.data.rows['巡回チェック'] ?? 0, a: sync.data.rows['添付ファイル'] ?? 0 })}
            </p>
          )}
          {sync.error && <ErrorBox message={`${t('sync.failed')}: ${errorMessage(sync.error)}`} />}
        </Card>
      )}
    </div>
  )
}
