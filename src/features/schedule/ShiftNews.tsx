import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useAuth } from '../../app/auth'
import { Sheet } from '../../components/Sheet'
import { parseCell } from '../../domain/schedule'
import { tokyoParts } from '../../domain/time'
import type { Shift } from '../../domain/types'
import { cx } from '../../lib/cx'
import { unwrap } from '../../lib/queries'
import { readSeen, writeSeen } from '../../lib/seenMark'
import { supabase } from '../../lib/supabase'
import { ShiftChip, StoreLabel, TimeRange } from './parts'
import { useDayLabel } from './style'

// ホーム: 「あなたのシフトが変わりました」 after the shift table was imported again (my_shift_changes, last 7 days).
// One short line; the details open on tap. Shown until opened on this phone.

interface MyChange {
  log_id: number
  imported_at: string
  business_date: string
  shift: Shift
  kind: 'added' | 'removed' | 'changed'
  before: string | null
  after: string | null
}

function Cell({ raw, old }: { raw: string | null; old?: boolean }) {
  const c = raw ? parseCell(raw) : null
  if (!c) return <span>{raw ?? '—'}</span>
  return (
    <span className={cx('inline-flex flex-wrap items-center gap-x-2', old && 'text-muted line-through')}>
      <StoreLabel mark={c.store_mark} />
      <TimeRange a={c} />
    </span>
  )
}

export function ShiftNewsCard() {
  const { t } = useTranslation('shift')
  const { profile } = useAuth()
  const dayLabel = useDayLabel()
  // the changes shown in the sheet (kept while it is open, after they are marked as seen)
  const [shown, setShown] = useState<MyChange[] | null>(null)
  const key = `shift-news:${profile?.id ?? ''}`
  const [seen, setSeen] = useState(() => readSeen(key))
  const q = useQuery({
    queryKey: ['my_shift_changes', profile?.roster_name],
    enabled: Boolean(profile?.roster_name),
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap<MyChange[]>(await supabase.rpc('my_shift_changes', { p_days: 7 })),
  })
  const rows = q.data ?? []
  const fresh = rows.filter((r) => r.log_id > seen)
  if (!profile?.roster_name || (fresh.length === 0 && !shown)) return null
  const today = tokyoParts(new Date()).date
  const show = () => {
    setShown(fresh)
    const top = Math.max(...fresh.map((r) => r.log_id))
    writeSeen(key, top)
    setSeen(top)
  }
  return (
    <>
      {fresh.length > 0 && (
        <button type="button" onClick={show} className="flex items-center gap-3 rounded-2xl border-2 border-sky-400 bg-sky-50 px-4 py-3 text-left font-bold text-sky-950">
          <span aria-hidden className="text-2xl">
            📅
          </span>
          <span className="flex-1">{t('news.card', { n: fresh.length })}</span>
          <span aria-hidden className="text-xl">
            ›
          </span>
        </button>
      )}
      {shown && (
        <Sheet title={`📅 ${t('news.title')}`} onClose={() => setShown(null)}>
          <p className="rounded-xl bg-sky-50 p-3 text-sm font-bold text-sky-900">{t('news.help')}</p>
          <ul className="flex flex-col gap-2">
            {shown.map((r) => (
              <li key={`${r.log_id}${r.business_date}${r.shift}`} className={cx('flex flex-col gap-1 rounded-xl border bg-white p-3', r.business_date < today ? 'border-line' : 'border-sky-300')}>
                <p className="flex flex-wrap items-center gap-2">
                  <b>{dayLabel(r.business_date)}</b>
                  <ShiftChip shift={r.shift} />
                  <span
                    className={cx(
                      'rounded px-1.5 py-0.5 text-xs font-bold',
                      r.kind === 'added' ? 'bg-green-100 text-green-900' : r.kind === 'removed' ? 'bg-red-100 text-red-900' : 'bg-amber-100 text-amber-900',
                    )}
                  >
                    {t(`news.kind.${r.kind}`)}
                  </span>
                  {r.business_date < today && <span className="text-xs text-muted">{t('news.past')}</span>}
                </p>
                {r.kind === 'changed' && (
                  <p className="flex flex-wrap items-center gap-x-2 text-sm">
                    <Cell raw={r.before} old /> → <b><Cell raw={r.after} /></b>
                  </p>
                )}
                {r.kind === 'added' && <p className="text-sm font-bold"><Cell raw={r.after} /></p>}
                {r.kind === 'removed' && <p className="text-sm"><Cell raw={r.before} old /></p>}
              </li>
            ))}
          </ul>
          <Link to="/schedule" className="text-center font-bold text-brand underline">
            🗓️ {t('news.toSchedule')}
          </Link>
        </Sheet>
      )}
    </>
  )
}
