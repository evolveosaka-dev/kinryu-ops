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
  // the newest attempt without an answer: asked when the writer is back in the app
  const open = logs.find((l) => !l.result)

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
  const answer = async (l: ContactLog, result: ContactResult) => {
    setError(null)
    try {
      unwrap(await supabase.rpc('set_emergency_contact_result', { p_id: l.id, p_result: result }))
      onLogs(logs.map((x) => (x.id === l.id ? { ...x, result } : x)))
      void queryClient.invalidateQueries({ queryKey: ['emergency_contact_log'] })
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const list = (contacts.data ?? []).filter((c) => (method === 'phone' ? c.phone : c.line_ok))
  return (
    <fieldset className="flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50/60 p-3">
      <legend className="px-1 text-[15px] font-bold">📣 {t('incident.contact.title')} *</legend>
      <p className="text-sm text-slate-700">{t('incident.contact.hint')}</p>
      <div className="flex flex-wrap gap-2">
        {CONTACT_METHODS.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={method === m}
            onClick={() => onMethod(m)}
            className={cx(
              'min-h-11 whitespace-nowrap rounded-xl border-[1.5px] px-3 font-bold',
              method === m ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink',
            )}
          >
            {CONTACT_ICON[m]} {t(`incident.contact.method.${m}`)}
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
      {open && (
        <div role="alert" className="flex flex-col gap-2 rounded-xl border border-brand bg-white p-3">
          <p className="font-bold">
            {open.method === 'phone' ? t('incident.contact.askPhone', { name: open.contact_name }) : t('incident.contact.askLine', { name: open.contact_name })}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {RESULTS[open.method].map((r) => (
              <Button key={r} variant={r === 'reached' || r === 'sent' ? 'primary' : 'secondary'} onClick={() => void answer(open, r)}>
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
