import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMe } from '../../app/auth'
import { useToast } from '../../components/Toast'
import { Button, Card, Checkbox, ErrorBox, Spinner, PageTitle } from '../../components/ui'
import type { ProfileStatus, Role } from '../../domain/types'
import { errorMessage } from '../../lib/format'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import type { Profile } from '../../lib/types'
import { formatShortDate } from '../../domain/time'
import { VISA_LIMIT_MIN, visaRuns, type Visa } from '../../domain/shiftChange'
import { cx } from '../../lib/cx'
import { useStaffLimits, useVisaWindows } from '../shift/changeData'
import { ManagerTabs } from './ManagerTabs'

type Patch = Partial<Pick<Profile, 'role' | 'can_patrol' | 'status' | 'full_name' | 'roster_name'>>

const ROLES: Role[] = ['staff', 'manager', 'admin']
const STATUSES: ProfileStatus[] = ['pending', 'active', 'inactive', 'rejected']
const selectClass = 'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm'

type Run = ReturnType<typeof visaRuns>[number]

/** 留学 / 家族滞在: 28 hours in any 7 days in a row; checked → automatic alerts (mail + ダッシュボード). */
function VisaBox({ rosterName, visa, runs }: { rosterName: string | null; visa: Visa | null; runs: Run[] }) {
  const { t } = useTranslation('manager')
  const queryClient = useQueryClient()
  const save = useMutation({
    mutationFn: async (v: Visa | null) =>
      unwrap(await supabase.from('staff_limits').upsert({ roster_name: rosterName!, visa: v }, { onConflict: 'roster_name' })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'staff_limits'] })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'visa_windows'] })
    },
  })
  const h = (m: number) => Math.round((m / 60) * 10) / 10
  return (
    <div className={cx('flex flex-col gap-1 rounded-lg p-2', visa ? 'bg-violet-50' : 'bg-slate-50')}>
      <label className="flex min-h-10 items-center gap-2 text-sm font-bold">
        <input
          type="checkbox"
          className="size-5 accent-brand"
          disabled={!rosterName || save.isPending}
          checked={Boolean(visa)}
          onChange={(e) => save.mutate(e.target.checked ? 'student' : null)}
        />
        🎓 {t('users.visa.label')}
      </label>
      {!rosterName && <p className="text-xs text-slate-600">{t('users.visa.needRoster')}</p>}
      {visa && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {(['student', 'dependent'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={visa === v}
                onClick={() => save.mutate(v)}
                className={cx('min-h-10 rounded-lg border-[1.5px] text-sm font-bold', visa === v ? 'border-brand bg-brand text-white' : 'border-line bg-white')}
              >
                {t(`users.visa.${v}`)}
              </button>
            ))}
          </div>
          {runs.length === 0 ? (
            <p className="text-xs font-bold text-green-800">✓ {t('users.visa.ok', { h: VISA_LIMIT_MIN / 60 })}</p>
          ) : (
            runs.map((r) => (
              <p key={r.from} className="text-xs font-bold text-red-700">
                ⚠ {t('users.visa.over', { from: formatShortDate(r.from), to: formatShortDate(r.to), h: h(r.maxMin) })}
              </p>
            ))
          )}
        </>
      )}
      {save.error && <ErrorBox message={errorMessage(save.error)} />}
    </div>
  )
}

