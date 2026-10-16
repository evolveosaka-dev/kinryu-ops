import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../components/Toast'
import { Button, Card, Checkbox, ErrorBox, PageTitle, Segmented, Spinner, TextInput } from '../../components/ui'
import { EQUIPMENT_CATEGORIES, type EquipmentCategory } from '../../domain/incidentWorkflow'
import { errorMessage, storeName } from '../../lib/format'
import { unwrap, useStores } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { useEquipment, type Equipment } from '../incident/wfData'
import { ManagerTabs } from './ManagerTabs'

type Draft = Pick<Equipment, 'name' | 'code' | 'category' | 'note' | 'active'> & { id?: string }

function EquipmentRow({ e, storeId, onDone }: { e: Draft; storeId: string; onDone: () => void }) {
  const { t } = useTranslation('manager')
  const tc = useTranslation().t
  const toast = useToast()
  const queryClient = useQueryClient()
  const [d, setD] = useState<Draft>(e)
  const save = useMutation({
    mutationFn: async () => {
      const row = { store_id: storeId, name: d.name.trim(), code: d.code?.trim() || null, category: d.category, note: d.note?.trim() || null, active: d.active }
      unwrap(d.id ? await supabase.from('equipment_registry').update(row).eq('id', d.id) : await supabase.from('equipment_registry').insert(row))
    },
    onSuccess: () => {
      toast(t('equipment.saved'))
      void queryClient.invalidateQueries({ queryKey: ['equipment_registry'] })
      onDone()
    },
  })
  return (
    <Card className="flex flex-col gap-2">
      <div className="grid grid-cols-[2fr_1fr] gap-2 [&>div]:justify-between">
        <TextInput label={t('equipment.name')} value={d.name} maxLength={60} onChange={(x) => setD({ ...d, name: x.target.value })} />
        <TextInput label={t('equipment.code')} value={d.code ?? ''} maxLength={40} onChange={(x) => setD({ ...d, code: x.target.value })} />
      </div>
      <label className="flex flex-col gap-1 text-[15px] font-bold">
        {t('equipment.category')}
        <select className="min-h-12 rounded-xl border border-slate-400 bg-white px-2 font-normal" value={d.category} onChange={(x) => setD({ ...d, category: x.target.value as EquipmentCategory })}>
          {EQUIPMENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {tc(`wf.eqCategory.${c}`)}
            </option>
          ))}
        </select>
      </label>
      <TextInput label={t('equipment.note')} value={d.note ?? ''} maxLength={200} onChange={(x) => setD({ ...d, note: x.target.value })} />
      <Checkbox checked={d.active} onChange={(v) => setD({ ...d, active: v })}>
        {t('equipment.active')}
      </Checkbox>
      {save.error && <ErrorBox message={errorMessage(save.error)} />}
      <Button onClick={() => save.mutate()} disabled={!d.name.trim() || save.isPending}>
        {t('equipment.save')}
      </Button>
    </Card>
  )
}

/** 設定 → 設備の一覧: the equipment staff choose when they report 設備の故障 (再発 is counted per equipment). */
export function EquipmentPage() {
  const { t } = useTranslation('manager')
  const stores = useStores()
  const list = useEquipment(true)
  const [storeId, setStoreId] = useState('')
  const [adding, setAdding] = useState(false)
  if (stores.isLoading || list.isLoading) return <Spinner />
  const store = storeId || stores.data?.[0]?.id || ''
  const rows = (list.data ?? []).filter((e) => e.store_id === store)
  return (
    <div className="flex flex-col gap-3">
      <ManagerTabs />
      <PageTitle title={t('equipment.title')} subtitle={t('equipment.subtitle')} />
      <Segmented label="" value={store} onChange={setStoreId} options={(stores.data ?? []).map((s) => ({ value: s.id, label: storeName(s, 'ja') }))} />
      {rows.map((e) => (
        <EquipmentRow key={e.id} e={e} storeId={store} onDone={() => undefined} />
      ))}
      {rows.length === 0 && !adding && <p className="text-sm text-muted">{t('equipment.none')}</p>}
      {adding ? (
        <EquipmentRow key={`new-${store}`} e={{ name: '', code: null, category: 'kitchen', note: null, active: true }} storeId={store} onDone={() => setAdding(false)} />
      ) : (
        <Button variant="secondary" onClick={() => setAdding(true)}>
          ＋ {t('equipment.add')}
        </Button>
      )}
    </div>
  )
}
