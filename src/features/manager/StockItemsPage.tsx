import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../components/Toast'
import { Button, Card, ErrorBox, PageTitle, Segmented, Spinner } from '../../components/ui'
import { PACK_UNITS, STOCK_UNITS, parseQty, type PackUnit, type StockItem, type StockUnit } from '../../domain/stock'
import { errorMessage, storeName } from '../../lib/format'
import { unwrap, useStores } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { useStockItems } from '../stock/data'
import { ManagerTabs } from './ManagerTabs'

interface Draft {
  id?: string
  name_ja: string
  unit: StockUnit
  standard: string
  pack_size: string
  pack_unit: PackUnit | ''
  sort_order: string
  active: boolean
}

const toDraft = (i: StockItem): Draft => ({
  id: i.id,
  name_ja: i.name_ja,
  unit: i.unit,
  standard: i.standard === null ? '' : String(i.standard),
  pack_size: i.pack_size === null ? '' : String(i.pack_size),
  pack_unit: i.pack_unit ?? '',
  sort_order: String(i.sort_order),
  active: i.active,
})

const omit = <T,>(o: Record<string, T>, key: string) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key))

const cell = 'min-h-10 w-full rounded-lg border border-slate-400 bg-white px-2 text-sm'

/** 設定 → 在庫の品目: items, units, 標準量 per store, and the number of fridges. */
export function StockItemsPage() {
  const { t } = useTranslation('manager')
  const ts = useTranslation('stock').t
  const toast = useToast()
  const queryClient = useQueryClient()
  const stores = useStores()
  const [storeId, setStoreId] = useState('')
  const store = stores.data?.find((s) => s.id === storeId) ?? stores.data?.[0]
  const items = useStockItems(store?.id ?? '', true)
  const [drafts, setDrafts] = useState<Record<string, Draft[]>>({})
  const [fridges, setFridges] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const rows = (store && drafts[store.id]) ?? (items.data ?? []).map(toDraft)
  const setRows = (next: Draft[]) => store && setDrafts((d) => ({ ...d, [store.id]: next }))
  const update = (i: number, patch: Partial<Draft>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const fridgeText = (store && fridges[store.id]) ?? String(store?.fridge_count ?? 0)

  const save = useMutation({
    mutationFn: async () => {
      if (!store) return
      const num = (s: string) => {
        const v = parseQty(s)
        if (v === undefined) throw new Error(t('stockItems.badNumber'))
        return v
      }
      const payload = rows.map((r, i) => {
        if (!r.name_ja.trim()) throw new Error(t('stockItems.nameRequired'))
        const packSize = num(r.pack_size)
        return {
          ...(r.id ? { id: r.id } : { code: `x${Date.now().toString(36)}${i}` }),
          store_id: store.id,
          name_ja: r.name_ja.trim(),
          unit: r.unit,
          standard: num(r.standard),
          pack_size: packSize && r.pack_unit ? packSize : null,
          pack_unit: packSize && r.pack_unit ? r.pack_unit : null,
          sort_order: Number.parseInt(r.sort_order, 10) || 0,
          active: r.active,
        }
      })
      const count = Number(fridgeText)
      if (!Number.isInteger(count) || count < 0 || count > 10) throw new Error(t('stockItems.badNumber'))
      for (const p of payload) {
        if ('id' in p) unwrap(await supabase.from('stock_items').update(p).eq('id', p.id))
        else unwrap(await supabase.from('stock_items').insert(p))
      }
      if (count !== store.fridge_count) unwrap(await supabase.from('stores').update({ fridge_count: count }).eq('id', store.id))
    },
    onSuccess: () => {
      setError(null)
      if (store) {
        setDrafts((d) => omit(d, store.id))
        setFridges((f) => omit(f, store.id))
      }
      toast(t('stockItems.saved'))
      void queryClient.invalidateQueries({ queryKey: ['stock_items'] })
      void queryClient.invalidateQueries({ queryKey: ['stores'] })
    },
    onError: (e) => setError(errorMessage(e)),
  })

  if (stores.isLoading || items.isLoading) return <Spinner />
  if (!store) return null

  return (
    <div className="flex flex-col gap-3">
      <ManagerTabs />
      <PageTitle title={t('stockItems.title')} subtitle={t('stockItems.note')} />
      <Segmented label="" value={store.id} onChange={setStoreId} options={(stores.data ?? []).map((s) => ({ value: s.id, label: storeName(s, 'ja') }))} />
      <Card className="flex items-center gap-3">
        <label className="flex-1 font-bold" htmlFor="fridges">
          🌡️ {t('stockItems.fridges')}
        </label>
        <input id="fridges" inputMode="numeric" className={`${cell} w-20 text-right`} value={fridgeText} onChange={(e) => setFridges((f) => ({ ...f, [store.id]: e.target.value }))} />
      </Card>
      <Card className="flex flex-col gap-3 p-3">
        {rows.map((r, i) => (
          <div key={r.id ?? `new${i}`} className={`flex flex-col gap-2 rounded-xl border border-line p-2 ${r.active ? '' : 'bg-slate-100'}`}>
            <div className="flex gap-2">
              <input aria-label={t('stockItems.name')} className={`${cell} flex-1 font-bold`} value={r.name_ja} maxLength={40} onChange={(e) => update(i, { name_ja: e.target.value })} />
              <label className="flex shrink-0 items-center gap-1 text-sm">
                <input type="checkbox" className="size-5 accent-brand" checked={r.active} onChange={(e) => update(i, { active: e.target.checked })} />
                {t('stockItems.active')}
              </label>
            </div>
            <div className="grid grid-cols-5 gap-1.5 text-xs">
              <label className="flex flex-col gap-0.5">
                {t('stockItems.unit')}
                <select className={cell} value={r.unit} onChange={(e) => update(i, { unit: e.target.value as StockUnit })}>
                  {STOCK_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {ts(`unit.${u}`, { lng: 'ja' })}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-0.5">
                {t('stockItems.standard')}
                <input inputMode="decimal" className={`${cell} text-right`} value={r.standard} onChange={(e) => update(i, { standard: e.target.value })} />
              </label>
              <label className="flex flex-col gap-0.5">
                {t('stockItems.packUnit')}
                <select className={cell} value={r.pack_unit} onChange={(e) => update(i, { pack_unit: e.target.value as PackUnit | '' })}>
                  <option value="">{t('stockItems.none')}</option>
                  {PACK_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {ts(`pack.${u}`, { lng: 'ja' })}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-0.5">
                {t('stockItems.packSize')}
                <input inputMode="decimal" className={`${cell} text-right`} value={r.pack_size} onChange={(e) => update(i, { pack_size: e.target.value })} />
              </label>
              <label className="flex flex-col gap-0.5">
                {t('stockItems.order')}
                <input inputMode="numeric" className={`${cell} text-right`} value={r.sort_order} onChange={(e) => update(i, { sort_order: e.target.value })} />
              </label>
            </div>
          </div>
        ))}
        <Button
          variant="secondary"
          onClick={() =>
            setRows([...rows, { name_ja: '', unit: 'bag', standard: '', pack_size: '', pack_unit: '', sort_order: String((Number(rows.at(-1)?.sort_order) || 0) + 10), active: true }])
          }
        >
          {t('stockItems.add')}
        </Button>
      </Card>
      {error && <ErrorBox message={error} />}
      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? t('common:action.loading') : t('stockItems.save')}
      </Button>
    </div>
  )
}
