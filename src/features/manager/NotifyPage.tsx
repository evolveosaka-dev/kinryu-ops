import { FunctionsHttpError } from '@supabase/supabase-js'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../components/Toast'
import { Button, Card, Checkbox, ErrorBox, Spinner, TextInput, PageTitle } from '../../components/ui'
import { STAFF_ISSUES_ENABLED } from '../../domain/issues'
import { errorMessage } from '../../lib/format'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { jstDateTime } from './data'
import { ManagerTabs } from './ManagerTabs'

const NOTIFY_KINDS = ['chorei', 'chorei_note', 'patrol', 'shift_request', 'signup', 'edit', 'staff_alert', 'stock', 'sales', 'shift_change', 'visa_hours', 'incident', 'report'] as const
const SHOWN_KINDS = NOTIFY_KINDS.filter((k) => STAFF_ISSUES_ENABLED || k !== 'staff_alert')
type Kind = (typeof NOTIFY_KINDS)[number]
type Mode = 'instant' | 'digest'

interface Recipient {
  id: string
  email: string
  name: string
  mode: Mode
  kinds: Kind[]
  active: boolean
}
interface NotifyEvent {
  id: number
  kind: Kind
  urgent: boolean
  created_at: string
  instant_done_at: string | null
  attempts: number
  last_error: string | null
}

