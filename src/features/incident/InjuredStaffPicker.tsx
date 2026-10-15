import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { WheelPicker } from '../../components/WheelPicker'
import { currentSlot } from '../../domain/time'
import { unwrap, useSlotSchedule } from '../../lib/queries'
import { supabase } from '../../lib/supabase'

/**
 * ケガ・事故 → スタッフ: the people of this store's current shift (shift table) at the top of the wheel, marked 🟢,
 * then every other active name of the roster.
 */
export function InjuredStaffPicker({ storeId, value, onChange, label }: { storeId: string; value: string | null; onChange: (name: string) => void; label?: string }) {
  const { t } = useTranslation()
  const slot = useMemo(() => currentSlot(new Date()), [])
  const onShift = useSlotSchedule(storeId, slot.businessDate, slot.shift)
  const roster = useQuery({
    queryKey: ['staff_roster', 'active-names'],
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap<{ name: string }[]>(await supabase.from('staff_roster').select('name').eq('active', true).order('name')).map((r) => r.name),
  })
  const options = useMemo(() => {
    const here = [...new Set((onShift.data ?? []).map((s) => s.roster_name))]
    const rest = (roster.data ?? []).filter((n) => !here.includes(n))
    return [...here.map((n) => ({ value: n, label: `🟢 ${n}` })), ...rest.map((n) => ({ value: n, label: n }))]
  }, [onShift.data, roster.data])
  if (onShift.isLoading || roster.isLoading) return <p className="text-sm text-muted">{t('action.loading')}</p>
  if (options.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      <WheelPicker label={label ?? t('incident.injured.who')} options={options} value={value} onChange={onChange} />
      <p className="text-xs text-muted">{t('incident.injured.onShiftHint', { shift: t(`shift.${slot.shift}`) })}</p>
    </div>
  )
}
