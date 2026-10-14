import { useTranslation } from 'react-i18next'
import { currentLocale } from '../i18n'
import { storeName } from '../lib/format'
import { useRoster, useSlotStaff, useStores } from '../lib/queries'
import type { Shift } from '../domain/types'

/**
 * One dropdown per person, filled from the staff roster (real names from the shift table).
 * With `slot` (朝礼): the people scheduled for that shift at `storeId` (出勤予定), then all staff.
 * Otherwise staff of `storeId` are listed first.
 * A name can be chosen only once.
 */
export function StaffPicker({
  label,
  hint,
  value,
  onChange,
  storeId,
  exclude = [],
  slot,
}: {
  label: string
  hint?: string
  value: string[]
  onChange: (names: string[]) => void
  storeId: string
  exclude?: string[]
  slot?: { date: string; shift: Shift }
}) {
  const { t } = useTranslation()
  const roster = useRoster()
  const stores = useStores()
  const locale = currentLocale()
  // always show at least one (empty) row
  const rows = value.length ? value : ['']
  const scheduled = useSlotStaff(storeId, slot?.date, slot?.shift).data ?? []
  const everyone = roster.data ?? []

  const groups = (
    slot
      ? // 朝礼: the people scheduled for that shift at that store, then everyone
        [
          { key: 'scheduled', label: t('picker.scheduled', { shift: t(`shift.${slot.shift}`) }), names: scheduled.map((name) => ({ id: `s:${name}`, name })) },
          { key: 'all', label: t('picker.all'), names: everyone },
        ]
      : [
          ...(stores.data ?? [])
            .slice()
            .sort((a, b) => (a.id === storeId ? -1 : b.id === storeId ? 1 : a.sort_order - b.sort_order))
            .map((s) => ({ key: s.id, label: storeName(s, locale), names: everyone.filter((r) => r.home_store_id === s.id) })),
          { key: 'none', label: t('picker.noStore'), names: everyone.filter((r) => !r.home_store_id) },
        ]
  ).filter((g) => g.names.length > 0)

  // empty rows are kept while editing; callers drop them on submit
  const set = (i: number, name: string) => onChange(rows.map((x, j) => (j === i ? name : x)))

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-bold text-slate-700">{label}</legend>
      {roster.data?.length === 0 && <p className="text-sm text-amber-800">{t('picker.empty')}</p>}
      {rows.map((current, i) => {
        const taken = new Set([...rows.filter((_, j) => j !== i), ...exclude])
        return (
          <div key={i} className="flex gap-2">
            <select
              className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-2 text-base focus:border-brand focus:outline-none"
              value={current}
              aria-label={t('picker.person', { n: i + 1 })}
              onChange={(e) => set(i, e.target.value)}
            >
              <option value="">{t('picker.select', { n: i + 1 })}</option>
              {groups.map((g) => (
                <optgroup key={g.key} label={g.label}>
                  {g.names
                    .filter((r) => !taken.has(r.name))
                    .map((r) => (
                      <option key={r.id} value={r.name}>
                        {r.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            <button
              type="button"
              aria-label={t('picker.remove')}
              onClick={() => onChange(rows.length === 1 ? [] : rows.filter((_, j) => j !== i))}
              className="min-h-11 min-w-11 rounded-xl border border-slate-300 bg-white text-slate-600"
            >
              ✕
            </button>
          </div>
        )
      })}
      <button
        type="button"
        onClick={() => onChange([...rows, ''])}
        disabled={rows.some((x) => !x)}
        className="min-h-11 rounded-xl border border-dashed border-brand font-bold text-brand disabled:border-slate-300 disabled:text-slate-500"
      >
        ＋ {t('picker.add')}
      </button>
      {hint && <p className="text-xs text-slate-600">{hint}</p>}
    </fieldset>
  )
}