const selectClass = 'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm'
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function RecipientCard({ r, onSave, onDelete, onTest, testing }: { r: Recipient; onSave: (patch: Partial<Recipient>) => void; onDelete: () => void; onTest: () => void; testing: boolean }) {
  const { t } = useTranslation('manager')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const toggleKind = (k: Kind, on: boolean) => onSave({ kinds: on ? [...r.kinds, k] : r.kinds.filter((x) => x !== k) })

  return (
    <Card className={`flex flex-col gap-2 ${r.active ? '' : 'opacity-70'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold">{r.name || r.email}</p>
          <p className="break-all text-xs text-slate-600">{r.email}</p>
        </div>
        <Checkbox checked={r.active} onChange={(active) => onSave({ active })}>
          {t('notify.active')}
        </Checkbox>
      </div>
      <label className="text-xs font-bold text-slate-600">
        {t('notify.mode')}
        <select className={selectClass} value={r.mode} onChange={(e) => onSave({ mode: e.target.value as Mode })}>
          <option value="instant">{t('notify.modeInstant')}</option>
          <option value="digest">{t('notify.modeDigest')}</option>
        </select>
      </label>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-xs font-bold text-slate-600">{t('notify.kinds')}</legend>
        <div className="grid grid-cols-2 gap-1">
          {SHOWN_KINDS.map((k) => (
            <Checkbox key={k} checked={r.kinds.includes(k)} onChange={(on) => toggleKind(k, on)}>
              {t(`notify.kind.${k}`)}
            </Checkbox>
          ))}
        </div>
      </fieldset>
      {confirmDelete ? (
        <div className="flex flex-col gap-2 rounded-lg bg-red-50 p-2">
          <p className="text-sm">{t('notify.deleteConfirm')}</p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setConfirmDelete(false)}>
              {t('common:action.cancel')}
            </Button>
            <Button variant="danger" className="flex-1" onClick={onDelete}>
              {t('notify.delete')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmDelete(true)}>
            {t('notify.delete')}
          </Button>
          <Button variant="secondary" className="flex-1" onClick={onTest} disabled={testing || !r.active}>
            ✉ {t('notify.test')}
          </Button>
        </div>
      )}
    </Card>
  )
}

/** 設定 → 通知メール: who gets an e-mail for each report, instantly or as a daily digest. */
export function NotifyPage() {
  const { t } = useTranslation('manager')
  const toast = useToast()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [mode, setMode] = useState<Mode>('instant')

  const recipients = useQuery({
    queryKey: ['admin', 'notify_recipients'],
    queryFn: async () => unwrap<Recipient[]>(await supabase.from('notify_recipients').select('*').order('created_at')),
  })
  const history = useQuery({
    queryKey: ['admin', 'notify_events'],
    queryFn: async () =>
      unwrap<NotifyEvent[]>(
        await supabase.from('notify_events').select('id, kind, urgent, created_at, instant_done_at, attempts, last_error').order('id', { ascending: false }).limit(30),
      ),
  })
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin', 'notify_recipients'] })

  const normalized = email.trim().toLowerCase()
  const add = useMutation({
    mutationFn: async () => unwrap(await supabase.from('notify_recipients').insert({ email: normalized, name: name.trim(), mode })),
    onSuccess: () => {
      setEmail('')
      setName('')
      toast(t('users.saved'))
      refresh()
    },
  })
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Recipient> }) => unwrap(await supabase.from('notify_recipients').update(patch).eq('id', id)),
    onSuccess: () => {
      toast(t('users.saved'))
      refresh()
    },
  })
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('notify_recipients').delete().eq('id', id)),
    onSuccess: refresh,
  })
  const test = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.functions.invoke('send-notifications', { body: { action: 'test', recipient_id: id } })
      if (error) {
        const detail = error instanceof FunctionsHttpError ? ((await (error.context as Response).json().catch(() => ({}))) as { error?: string }).error : null
        throw new Error(detail ?? error.message)
      }
    },
    onSuccess: () => toast(t('notify.testSent')),
  })

  const duplicate = (recipients.data ?? []).some((r) => r.email === normalized)
  const status = (e: NotifyEvent) =>
    e.last_error === 'superseded' ? t('notify.superseded') : e.instant_done_at ? (e.last_error && e.attempts >= 5 ? `⚠ ${t('notify.failed')}` : t('notify.done')) : e.last_error ? `⚠ ${t('notify.retrying')}` : t('notify.waiting')

  return (
    <div className="flex flex-col gap-4">
      <ManagerTabs />
      <PageTitle title={t('notify.title')} />
      <p className="text-sm text-slate-600">{t('notify.body')}</p>

      <Card className="flex flex-col gap-2">
        <h2 className="font-bold">{t('notify.add')}</h2>
        <TextInput label={t('notify.email')} type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} />
        <TextInput label={t('notify.name')} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <label className="text-xs font-bold text-slate-600">
          {t('notify.mode')}
          <select className={selectClass} value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="instant">{t('notify.modeInstant')}</option>
            <option value="digest">{t('notify.modeDigest')}</option>
          </select>
        </label>
        {duplicate && <p className="text-sm text-red-700">{t('notify.duplicate')}</p>}
        <Button onClick={() => add.mutate()} disabled={!EMAIL.test(normalized) || duplicate || add.isPending}>
          ＋ {t('notify.add')}
        </Button>
        {add.error && <ErrorBox message={errorMessage(add.error)} />}
      </Card>

      {recipients.isLoading ? (
        <Spinner />
      ) : recipients.error ? (
        <ErrorBox message={errorMessage(recipients.error)} />
      ) : (recipients.data ?? []).length === 0 ? (
        <Card className="text-sm text-slate-600">{t('notify.empty')}</Card>
      ) : (
        <section className="flex flex-col gap-2">
          <h2 className="font-bold text-slate-700">
            {t('notify.recipients')}（{recipients.data!.length}）
          </h2>
          {recipients.data!.map((r) => (
            <RecipientCard
              key={r.id}
              r={r}
              onSave={(patch) => update.mutate({ id: r.id, patch })}
              onDelete={() => remove.mutate(r.id)}
              onTest={() => test.mutate(r.id)}
              testing={test.isPending}
            />
          ))}
        </section>
      )}
      {(update.error || remove.error || test.error) && <ErrorBox message={errorMessage(update.error ?? remove.error ?? test.error)} />}
      <p className="text-xs text-slate-600">{t('notify.urgentNote')}</p>

      <Card className="flex flex-col gap-1">
        <h2 className="font-bold">{t('notify.history')}</h2>
        {(history.data ?? []).length === 0 ? (
          <p className="text-sm text-slate-600">—</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {history.data!.map((e) => (
              <li key={e.id} className="flex justify-between gap-2 py-1">
                <span>
                  {jstDateTime(e.created_at).slice(5)} {e.urgent && '⚠'} {t(`notify.kind.${e.kind}`)}
                </span>
                <span className="text-slate-600">{status(e)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
