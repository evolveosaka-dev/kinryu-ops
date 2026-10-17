import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../../app/auth'
import type { PayrollInput, PayrollRates, PayrollStaff } from '../../../domain/payroll'
import { unwrap } from '../../../lib/queries'
import { supabase } from '../../../lib/supabase'
import type { PayrollSource } from '../../../../supabase/functions/_shared/payrollWorkbook'

// 給与計算: System Admin only (RLS is_payroll_admin; the screen is hidden from everyone else too).

export const hrs = (n: number) => `${Math.round(n * 100) / 100}h`

export function useIsPayrollAdmin() {
  const { isAdmin, profile } = useAuth()
  return isAdmin && !profile?.is_test_account
}

export interface StaffRow extends PayrollStaff {
  active: boolean
  note: string | null
}
export interface InputRow extends PayrollInput {
  month: string
  roster_name: string
}
export interface Closing {
  month: string
  results: ClosedResult[]
  total: number
  source_imported_at: string | null
  closed_at: string
  closed_by_name: string | null
}
/** What a 確定 keeps per person (enough for the list and the Excel). */
export interface ClosedResult {
  name: string
  code: string | null
  kind: string
  workDays: number
  totalHours: number
  report: Record<string, number>
  pay: Record<string, number>
  allowances: Record<string, number>
  total: number
}

export function usePayrollMonths(enabled: boolean) {
  return useQuery({
    queryKey: ['payroll', 'months'],
    enabled,
    queryFn: async () => unwrap<{ month: string; imported_at: string; source: string }[]>(await supabase.from('payroll_sources').select('month, imported_at, source').order('month')),
  })
}

export function usePayrollMonth(month: string | null) {
  return useQuery({
    queryKey: ['payroll', 'month', month],
    enabled: Boolean(month),
    queryFn: async () => {
      const [src, rates, staff, inputs, closing] = await Promise.all([
        supabase.from('payroll_sources').select('data, imported_at').eq('month', month!).maybeSingle(),
        supabase.from('payroll_rates').select('*').lte('valid_from', month!).order('valid_from', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('payroll_staff').select('*').order('kind').order('roster_name'),
        supabase.from('payroll_inputs').select('*').eq('month', month!),
        supabase.from('payroll_closings').select('*').eq('month', month!).maybeSingle(),
      ])
      for (const r of [src, rates, staff, inputs, closing]) if (r.error) throw new Error(r.error.message)
      return {
        source: (src.data?.data ?? null) as PayrollSource | null,
        importedAt: (src.data?.imported_at ?? null) as string | null,
        rates: (rates.data ?? null) as (PayrollRates & { valid_from: string }) | null,
        staff: (staff.data ?? []) as StaffRow[],
        inputs: (inputs.data ?? []) as InputRow[],
        closing: (closing.data ?? null) as Closing | null,
      }
    },
  })
}

export function usePayrollFiles(enabled: boolean) {
  return useQuery({
    queryKey: ['payroll', 'files'],
    enabled,
    queryFn: async () =>
      unwrap<{ id: string; month: string | null; name: string; storage_path: string; sha256: string; size_bytes: number; uploaded_at: string }[]>(
        await supabase.from('payroll_files').select('*').order('uploaded_at', { ascending: false }),
      ),
  })
}
