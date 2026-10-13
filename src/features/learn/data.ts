import { FunctionsHttpError } from '@supabase/supabase-js'
import { useQuery } from '@tanstack/react-query'
import type { LearnItem, LearnKind } from '../../domain/learn'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'

export const LEARN_BUCKET = 'learn'

/** Published pages of one kind (managers also get drafts, by RLS). */
export function useLearnItems(kind: LearnKind) {
  return useQuery({
    queryKey: ['learn_items', kind],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => unwrap<LearnItem[]>(await supabase.from('learn_items').select('*').eq('kind', kind)),
  })
}

export function useLearnItem(id: string | undefined) {
  return useQuery({
    queryKey: ['learn_items', 'one', id],
    enabled: Boolean(id),
    staleTime: 60 * 1000,
    queryFn: async () => unwrap<LearnItem | null>(await supabase.from('learn_items').select('*').eq('id', id!).maybeSingle()),
  })
}

/** Signed URLs (1 h) for photos in the private bucket: path → url. */
export function usePhotoUrls(paths: string[]) {
  const sorted = [...new Set(paths)].sort()
  return useQuery({
    queryKey: ['learn_photos', sorted],
    enabled: sorted.length > 0,
    staleTime: 50 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(LEARN_BUCKET).createSignedUrls(sorted, 3600)
      if (error) throw error
      return new Map(data.filter((d) => d.signedUrl && d.path).map((d) => [d.path!, d.signedUrl]))
    },
  })
}

/** Ask learn-translate to translate a page (managers). Throws with the function's message. */
export async function translateLearnItem(itemId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('learn-translate', { body: { itemId } })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const json = (await (error.context as Response).json().catch(() => ({}))) as { error?: string }
      throw new Error(json.error ?? error.message)
    }
    throw error
  }
}
