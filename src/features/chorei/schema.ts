import { z } from 'zod'
import { CHOREI_STEPS, SHIFTS, type StepsDone } from '../../domain/types'

// Error messages are i18n keys.
export const choreiSchema = z
  .object({
    store_id: z.string().min(1, 'error.required'),
    business_date: z.iso.date('error.required'),
    shift: z.enum(SHIFTS),
    participants: z.array(z.string()),
    participants_extra: z.array(z.string().min(1)),
    stock_none: z.boolean(),
    stock_text: z.string().trim().nullable(),
    target_bowls: z.number().int().min(0).nullable(),
    caution_text: z.string().trim().nullable(),
    steps_done: z.object(Object.fromEntries(CHOREI_STEPS.map((s) => [s, z.boolean()])) as Record<keyof StepsDone, z.ZodBoolean>),
    skip_reason: z.string().trim().nullable(),
  })
  .superRefine((v, ctx) => {
    if (!v.stock_none && !v.stock_text) {
      ctx.addIssue({ code: 'custom', path: ['stock_text'], message: 'error.required' })
    }
    if (Object.values(v.steps_done).some((done) => !done) && !v.skip_reason) {
      ctx.addIssue({ code: 'custom', path: ['skip_reason'], message: 'error.required' })
    }
  })

export type ChoreiInput = z.infer<typeof choreiSchema>

/** Split "A、B, C" into names. */
export function parseNames(text: string): string[] {
  return text
    .split(/[、,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '_')
    out[key] ??= issue.message
  }
  return out
}
