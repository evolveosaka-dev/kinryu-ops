import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../app/auth'
import { Sheet } from '../../components/Sheet'
import { useToast } from '../../components/Toast'
import { Button, ErrorBox } from '../../components/ui'
import { WheelPicker } from '../../components/WheelPicker'
import type { DutyKind, DutyMethod, DutyTimeMode } from '../../domain/duty'
import { formatRange, STORE_BY_MARK } from '../../domain/schedule'
import type { Shift } from '../../domain/types'
import { errorMessage } from '../../lib/format'
import { unwrap, useStores } from '../../lib/queries'
import { readSeen, writeSeen } from '../../lib/seenMark'
import { supabase } from '../../lib/supabase'
import { DutyTime } from '../schedule/DutyCard'
import { StoreLabel } from '../schedule/parts'
import { useDayLabel } from '../schedule/style'
import { ShiftChangesSheet } from './ShiftSync'
import { useShiftImportLog, type ShiftImportLog } from './shiftSyncData'

// ホーム (managers): 「シフト表が更新されました」 (short; the changes open on tap) and, urgent, 朝礼・巡回 duties whose
// person is no longer in the shift table at that time → choose someone else with a wheel.

interface OrphanDuty {
  id: string
  business_date: string
  shift: Shift
  store_id: string
  roster_name: string
  kind: DutyKind
  time_mode: DutyTimeMode
  start_min: number
  end_min: number
  method: DutyMethod
}
interface Group {
  key: string
  date: string
  shift: Shift
  name: string
  duties: OrphanDuty[]
}

const MARK_BY_CODE = Object.fromEntries(Object.entries(STORE_BY_MARK).flatMap(([mark, s]) => (s.code ? [[s.code, mark]] : [])))

function useOrphanDuties() {
  return useQuery({
    queryKey: ['admin', 'orphan_duties'],
    staleTime: 60_000,
    queryFn: async () => unwrap<OrphanDuty[]>(await supabase.rpc('orphan_duties')),
  })
}

/** Who took the shift, from the latest import that removed this person from it. */
function replacedBy(logs: ShiftImportLog[], g: Group): string[] | null {
  for (const l of logs) {
    const same = l.changes.filter((c) => c.date === g.date && c.shift === g.shift)
    if (same.some((c) => c.name === g.name && c.kind === 'removed')) return same.filter((c) => c.kind === 'added').map((c) => c.name)
  }
  return null
}

function ReassignSheet({ group, logs, onClose }: { group: Group; logs: ShiftImportLog[]; onClose: () => void }) {
  const { t } = useTranslation('manager')
  const { t: ts } = useTranslation('shift')
  const toast = useToast()
  const queryClient = useQueryClient()
  const dayLabel = useDayLabel()
  const stores = useStores()
  const [name, setName] = useState<string | null>(null)
  const sameShift = useQuery({
    queryKey: ['shift_assignments', 'slot-all', group.date, group.shift],
    queryFn: async () =>
      unwrap<{ roster_name: string; store_mark: string; start_min: number; end_min: number }[]>(
        await supabase.from('shift_assignments').select('roster_name, store_mark, start_min, end_min').eq('business_date', group.date).eq('shift', group.shift).order('start_min'),
      ),
  })
  const roster = useQuery({
    queryKey: ['staff_roster', 'active-names'],
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap<{ name: string }[]>(await supabase.from('staff_roster').select('name').eq('active', true).order('name')).map((r) => r.name),
  })
  const options = useMemo(() => {
    const here = (sameShift.data ?? []).filter((s) => s.roster_name !== group.name)
    const hereNames = new Set(here.map((s) => s.roster_name))
    return [
      ...here.map((s) => ({ value: s.roster_name, label: `🟢 ${s.roster_name}  ${STORE_BY_MARK[s.store_mark]?.short ?? s.store_mark} ${formatRange(s)}` })),
      ...(roster.data ?? []).filter((n) => !hereNames.has(n) && n !== group.name).map((n) => ({ value: n, label: n })),
    ]
  }, [sameShift.data, roster.data, group.name])
  const save = useMutation({
    mutationFn: async (to: string) => unwrap<number>(await supabase.rpc('reassign_duties', { p_ids: group.duties.map((d) => d.id), p_roster: to })),
    onSuccess: (n, to) => {
      toast(t('dutyAlert.done', { n, name: to }))
      for (const k of [['admin', 'orphan_duties'], ['my_duties']]) void queryClient.invalidateQueries({ queryKey: k })
      onClose()
    },
  })
  const who = replacedBy(logs, group)
  const storeCode = (id: string) => stores.data?.find((s) => s.id === id)?.code ?? ''
  const err = save.error ? errorMessage(save.error) : null
  return (
    <Sheet title={`⚠️ ${t('dutyAlert.title')}`} onClose={onClose}>
      <p className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-900">
        {who && who.length
          ? t('dutyAlert.whyMoved', { date: dayLabel(group.date), shift: t(`common:shift.${group.shift}`), name: group.name, to: who.join('、') })
          : t('dutyAlert.whyNoShift', { date: dayLabel(group.date), shift: t(`common:shift.${group.shift}`), name: group.name })}
      </p>
      <ul className="flex flex-col gap-1">
        {group.duties.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-x-2 rounded-xl border border-line bg-white px-3 py-2 text-sm">
            <b>
              {d.kind === 'chorei' ? '📣 ' : '🔍 '}
              {ts(`duty.${d.kind}`)}
            </b>
            <span className="tabular-nums">{d.time_mode === 'during' ? formatRange(d) : <DutyTime d={d} />}</span>
            <StoreLabel mark={MARK_BY_CODE[storeCode(d.store_id)] ?? ''} />
            {d.method === 'move' && <span className="text-xs text-muted">（{ts('duty.method.move')}）</span>}
          </li>
        ))}
      </ul>
      {sameShift.isLoading || roster.isLoading ? (
        <p className="text-sm text-muted">…</p>
      ) : (
        <>
          <WheelPicker label={t('dutyAlert.pick')} options={options} value={name} onChange={setName} />
          <p className="text-xs text-muted">{t('dutyAlert.pickHint', { shift: t(`common:shift.${group.shift}`) })}</p>
        </>
      )}
      {err && <ErrorBox message={err.includes('already_has_duty') ? t('dutyAlert.already') : err} />}
      <Button disabled={!name || save.isPending} onClick={() => name && save.mutate(name)}>
        {t('dutyAlert.assign', { name: name ?? '' })}
      </Button>
    </Sheet>
  )
}

