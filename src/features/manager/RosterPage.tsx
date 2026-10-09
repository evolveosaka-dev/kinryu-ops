import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../components/Toast'
import { Button, Card, ErrorBox, Spinner, TextInput, PageTitle } from '../../components/ui'
import { currentLocale } from '../../i18n'
import { errorMessage, storeName } from '../../lib/format'
import { unwrap, useStores } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import type { RosterEntry } from '../../lib/types'
import { ManagerTabs } from './ManagerTabs'

const selectClass = 'min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-sm'

/** Managers keep the staff roster (names offered in the 朝礼 / 巡回 pickers) up to date. */
export function RosterPage() {
  const { t } = useTranslation('manager')
  const toast = useToast()
  const queryClient = useQueryClient()
  const stores = useStores()
  const [name, setName] = useState('')
  const [store, setStore] = useState('')

  const roster = useQuery({
    queryKey: ['staff_roster', 'all'],
    queryFn: async () => unwrap<RosterEntry[]>(await supabase.from('staff_roster').select('*').order('name')),
  })

  const done = () => {
    toast(t('users.saved'))
    void queryClient.invalidateQueries({ queryKey: ['staff_roster'] })
  }
  const add = useMutation({
    mutationFn: async () =>
      unwrap(await supabase.from('staff_roster').insert({ name: name.trim(), home_store_id: store || null })),
    onSuccess: () => {
      setName('')
      done()
    },
  })
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<RosterEntry> }) =>
      unwrap(await supabase.from('staff_roster').update(patch).eq('id', id)),
    onSuccess: done,
  })

  const list = roster.data ?? []
  const active = list.filter((r) => r.active)
  const inactive = list.filter((r) => !r.active)

  const Row = ({ r }: { r: RosterEntry }) => (
    <li className="flex items-center gap-2 py-1">
      <span className={`flex-1 font-bold ${r.active ? '' : 'text-slate-400 line-through'}`}>{r.name}</span>
      <select
        className={selectClass}
        value={r.home_store_id ?? ''}
        aria-label={`${r.name} ${t('users.homeStore')}`}
        onChange={(e) => update.mutate({ id: r.id, patch: { home_store_id: e.target.value || null } })}
      >
        <option value="">{t('users.noStore')}</option>
        {stores.data?.map((s) => (
          <option key={s.id} value={s.id}>
            {storeName(s, currentLocale())}
          </option>
        ))}
      </select>
      <Button variant="secondary" className="min-h-10 px-3 text-sm" onClick={() => update.mutate({ id: r.id, patch: { active: !r.active } })}>
        {r.active ? t('roster.deactivate') : t('roster.activate')}
      </Button>
    </li>
  )

  return (
    <div className="flex flex-col gap-4">
      <ManagerTabs />
      <PageTitle title={t('roster.title')} />
      <p className="text-sm text-slate-600">{t('roster.body')}</p>

      <Card className="flex flex-col gap-2">
        <TextInput label={t('roster.name')} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        <select className={selectClass} value={store} onChange={(e) => setStore(e.target.value)} aria-label={t('users.homeStore')}>
          <option value="">{t('users.noStore')}</option>
          {stores.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {storeName(s, currentLocale())}
            </option>
          ))}
        </select>
        <Button onClick={() => add.mutate()} disabled={!name.trim() || add.isPending}>
          ＋ {t('roster.add')}
        </Button>
        {add.error && <ErrorBox message={errorMessage(add.error)} />}
      </Card>

      {roster.isLoading ? (
        <Spinner />
      ) : (
        <Card>
          <h2 className="mb-1 font-bold text-slate-700">
            {t('users.active')}（{active.length}）
          </h2>
          <ul className="divide-y divide-slate-100">
            {active.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </ul>
          {inactive.length > 0 && (
            <>
              <h2 className="mt-4 mb-1 font-bold text-slate-500">
                {t('users.inactive')}（{inactive.length}）
              </h2>
              <ul className="divide-y divide-slate-100">
                {inactive.map((r) => (
                  <Row key={r.id} r={r} />
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
      {update.error && <ErrorBox message={errorMessage(update.error)} />}
    </div>
  )
}
