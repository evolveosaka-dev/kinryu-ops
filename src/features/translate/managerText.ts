import { supabase } from '../../lib/supabase'
import type { GateResult } from './useTranslationGate'

export type OriginalTable =
  | 'chorei_comments'
  | 'patrol_comments'
  | 'chorei_records'
  | 'patrol_checks'
  | 'shift_changes'
  | 'attendance_overrides'
  | 'chorei_misses'
  | 'incidents'
  | 'staff_interviews'

/**
 * Manager comments / notes are saved in Japanese (owner, 2026-10-16): the writer confirms the translation in
 * the translation gate, and the text as written is kept here so it can be traced. Best effort: the Japanese
 * is already saved, so a failure here does not undo it.
 */
export async function keepOriginals(table: OriginalTable, rowKey: string, tr: Pick<GateResult, 'originals' | 'sourceLang'>) {
  const rows = Object.entries(tr.originals ?? {}).map(([field, original]) => ({
    table_name: table,
    row_key: rowKey,
    field,
    original: original.slice(0, 2000),
    source_lang: tr.sourceLang,
  }))
  if (!rows.length) return
  const { error } = await supabase.from('manager_text_originals').insert(rows)
  if (error) console.warn('manager_text_originals', error.message)
}
