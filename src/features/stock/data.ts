import { useQuery } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import type { StockEvent, StockItem, StockKind } from '../../domain/stock'
import type { Shift } from '../../domain/types'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'

/** Items of one store (active only unless `all`), in sheet order. */
export function useStockItems(storeId: string, all = false) {
  return useQuery({
    queryKey: ['stock_items', storeId, all],
    enabled: Boolean(storeId),
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      let q = supabase.from('stock_items').select('*').eq('store_id', storeId)
      if (!all) q = q.eq('active', true)
      return unwrap<StockItem[]>(await q.order('sort_order').order('created_at'))
    },
  })
}

/** Every row (history) of one store × date × shift. */
export function useStockEvents(storeId: string, date: string, shift: Shift) {
  return useQuery({
    queryKey: ['stock_events', storeId, date, shift],
    enabled: Boolean(storeId && date),
    staleTime: 15 * 1000,
    refetchInterval: 60 * 1000,
    queryFn: async () =>
      unwrap<StockEvent[]>(
        await supabase
          .from('stock_events')
          .select('*')
          .eq('store_id', storeId)
          .eq('business_date', date)
          .eq('shift', shift)
          .order('created_at', { ascending: false }),
      ).map((e) => ({ ...e, lines: e.lines ?? [], temps: e.temps?.map(Number) ?? null })),
  })
}

export async function addStockEvent(args: {
  store: string
  date: string
  shift: Shift
  kind: StockKind
  lines?: { item: string; qty: number }[]
  place?: string | null
  note?: string | null
  temps?: number[] | null
  reason?: string | null
  noteOriginal?: string | null
  sourceLang?: string | null
}): Promise<string> {
  return unwrap<string>(
    await supabase.rpc('add_stock_event', {
      p_store: args.store,
      p_date: args.date,
      p_shift: args.shift,
      p_kind: args.kind,
      p_lines: args.lines ?? [],
      p_place: args.place ?? null,
      p_note: args.note ?? null,
      p_temps: args.temps ?? null,
      p_reason: args.reason ?? null,
      p_note_original: args.noteOriginal ?? null,
      p_source_lang: args.sourceLang ?? null,
    }),
  )
}

/** Photos / videos per 廃棄・破損 row (RLS: own files, managers all). */
export function useStockPhotos(ids: string[]) {
  return useQuery({
    queryKey: ['stock_photos', ids],
    enabled: ids.length > 0,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const rows = unwrap<{ stock_event_id: string; kind: string; drive_url: string | null; status: string }[]>(
        await supabase.from('attachments').select('stock_event_id, kind, drive_url, status').in('stock_event_id', ids).neq('status', 'failed'),
      )
      const out = new Map<string, typeof rows>()
      for (const r of rows) out.set(r.stock_event_id, [...(out.get(r.stock_event_id) ?? []), r])
      return out
    },
  })
}

/** 管理者が修正: same slot and kind, new figures; the old row is cancelled, the writer and time are kept. */
export async function replaceStockEvent(args: {
  id: string
  lines: { item: string; qty: number }[]
  place?: string | null
  note?: string | null
  reason?: string | null
  noteOriginal?: string | null
  sourceLang?: string | null
}): Promise<string> {
  return unwrap<string>(
    await supabase.rpc('replace_stock_event', {
      p_id: args.id,
      p_lines: args.lines,
      p_place: args.place ?? null,
      p_note: args.note ?? null,
      p_temps: null,
      p_reason: args.reason ?? null,
      p_note_original: args.noteOriginal ?? null,
      p_source_lang: args.sourceLang ?? null,
    }),
  )
}

export async function voidStockEvent(id: string) {
  return unwrap(await supabase.rpc('void_stock_event', { p_id: id }))
}

/** 麺 → 「麺（Mì）」 in other languages; items added later by a manager keep their Japanese name. */
export const itemName = (t: TFunction, item: Pick<StockItem, 'code' | 'name_ja'>) =>
  t(`stock:item.${item.code}`, { defaultValue: item.name_ja })