function UserRow({ user, onSave, isSelf, rosterNames, takenNames, visa, runs }: {
  user: Profile
  onSave: (p: Patch) => void
  isSelf: boolean
  rosterNames: string[]
  takenNames: Set<string>
  visa: Visa | null
  runs: Run[]
}) {
  const { t } = useTranslation('manager')
  const [draft, setDraft] = useState<Patch>({})
  const [rejecting, setRejecting] = useState(false)
  const v = { ...user, ...draft }
  const dirty = Object.keys(draft).length > 0

  return (
    <Card className="flex flex-col gap-2">
      <div>
        <p className="font-bold">{user.display_name || '（名前なし）'}</p>
        <p className="text-xs text-slate-600">{user.email}</p>
      </div>
      <label className="text-xs font-bold text-slate-600">
        {t('users.fullName')}
        <input
          className={selectClass}
          value={v.full_name ?? ''}
          placeholder={t('users.noFullName')}
          maxLength={100}
          onChange={(e) => setDraft({ ...draft, full_name: e.target.value })}
        />
      </label>
      <label className="text-xs font-bold text-slate-600">
        {t('users.rosterName')}
        <select className={selectClass} value={v.roster_name ?? ''} onChange={(e) => setDraft({ ...draft, roster_name: e.target.value || null })}>
          <option value="">{t('users.noRoster')}</option>
          {rosterNames.map((n) => (
            <option key={n} value={n} disabled={takenNames.has(n) && n !== user.roster_name}>
              {n}
              {takenNames.has(n) && n !== user.roster_name ? ' ✓' : ''}
            </option>
          ))}
        </select>
      </label>
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
      <VisaBox rosterName={user.roster_name} visa={visa} runs={runs} />
      {rejecting && (
        <div className="flex flex-col gap-2 rounded-lg bg-red-50 p-2">
          <p className="text-sm">{t('users.rejectConfirm')}</p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setRejecting(false)}>
              {t('common:action.cancel')}
            </Button>
            <Button variant="danger" className="flex-1" onClick={() => onSave({ status: 'rejected' })}>
              {t('users.rejectYes')}
            </Button>
          </div>
        </div>
      )}
      <div className="flex gap-2">
        {user.status === 'pending' && !dirty && !rejecting && (
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setRejecting(true)}>
              ✕ {t('users.reject')}
            </Button>
            <Button className="flex-1" onClick={() => onSave({ status: 'active' })}>
              ✓ {t('users.approve')}
            </Button>
          </>
        )}
        {dirty && (
          <Button
            className="flex-1"
            disabled={draft.full_name !== undefined && (draft.full_name ?? '').trim().length < 2}
            onClick={() => {
              onSave(draft.full_name !== undefined ? { ...draft, full_name: (draft.full_name ?? '').trim() } : draft)
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
  const roster = useQuery({
    queryKey: ['staff_roster', 'all-names-sorted'],
    queryFn: async () => unwrap<{ name: string }[]>(await supabase.from('staff_roster').select('name').order('name')).map((r) => r.name),
  })
  const limits = useStaffLimits()
  const windows = useVisaWindows()
  const save = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Patch }) => unwrap(await supabase.from('profiles').update(patch).eq('id', id)),
    onSuccess: () => {
      toast(t('users.saved'))
      void queryClient.invalidateQueries({ queryKey: ['profiles'] })
      void queryClient.invalidateQueries({ queryKey: ['staff_directory'] })
      // the edited user may be me (e.g. a manager giving themselves patrol rights)
      void queryClient.invalidateQueries({ queryKey: ['profile'] })
      void queryClient.invalidateQueries({ queryKey: ['shift_assignments'] })
    },
  })

  if (users.isLoading) return <Spinner />
  if (users.error) return <ErrorBox message={errorMessage(users.error)} />

  const takenNames = new Set((users.data ?? []).flatMap((u) => (u.roster_name ? [u.roster_name] : [])))
  const visaOf = new Map((limits.data ?? []).map((l) => [l.roster_name, l.visa]))
  const runs = visaRuns(windows.data ?? [])
  const groups = STATUSES.map((s) => ({ status: s, list: (users.data ?? []).filter((u) => u.status === s) }))

  return (
    <div className="flex flex-col gap-4">
      <ManagerTabs />
      <PageTitle title={t('users.title')} />
      {save.error && <ErrorBox message={errorMessage(save.error)} />}
      {groups.map(
        (g) =>
          g.list.length > 0 && (
            <section key={g.status} className="flex flex-col gap-2">
              <h2 className="font-bold text-slate-700">
                {t(`users.${g.status}`)}（{g.list.length}）
              </h2>
              {g.list.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  isSelf={u.id === me.id}
                  rosterNames={roster.data ?? []}
                  takenNames={takenNames}
                  visa={(u.roster_name && visaOf.get(u.roster_name)) || null}
                  runs={runs.filter((r) => r.name === u.roster_name)}
                  onSave={(patch) => save.mutate({ id: u.id, patch })}
                />
              ))}
            </section>
          ),
      )}
    </div>
  )
}
