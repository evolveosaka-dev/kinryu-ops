import { useQuery } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { FunctionsHttpError } from '@supabase/supabase-js'
import type { StockEvent, StockItem, StockKind } from '../../domain/stock'
import type { PhotoRead } from '../../domain/stockPhoto'
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
  /** 終わりの在庫 for only some items (items missing from a paper sheet) */
  partial?: boolean
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
      p_partial: args.partial ?? false,
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

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1))
    r.onerror = () => reject(r.error ?? new Error('read failed'))
    r.readAsDataURL(blob)
  })

/** 日報の写真 → figures read by the AI (Edge Function stock-read); nothing is saved. */
export async function readStockPhoto(storeId: string, image: Blob): Promise<PhotoRead> {
  const { data, error } = await supabase.functions.invoke<PhotoRead>('stock-read', {
    body: { storeId, image: await toBase64(image), mediaType: image.type || 'image/jpeg' },
  })
  if (error || !data) {
    if (error instanceof FunctionsHttpError) {
      const json = (await (error.context as Response).json().catch(() => ({}))) as { error?: string }
      throw new Error(json.error ?? error.message)
    }
    throw error ?? new Error('not read')
  }
  return data
}

export interface SheetMove {
  place: string
  note: string | null
  lines: { item: string; qty: number }[]
}

/** One paper sheet → all its rows at once (RPC save_stock_sheet); returns the 終わりの在庫 row id. */
export async function saveStockSheet(args: {
  store: string
  date: string
  shift: Shift
  open: { lines: { item: string; qty: number }[]; reason: string; note: string | null } | null
  ins: SheetMove[]
  outs: SheetMove[]
  close: { item: string; qty: number }[]
  tempsStart: number[] | null
  tempsEnd: number[] | null
}): Promise<string> {
  return unwrap<string>(
    await supabase.rpc('save_stock_sheet', {
      p_store: args.store,
      p_date: args.date,
      p_shift: args.shift,
      p_sheet: { open: args.open, ins: args.ins, outs: args.outs, close: args.close, temps_start: args.tempsStart, temps_end: args.tempsEnd },
    }),
  )
}

/** Handwritten standards that differ from 在庫の品目 → mail to the system admins. */
export async function reportStockStandards(closeId: string, rows: { item: string; paper: number; text: string }[]) {
  return unwrap(await supabase.rpc('report_stock_standards', { p_event: closeId, p_rows: rows }))
}
