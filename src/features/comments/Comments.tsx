import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth, useMe } from '../../app/auth'
import { Button, ErrorBox, TextArea } from '../../components/ui'
import { formatShortDate, formatTokyoTime, tokyoParts } from '../../domain/time'
import { currentLocale } from '../../i18n'
import { errorMessage } from '../../lib/format'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { keepOriginals } from '../translate/managerText'
import { TranslationCancelled, useTranslationGate } from '../translate/useTranslationGate'

export interface RecordComment {
  id: string
  body: string
  author_id: string
  author_name: string
  created_at: string
  read_at: string | null
}

const when = (iso: string) => {
  const d = new Date(iso)
  return `${formatShortDate(tokyoParts(d).date)} ${formatTokyoTime(d)}`
}

export type CommentKind = 'chorei' | 'patrol'

const RPC = {
  chorei: { add: 'add_chorei_comment', param: 'p_chorei', table: 'chorei_comments', unread: 'unread_chorei_comments', markRead: 'mark_chorei_comments_read' },
  patrol: { add: 'add_patrol_comment', param: 'p_patrol', table: 'patrol_comments', unread: 'unread_patrol_comments', markRead: 'mark_patrol_comments_read' },
} as const

/** Unread manager comments on the 朝礼 I led and the 巡回 I did (ホーム card, 履歴 badge). */
// eslint-disable-next-line react-refresh/only-export-components
export function useUnreadComments() {
  const me = useMe()
  return useQuery({
    queryKey: ['unread_comments', me.id],
    queryFn: async () => {
      const [chorei, patrol] = await Promise.all([supabase.rpc(RPC.chorei.unread), supabase.rpc(RPC.patrol.unread)])
      const c = unwrap<number>(chorei)
      const p = unwrap<number>(patrol)
      return { chorei: c, patrol: p, total: c + p }
    },
    refetchInterval: 5 * 60_000,
  })
}

/** On my own history: mark the comments as read once seen (the 新着 marks stay on screen). */
// eslint-disable-next-line react-refresh/only-export-components
export function useMarkCommentsRead(kind: CommentKind, comments: RecordComment[] | undefined) {
  const me = useMe()
  const queryClient = useQueryClient()
  const unread = (comments ?? []).some((c) => !c.read_at && c.author_id !== me.id)
  useEffect(() => {
    if (!unread) return
    void supabase.rpc(RPC[kind].markRead).then(() => queryClient.invalidateQueries({ queryKey: ['unread_comments'] }))
  }, [kind, unread, queryClient])
}

function Translated({ text }: { text: string }) {
  const { t } = useTranslation()
  const [back, setBack] = useState<string | null>(null)
  const translate = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<{ fields: { back: string }[] }>('translate', {
        body: { fields: [{ key: 'comment', text }], backLang: currentLocale() },
      })
      if (error || !data?.fields[0]) throw new Error(t('translate.failed'))
      return data.fields[0].back
    },
    onSuccess: setBack,
  })
  if (currentLocale() === 'ja') return null
  if (back) return <span className="mt-1 block rounded bg-white px-2 py-1 text-slate-800">🌐 {back}</span>
  return (
    <>
      <button type="button" className="mt-1 min-h-9 text-sm font-bold text-brand underline" onClick={() => translate.mutate()} disabled={translate.isPending}>
        🌐 {translate.isPending ? t('action.loading') : t('comment.translate')}
      </button>
      {translate.error && <span className="block text-xs text-red-700">{errorMessage(translate.error)}</span>}
    </>
  )
}

/**
 * 管理者コメント of one 朝礼 or 巡回 record. Managers can add (and delete their own) comments;
 * the leader / patroller reads them, with "新着" on the ones not read yet.
 */
export function RecordComments({
  kind,
  recordId,
  comments,
  canWrite = true,
}: {
  kind: CommentKind
  recordId: string
  comments: RecordComment[]
  canWrite?: boolean
}) {
  const { t } = useTranslation()
  const { isManager } = useAuth()
  const me = useMe()
  const queryClient = useQueryClient()
  const [body, setBody] = useState('')
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin'] })
    void queryClient.invalidateQueries({ queryKey: ['staff'] })
    void queryClient.invalidateQueries({ queryKey: ['store_history'] })
    void queryClient.invalidateQueries({ queryKey: ['my_chorei'] })
    void queryClient.invalidateQueries({ queryKey: ['my_patrols'] })
  }
  const translation = useTranslationGate()
  // a comment in another language is saved in Japanese after the writer confirms the translation
  const add = useMutation({
    mutationFn: async () => {
      const tr = await translation.prepare([{ key: 'body', label: t('comment.title'), text: body.trim() }])
      const id = unwrap<string>(await supabase.rpc(RPC[kind].add, { [RPC[kind].param]: recordId, p_body: tr.values.body }))
      await keepOriginals(RPC[kind].table, id, tr)
    },
    onSuccess: () => {
      setBody('')
      refresh()
    },
  })
  const originals = useQuery({
    queryKey: ['admin', 'originals', RPC[kind].table, comments.map((c) => c.id)],
    enabled: isManager && comments.length > 0,
    queryFn: async () =>
      new Map(
        unwrap<{ row_key: string; original: string }[]>(
          await supabase.from('manager_text_originals').select('row_key, original').eq('table_name', RPC[kind].table).in('row_key', comments.map((c) => c.id)),
        ).map((r) => [r.row_key, r.original]),
      ),
  })
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from(RPC[kind].table).delete().eq('id', id)),
    onSuccess: refresh,
  })
  const write = isManager && canWrite

  if (!comments.length && !write) return null
  return (
    <section className="mt-1 flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-2.5">
      {translation.review}
      <h3 className="text-sm font-bold">💬 {t('comment.title')}</h3>
      {comments.length > 0 && (
        <ul className="flex flex-col gap-2">
          {comments.map((c) => (
            <li key={c.id} className="text-sm">
              <p className="text-xs text-slate-700">
                {!c.read_at && c.author_id !== me.id && <span className="mr-1 rounded bg-red-600 px-1 font-bold text-white">{t('comment.new')}</span>}
                <b>{c.author_name || '—'}</b> ・ {when(c.created_at)}
              </p>
              <p lang="ja" className="whitespace-pre-wrap break-words">
                {c.body}
              </p>
              {originals.data?.get(c.id) && (
                <p className="text-xs whitespace-pre-wrap text-slate-600">
                  {t('comment.original')}: {originals.data.get(c.id)}
                </p>
              )}
              <Translated text={c.body} />
              {isManager && c.author_id === me.id && (
                <button
                  type="button"
                  className="min-h-9 text-xs text-slate-600 underline"
                  onClick={() => window.confirm(t('comment.deleteConfirm')) && remove.mutate(c.id)}
                  disabled={remove.isPending}
                >
                  {t('comment.delete')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {write && (
        <>
          <TextArea label={t('comment.add')} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} rows={2} />
          <Button className="min-h-11" onClick={() => add.mutate()} disabled={!body.trim() || add.isPending}>
            {t('comment.send')}
          </Button>
        </>
      )}
      {write && <p className="text-xs text-slate-600">{t('comment.jaNote')}</p>}
      {((add.error && !(add.error instanceof TranslationCancelled)) || remove.error) && <ErrorBox message={errorMessage(add.error ?? remove.error)} />}
    </section>
  )
}
