import { FunctionsHttpError } from '@supabase/supabase-js'
import { useQuery } from '@tanstack/react-query'
import type { SalesLog, SalesReport } from '../../domain/sales'
import type { SalesPhotoRead } from '../../domain/salesPhoto'
import type { StockEvent } from '../../domain/stock'
import type { Shift } from '../../domain/types'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'

export function useSalesReport(storeId: string, date: string, shift: Shift) {
  return useQuery({
    queryKey: ['sales_report', storeId, date, shift],
    enabled: Boolean(storeId && date),
    staleTime: 15 * 1000,
    queryFn: async () =>
      unwrap<SalesReport | null>(
        await supabase.from('sales_reports').select('*, attachments(id, status, drive_url)').eq('store_id', storeId).eq('business_date', date).eq('shift', shift).maybeSingle(),
      ),
  })
}

export function useSalesLog(reportId: string | undefined) {
  return useQuery({
    queryKey: ['sales_report_log', reportId],
    enabled: Boolean(reportId),
    staleTime: 15 * 1000,
    queryFn: async () =>
      unwrap<SalesLog[]>(await supabase.from('sales_report_log').select('*').eq('report_id', reportId!).order('at', { ascending: false })),
  })
}

export async function saveSalesReport(store: string, date: string, shift: Shift, data: Record<string, unknown>, submit: boolean) {
  return unwrap<string>(await supabase.rpc('save_sales_report', { p_store: store, p_date: date, p_shift: shift, p_data: data, p_submit: submit }))
}

/** Reports of a period (manager list / Excel). */
export function useSalesReports(from: string, to: string) {
  return useQuery({
    queryKey: ['sales_report', 'range', from, to],
    queryFn: async () =>
      unwrap<SalesReport[]>(await supabase.from('sales_reports').select('*').gte('business_date', from).lte('business_date', to).order('business_date')),
  })
}

/** 廃棄・破損 rows of a period (その他払出 of 麺 in the Excel sheets). */
export async function fetchLossEvents(from: string, to: string) {
  return unwrap<StockEvent[]>(
    await supabase.from('stock_events').select('*').eq('kind', 'loss').is('voided_at', null).gte('business_date', from).lte('business_date', to),
  )
}

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1))
    r.onerror = () => reject(r.error ?? new Error('read failed'))
    r.readAsDataURL(blob)
  })

/** 日報(1ページ表) の写真 → figures read by the AI (Edge Function sales-read); nothing is saved. */
export async function readSalesPhoto(storeId: string, image: Blob): Promise<SalesPhotoRead> {
  const { data, error } = await supabase.functions.invoke<SalesPhotoRead>('sales-read', {
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
