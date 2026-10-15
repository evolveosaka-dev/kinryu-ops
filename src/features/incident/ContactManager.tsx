import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, ErrorBox } from '../../components/ui'
import { CONTACT_ICON, CONTACT_METHODS, type ContactLog, type ContactMethod, type ContactResult, type EmergencyContact } from '../../domain/incident'
import { useEmergencyContacts } from './data'
import { formatTokyoTime } from '../../domain/time'
import { cx } from '../../lib/cx'
import { errorMessage } from '../../lib/format'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'

/** 電話 answered without a tap on the call button. */
type ContactLogDraft = { contact: EmergencyContact }

const RESULTS: Record<'phone' | 'line', ContactResult[]> = { phone: ['reached', 'no_answer'], line: ['sent', 'not_sent'] }

/**
 * 管理者への連絡: 電話 / LINE / 連絡しない. A tap on a contact is logged first (log_emergency_contact), then the
 * phone app (tel:) or LINE (share with the report text) opens; back in the app the writer answers
 * つながった / つながらなかった (送った / 送れなかった). The log rows are linked to the report when it is sent.
 */
export function ContactManager({
  method,
  onMethod,
  logs,
  onLogs,
  lineText,
}: {
  method: ContactMethod | null
  onMethod: (m: ContactMethod) => void
  logs: ContactLog[]
  onLogs: (logs: ContactLog[]) => void
  lineText: string
}) {
  const { t } = useTranslation()
  const contacts = useEmergencyContacts()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const go = async (c: EmergencyContact, how: 'phone' | 'line') => {
    setError(null)
    setBusy(true)
    try {
      const id = unwrap<string>(await supabase.rpc('log_emergency_contact', { p_contact: c.id, p_method: how }))
      onLogs([{ id, contact_name: c.name, method: how, user_name: '', at: new Date().toISOString(), result: null, incident_id: null }, ...logs])
      window.location.assign(how === 'phone' ? `tel:${c.phone!.replace(/[^0-9+]/g, '')}` : `https://line.me/R/share?text=${encodeURIComponent(lineText)}`)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const answer = async (l: ContactLog | ContactLogDraft, result: ContactResult) => {
    setError(null)
    try {
      // a call made outside the app (no tap logged): the answer is logged against the first contact
      const id = 'id' in l ? l.id : unwrap<string>(await supabase.rpc('log_emergency_contact', { p_contact: l.contact.id, p_method: 'phone' }))
      unwrap(await supabase.rpc('set_emergency_contact_result', { p_id: id, p_result: result }))
      onLogs(
        'id' in l
          ? logs.map((x) => (x.id === l.id ? { ...x, result } : x))
          : [{ id, contact_name: l.contact.name, method: 'phone', user_name: '', at: new Date().toISOString(), result, incident_id: null }, ...logs],
      )
      void queryClient.invalidateQueries({ queryKey: ['emergency_contact_log'] })
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const list = (contacts.data ?? []).filter((c) => (method === 'phone' ? c.phone : c.line_ok))
  // 電話: 「管理者と電話がつながりましたか？」 is asked as soon as 電話 is chosen, until it is answered
  const phoneOpen = logs.find((l) => l.method === 'phone' && !l.result)
  const phoneAnswered = logs.some((l) => l.method === 'phone' && l.result === 'reached')
  const phoneAsk: ContactLog | ContactLogDraft | null =
    method === 'phone' && !phoneAnswered ? (phoneOpen ?? (list[0] ? { contact: list[0] } : null)) : null
  const lineOpen = method === 'line' ? logs.find((l) => l.method === 'line' && !l.result) : undefined
  return (
    <fieldset className="flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50/60 p-3">
      <legend className="px-1 text-[15px] font-bold">📣 {t('incident.contact.title')} *</legend>
      <p className="text-sm text-slate-700">{t('incident.contact.hint')}</p>
      <div className="grid grid-cols-[1fr_1fr_1.5fr] gap-2">
        {CONTACT_METHODS.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={method === m}
            onClick={() => onMethod(m)}
            className={cx(
              'flex min-h-12 items-center justify-center gap-1 rounded-xl border-[1.5px] px-1.5 text-sm leading-tight font-bold',
              method === m ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink',
            )}
          >
            <span aria-hidden>{CONTACT_ICON[m]}</span>
            <span>{t(`incident.contact.method.${m}`)}</span>
          </button>
        ))}
      </div>
      {(method === 'phone' || method === 'line') && (
        <div className="flex flex-col gap-2">
          {contacts.isSuccess && list.length === 0 && <p className="text-sm font-bold text-red-800">{t('incident.contact.noContact')}</p>}
          {list.map((c) => (
            <Button key={c.id} variant={method === 'phone' ? 'primary' : 'secondary'} disabled={busy} onClick={() => void go(c, method)}>
              {method === 'phone' ? t('incident.contact.call', { name: c.name }) : t('incident.contact.line', { name: c.name })}
            </Button>
          ))}
          {method === 'line' && list.length > 0 && <p className="text-xs text-muted">{t('incident.contact.lineHint', { name: list.map((c) => c.name).join('・') })}</p>}
        </div>
      )}
      {(phoneAsk ?? lineOpen) && (
        <div role="alert" className="flex flex-col gap-2 rounded-xl border border-brand bg-white p-3">
          <p className="font-bold">{phoneAsk ? t('incident.contact.askPhone') : t('incident.contact.askLine', { name: lineOpen!.contact_name })}</p>
          <div className="grid grid-cols-2 gap-2">
            {RESULTS[phoneAsk ? 'phone' : 'line'].map((r) => (
              <Button key={r} variant={r === 'reached' || r === 'sent' ? 'primary' : 'secondary'} onClick={() => void answer((phoneAsk ?? lineOpen)!, r)}>
                {t(`incident.contact.result.${r}`)}
              </Button>
            ))}
          </div>
        </div>
      )}
      {logs.some((l) => l.result) && (
        <ul className="flex flex-col gap-1 text-sm">
          {logs
            .filter((l) => l.result)
            .map((l) => (
              <li key={l.id}>
                {CONTACT_ICON[l.method]} {formatTokyoTime(new Date(l.at))} {l.contact_name} — <b>{t(`incident.contact.result.${l.result}`)}</b>
              </li>
            ))}
        </ul>
      )}
      {error && <ErrorBox message={error} />}
    </fieldset>
  )
}