export function HomeShiftAlerts() {
  const { t } = useTranslation('manager')
  const { profile } = useAuth()
  const dayLabel = useDayLabel()
  const logs = useShiftImportLog(7)
  const orphans = useOrphanDuties()
  const key = `shift-log:${profile?.id ?? ''}`
  const [seen, setSeen] = useState(() => readSeen(key))
  const [shownLogs, setShownLogs] = useState<ShiftImportLog[] | null>(null)
  const [group, setGroup] = useState<Group | null>(null)

  const fresh = (logs.data ?? []).filter((l) => l.id > seen)
  const freshCount = fresh.reduce((n, l) => n + l.n_changes, 0)
  const groups = useMemo(() => {
    const m = new Map<string, Group>()
    for (const d of orphans.data ?? []) {
      const k = `${d.business_date}|${d.shift}|${d.roster_name}`
      const g = m.get(k) ?? { key: k, date: d.business_date, shift: d.shift, name: d.roster_name, duties: [] }
      g.duties.push(d)
      m.set(k, g)
    }
    return [...m.values()]
  }, [orphans.data])

  const openLogs = () => {
    setShownLogs(fresh)
    const top = Math.max(...fresh.map((l) => l.id))
    writeSeen(key, top)
    setSeen(top)
  }

  return (
    <>
      {groups.map((g) => (
        <button
          key={g.key}
          type="button"
          onClick={() => setGroup(g)}
          className="flex items-center gap-3 rounded-2xl border-2 border-red-500 bg-red-50 px-4 py-3 text-left font-bold text-red-950"
        >
          <span aria-hidden className="text-2xl">
            ⚠️
          </span>
          <span className="flex-1">{t('dutyAlert.card', { date: dayLabel(g.date), shift: t(`common:shift.${g.shift}`), name: g.name })}</span>
          <span aria-hidden className="text-xl">
            ›
          </span>
        </button>
      ))}
      {fresh.length > 0 && (
        <button type="button" onClick={openLogs} className="flex items-center gap-3 rounded-2xl border-2 border-sky-400 bg-sky-50 px-4 py-3 text-left font-bold text-sky-950">
          <span aria-hidden className="text-2xl">
            📅
          </span>
          <span className="flex-1">{t('shiftSync.homeCard', { n: freshCount })}</span>
          <span aria-hidden className="text-xl">
            ›
          </span>
        </button>
      )}
      {shownLogs && <ShiftChangesSheet logs={shownLogs} onClose={() => setShownLogs(null)} />}
      {group && <ReassignSheet group={group} logs={logs.data ?? []} onClose={() => setGroup(null)} />}
    </>
  )
}
