import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMe } from '../../app/auth'
import { useToast } from '../../components/Toast'
import { Button, Card, Checkbox, ErrorBox, Spinner } from '../../components/ui'
import type { ProfileStatus, Role } from '../../domain/types'
import { currentLocale } from '../../i18n'
import { errorMessage, storeName } from '../../lib/format'
import { unwrap, useStores } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import type { Profile } from '../../lib/types'
import { ManagerTabs } from './ManagerTabs'

type Patch = Partial<Pick<Profile, 'role' | 'can_patrol' | 'status' | 'home_store_id'>>

const ROLES: Role[] = ['staff', 'manager', 'admin']
const STATUSES: ProfileStatus[] = ['pending', 'active', 'inactive']
const selectClass = 'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm'

function UserRow({ user, onSave, isSelf }: { user: Profile; onSave: (p: Patch) => void; isSelf: boolean }) {
  const { t } = useTranslation('manager')
  const stores = useStores()
  const [draft, setDraft] = useState<Patch>({})
  const v = { ...user, ...draft }
  const dirty = Object.keys(draft).length > 0

  return (
    <Card className="flex flex-col gap-2">
      <div>
        <p className="font-bold">{user.display_name || '（名前なし）'}</p>
        <p className="text-xs text-slate-500">{user.email}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs font-bold text-slate-600">
          {t('users.status')}
          <select className={selectClass} value={v.status} disabled={isSelf} onChange={(e) => setDraft({ ...draft, status: e.target.value as ProfileStatus })}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`users.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-600">
          {t('users.homeStore')}
          <select className={selectClass} value={v.home_store_id ?? ''} onChange={(e) => setDraft({ ...draft, home_store_id: e.target.value || null })}>
            <option value="">{t('users.noStore')}</option>
            {stores.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {storeName(s, currentLocale())}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-600">
          {t('users.role.staff')} / {t('users.role.manager')}
          <select className={selectClass} value={v.role} disabled={isSelf} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`users.role.${r}`)}
              </option>
            ))}
          </select>
        </label>
        <Checkbox checked={v.can_patrol} onChange={(can_patrol) => setDraft({ ...draft, can_patrol })}>
          {t('users.canPatrol')}
        </Checkbox>
      </div>
      <div className="flex gap-2">
        {user.status === 'pending' && !dirty && (
          <Button className="flex-1" onClick={() => onSave({ status: 'active' })} disabled={!user.home_store_id}>
            ✓ {t('users.approve')}
          </Button>
        )}
        {dirty && (
          <Button
            className="flex-1"
            onClick={() => {
              onSave(draft)
              setDraft({})
            }}
          >
            {t('common:action.save')}
          </Button>
        )}
      </div>
    </Card>
  )
}

export function UsersPage() {
  const { t } = useTranslation('manager')
  const me = useMe()
  const toast = useToast()
  const queryClient = useQueryClient()
  const users = useQuery({
    queryKey: ['profiles'],
    queryFn: async () => unwrap<Profile[]>(await supabase.from('profiles').select('*').order('created_at', { ascending: false })),
  })
  const save = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Patch }) => unwrap(await supabase.from('profiles').update(patch).eq('id', id)),
    onSuccess: () => {
      toast(t('users.saved'))
      void queryClient.invalidateQueries({ queryKey: ['profiles'] })
      void queryClient.invalidateQueries({ queryKey: ['staff_directory'] })
      // the edited user may be me (e.g. a manager giving themselves patrol rights)
      void queryClient.invalidateQueries({ queryKey: ['profile'] })
    },
  })

  if (users.isLoading) return <Spinner />
  if (users.error) return <ErrorBox message={errorMessage(users.error)} />

  const groups = STATUSES.map((s) => ({ status: s, list: (users.data ?? []).filter((u) => u.status === s) }))

  return (
    <div className="flex flex-col gap-4">
      <ManagerTabs />
      <h1 className="text-xl font-bold">🛠️ {t('users.title')}</h1>
      {save.error && <ErrorBox message={errorMessage(save.error)} />}
      {groups.map(
        (g) =>
          g.list.length > 0 && (
            <section key={g.status} className="flex flex-col gap-2">
              <h2 className="font-bold text-slate-700">
                {t(`users.${g.status}`)}（{g.list.length}）
              </h2>
              {g.list.map((u) => (
                <UserRow key={u.id} user={u} isSelf={u.id === me.id} onSave={(patch) => save.mutate({ id: u.id, patch })} />
              ))}
            </section>
          ),
      )}
    </div>
  )
}
