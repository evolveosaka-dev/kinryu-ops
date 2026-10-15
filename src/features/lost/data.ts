import { useQuery } from '@tanstack/react-query'
import type { LostComment, LostItem } from '../../domain/lostItem'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import type { AttachmentSummary } from '../../lib/types'

export type LostRow = LostItem & {
  attachments: (AttachmentSummary & { phase: 'found' | 'return' | null })[]
  lost_item_comments: LostComment[]
}

/** Every lost item of the last months (RLS: all active staff; test rows only for test accounts). */
export function useLostItems() {
  return useQuery({
    queryKey: ['lost_items'],
    refetchInterval: 2 * 60_000,
    queryFn: async () =>
      unwrap<LostRow[]>(
        await supabase
          .from('lost_items')
          .select('*, attachments(id, kind, status, drive_url, owner_id, created_at, phase), lost_item_comments(*)')
          .order('found_at', { ascending: false })
          .limit(300),
      ),
  })
}
