import { useQuery } from '@tanstack/react-query'
import type { EmergencyContact } from '../../domain/incident'
import { currentLocale } from '../../i18n'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'

/** 緊急連絡先 (staff: the active ones; managers with `all`). */
export function useEmergencyContacts(all = false) {
  return useQuery({
    queryKey: ['emergency_contacts', all],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      let q = supabase.from('emergency_contacts').select('*').order('sort_order').order('name')
      if (!all) q = q.eq('active', true)
      return unwrap<EmergencyContact[]>(await q)
    },
  })
}

/** Date and time in the user's language, e.g. 2026年10月15日(木) 14:05 / Thứ Năm, 15/10/2026 14:05. */
export function formatWhen(iso: string, locale = currentLocale()) {
  const at = new Date(iso)
  const date = new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(at)
  const time = new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)
  return `${date} ${time}`
}
