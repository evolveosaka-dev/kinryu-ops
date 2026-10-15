import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../components/Toast'
import { Button, Card, Checkbox, ErrorBox, PageTitle, SectionTitle, Spinner, TextInput } from '../../components/ui'
import { CONTACT_ICON, type ContactLog, type EmergencyContact } from '../../domain/incident'
import { errorMessage } from '../../lib/format'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { useEmergencyContacts } from '../incident/data'
import { jstDateTime } from './data'
import { ManagerTabs } from './ManagerTabs'

type Draft = Pick<EmergencyContact, 'name' | 'phone' | 'line_ok' | 'note' | 'sort_order' | 'active'> & { id?: string }

const blank = (order: number): Draft => ({ name: '', phone: '', line_ok: true, note: '', sort_order: order, active: true })

function ContactRow({ c, onDone }: { c: Draft; onDone: () => void }) {
  const { t } = useTranslation('manager')
  const toast = useToast()
  const queryClient = useQueryClient()
  const [d, setD] = useState<Draft>(c)
  const save = useMutation({
    mutationFn: async () => {
      const row = { name: d.name.trim(), phone: d.phone?.trim() || null, line_ok: d.line_ok, note: d.note?.trim() || null, sort_order: d.sort_order, active: d.active }
      unwrap(d.id ? await supabase.from('emergency_contacts').update(row).eq('id', d.id) : await supabase.from('emergency_contacts').insert(row))
    },
    onSuccess: () => {
      toast(t('emergency.saved'))
      void queryClient.invalidateQueries({ queryKey: ['emergency_contacts'] })
      onDone()
    },
  })
  const remove = useMutation({
    mutationFn: async () => unwrap(await supabase.from('emergency_contacts').delete().eq('id', d.id!)),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['emergency_contacts'] }),
  })
  return (
    <Card className="flex flex-col gap-2">
      <div className="grid grid-cols-[2fr_1fr] gap-2">
        <TextInput label={t('emergency.name')} value={d.name} maxLength={50} onChange={(e) => setD({ ...d, name: e.target.value })} />
        <TextInput label={t('emergency.order')} inputMode="numeric" value={String(d.sort_order)} onChange={(e) => setD({ ...d, sort_order: Number(e.target.value) || 0 })} />
      </div>
      <TextInput label={t('emergency.phone')} type="tel" inputMode="tel" value={d.phone ?? ''} placeholder="090-1234-5678" onChange={(e) => setD({ ...d, phone: e.target.value })} />
      <TextInput label={t('emergency.note')} value={d.note ?? ''} maxLength={200} onChange={(e) => setD({ ...d, note: e.target.value })} />
      <Checkbox checked={d.line_ok} onChange={(v) => setD({ ...d, line_ok: v })}>
        💬 {t('emergency.lineOk')}
      </Checkbox>
      <Checkbox checked={d.active} onChange={(v) => setD({ ...d, active: v })}>
        {t('emergency.active')}
      </Checkbox>
      {(save.error || remove.error) && <ErrorBox message={errorMessage(save.error ?? remove.error)} />}
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => save.mutate()} disabled={!d.name.trim() || save.isPending}>
          {t('emergency.save')}
        </Button>
        {d.id && (
          <Button variant="secondary" onClick={() => window.confirm(t('emergency.deleteConfirm', { name: d.name })) && remove.mutate()} disabled={remove.isPending}>
            {t('emergency.delete')}
          </Button>
        )}
      </div>
    </Card>
  )
}

type LogRow = ContactLog & { incidents: { kind: string; business_date: string } | null }

/** 設定 → 緊急連絡先: who staff call / LINE from クレーム・事故の記録, and the history of those contacts. */
export function EmergencyContactsPage() {
  const { t } = useTranslation('manager')
  const tc = useTranslation().t
  const contacts = useEmergencyContacts(true)
  const [adding, setAdding] = useState(false)
  const log = useQuery({
    queryKey: ['emergency_contact_log'],
    queryFn: async () =>
      unwrap<LogRow[]>(
        await supabase.from('emergency_contact_log').select('*, incidents(kind, business_date)').order('at', { ascending: false }).limit(100),
      ),
  })
  if (contacts.isLoading) return <Spinner />
  const list = contacts.data ?? []
  return (
    <div className="flex flex-col gap-3">
      <ManagerTabs />
      <PageTitle title={t('emergency.title')} subtitle={t('emergency.subtitle')} />
      {list.map((c) => (
        <ContactRow key={c.id} c={c} onDone={() => undefined} />
      ))}
      {list.length === 0 && !adding && <p className="text-sm text-muted">{t('emergency.none')}</p>}
      {adding ? (
        <ContactRow c={blank((list.at(-1)?.sort_order ?? 0) + 1)} onDone={() => setAdding(false)} />
      ) : (
        <Button variant="secondary" onClick={() => setAdding(true)}>
          ＋ {t('emergency.add')}
        </Button>
      )}

      <SectionTitle>{t('emergency.history')}</SectionTitle>
      <p className="text-xs text-muted">{t('emergency.historyHint')}</p>
      {log.isLoading ? (
        <Spinner />
      ) : (log.data ?? []).length === 0 ? (
        <p className="text-sm text-muted">{t('emergency.historyNone')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-white text-sm">
          {log.data!.map((l) => (
            <li key={l.id} className="flex flex-col px-3 py-2">
              <span>
                {CONTACT_ICON[l.method]} <b>{jstDateTime(l.at)}</b> {l.user_name} → {l.contact_name}
              </span>
              <span className="text-muted">
                {l.result ? tc(`incident.contact.result.${l.result}`) : t('emergency.noAnswer')}
                {l.incidents ? ` ・ ${tc(`incident.kinds.${l.incidents.kind}`)}（${l.incidents.business_date.slice(5).replace('-', '/')}）` : ` ・ ${t('emergency.noReport')}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
