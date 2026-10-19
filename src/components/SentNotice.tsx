import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { formatTokyoTime } from '../domain/time'
import { failReason, useUploadQueue, type UploadItem } from '../features/attachments/uploadQueue'
import { canAdd, MediaError, prepareMedia, type MediaKind, type PreparedMedia } from '../lib/media'
import { Button } from './ui'

export interface SentInfo {
  /** what was sent, e.g. 朝礼記録 */
  kind: string
  /** e.g. 10/12(月) 早番・御堂筋店 */
  detail?: string
  /** photos / videos still uploading in the background */
  photos?: number
}

const SentContext = createContext<(info: SentInfo) => void>(() => {})

interface Tracked {
  size: number
  kind: MediaKind
  parentType: UploadItem['parentType']
  parentId: string
}

/**
 * A confirmation that stays on screen until the user taps OK, so nobody misses that a report was sent.
 * With photos/videos it follows them (owner, 2026-10-19): staff closed the app on ✅ while files were still
 * uploading, so ✅ 送信完了 appears only when every file has arrived; until then it shows the progress.
 * A file that cannot be sent is replaced (別のファイルを選ぶ) or given up (やめる), keeping the files that arrived;
 * when none arrived any more the sender chooses: add photos/videos, or finish without them.
 */
export function SentNoticeProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const { items, current, outcome, enqueue, discard, retry } = useUploadQueue()
  // files: this report's files (id → …), taken from the queue at show(); the report's files are queued before it
  const [info, setInfo] = useState<(SentInfo & { at: Date; files: Record<string, Tracked> }) | null>(null)
  const [warned, setWarned] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)
  const show = useCallback(
    (i: SentInfo) => {
      setWarned(false)
      setPickError(null)
      const queue = current()
      // the newest queued file belongs to this report (older reports' files may still be waiting)
      const parentId = i.photos ? queue.at(-1)?.parentId : undefined
      const files = Object.fromEntries(
        queue.filter((x) => x.parentId === parentId).map((x) => [x.id, { size: x.size, kind: x.kind, parentType: x.parentType, parentId: x.parentId }]),
      )
      setInfo({ ...i, at: new Date(), files })
    },
    [current],
  )

  // 別のファイルを選ぶ (replaces one file, same kind) / 写真・動画を選ぶ (nothing attached any more: any files)
  const picker = useRef<HTMLInputElement>(null)
  const [replacing, setReplacing] = useState<string | null>(null)
  const pick = (replaceId: string | null) => {
    setReplacing(replaceId)
    setPickError(null)
    const input = picker.current!
    const kind = replaceId ? info?.files[replaceId]?.kind : null
    input.accept = kind === 'image' ? 'image/*' : kind === 'video' ? 'video/*' : 'image/*,video/*'
    input.multiple = !replaceId
    input.click()
  }
  const onPicked = async (list: FileList | null) => {
    const ref = info && Object.values(info.files)[0]
    if (!info || !ref || !list?.length) return
    setBusy(true)
    const added: PreparedMedia[] = []
    try {
      for (const file of Array.from(list)) {
        const m = await prepareMedia(file)
        if (!canAdd(added, m.kind)) {
          setPickError(t('attach.tooMany'))
          break
        }
        added.push(m)
      }
    } catch (err) {
      setPickError(t(`attach.${err instanceof MediaError ? err.code : 'unsupported'}`))
    }
    if (added.length) {
      // the old file first: it still counts toward the record's limits while it waits
      if (replacing) await discard(replacing)
      await enqueue(ref.parentType, ref.parentId, added)
      const more = Object.fromEntries(added.map((m) => [m.id, { size: m.size, kind: m.kind, parentType: ref.parentType, parentId: ref.parentId }]))
      setInfo((cur) => cur && { ...cur, files: { ...cur.files, ...more } })
    }
    setBusy(false)
  }

  const ids = Object.keys(info?.files ?? {})
  const mine = items.filter((i) => ids.includes(i.id))
  const pending = mine.filter((i) => i.status !== 'error')
  const failed = mine.filter((i) => i.status === 'error')
  const sending = pending.length > 0
  const counted = ids.filter((id) => outcome[id] !== 'dropped')
  const dropped = ids.length - counted.length
  // a file no longer in the queue and not given up has arrived
  const arrived = counted.filter((id) => !mine.some((i) => i.id === id)).length
  const total = counted.reduce((s, id) => s + info!.files[id]!.size, 0)
  const done = counted.reduce((s, id) => s + info!.files[id]!.size * (mine.find((i) => i.id === id)?.progress ?? 1), 0)
  const pct = total ? Math.min(99, Math.floor((done / total) * 100)) : 0
  const offline = sending && !pending.some((i) => i.status === 'uploading')
  // every file was given up: nothing is attached any more
  const none = !sending && failed.length === 0 && dropped > 0 && arrived === 0
  const state = sending ? 'sending' : failed.length ? 'failed' : none ? 'none' : 'done'

  return (
    <SentContext.Provider value={show}>
      {children}
      {info && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="sent-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="flex max-h-[95dvh] w-full max-w-sm flex-col items-center gap-3 overflow-y-auto rounded-2xl bg-white p-6 text-center shadow-xl">
            <span
              className={`flex size-16 shrink-0 items-center justify-center rounded-full text-4xl ${{ sending: 'bg-blue-100', failed: 'bg-red-100', none: 'bg-amber-100', done: 'bg-green-100' }[state]}`}
              aria-hidden
            >
              {{ sending: '📤', failed: '⚠️', none: '📷', done: '✅' }[state]}
            </span>
            <h2 id="sent-title" className="text-xl font-bold">
              {{ sending: t('sent.titleSending'), failed: t('sent.titleFailed'), none: t('sent.titleNone'), done: t('sent.title') }[state]}
            </h2>
            <p className="font-bold text-slate-800">{info.kind}</p>
            {info.detail && <p className="text-slate-700">{info.detail}</p>}
            <p className="text-sm text-slate-600">{t('sent.time', { time: formatTokyoTime(info.at) })}</p>
            {state === 'sending' && (
              <div className="flex w-full flex-col gap-2 rounded-xl bg-blue-50 p-3 text-left" role="status">
                <p className="text-sm">{t('sent.recordArrived')}</p>
                <p className="font-bold text-blue-900">
                  {offline ? t('sent.filesWaiting', { done: arrived, n: counted.length }) : t('sent.filesSending', { done: arrived, n: counted.length, pct })}
                </p>
                <div className="h-3 overflow-hidden rounded-full bg-blue-100">
                  <div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="text-sm font-bold text-red-800">📱 {t('sent.keepOpen')}</p>
              </div>
            )}
            {state === 'failed' && (
              <div className="flex w-full flex-col gap-2 text-left">
                <p className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-900">
                  {t('sent.filesFailed', { n: failed.length })}
                  {arrived === 0 && <span className="mt-1 block">{t('sent.noneYet')}</span>}
                </p>
                <ul className="flex flex-col gap-2">
                  {failed.map((f) => (
                    <li key={f.id} className="flex flex-col gap-2 rounded-xl p-3 ring-1 ring-red-200">
                      <p className="text-sm">
                        <b className="break-all">
                          {f.kind === 'video' ? '🎥' : '📷'} {f.fileName}
                        </b>
                        <span className="block text-red-800">{t(`sent.reason.${failReason(f.error)}`)}</span>
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <Button variant="secondary" disabled={busy} onClick={() => pick(f.id)}>
                          {t('sent.pickOther')}
                        </Button>
                        <Button variant="secondary" disabled={busy} onClick={() => void discard(f.id)}>
                          {t('sent.dropOne')}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
                {failed.some((f) => failReason(f.error) === 'other') && (
                  <Button variant="secondary" disabled={busy} onClick={retry}>
                    {t('upload.retry')}
                  </Button>
                )}
              </div>
            )}
            {state === 'none' && <p className="rounded-xl bg-amber-50 p-3 text-left text-sm font-bold text-amber-900">{t('sent.noneBody')}</p>}
            {state === 'done' && (
              <>
                <p className="text-sm">{t('sent.body')}</p>
                {arrived > 0 && <p className="text-sm font-bold text-green-800">{t('sent.filesDone', { n: arrived })}</p>}
                {dropped > 0 && <p className="text-sm text-slate-600">{t('sent.filesDropped', { n: dropped })}</p>}
              </>
            )}
            {busy && <p className="text-sm text-slate-600">{t('attach.processing')}</p>}
            {pickError && <p className="text-sm font-bold text-red-800">{pickError}</p>}
            {state === 'sending' && warned && <p className="rounded-lg bg-amber-50 p-2 text-sm font-bold text-amber-900">⚠️ {t('sent.closeWarn')}</p>}
            {state === 'none' ? (
              <div className="flex w-full flex-col gap-2">
                <Button className="w-full" disabled={busy} onClick={() => pick(null)}>
                  📷 {t('sent.pickFiles')}
                </Button>
                <Button className="w-full" variant="secondary" disabled={busy} onClick={() => setInfo(null)}>
                  {t('sent.finishWithout')}
                </Button>
              </div>
            ) : (
              <Button
                className="w-full"
                variant={state === 'done' ? 'primary' : 'secondary'}
                disabled={busy}
                onClick={() => {
                  // the first tap while sending only warns; the upload goes on behind the dialog either way
                  if (state === 'sending' && !warned) setWarned(true)
                  else setInfo(null)
                }}
              >
                {state === 'sending' ? (warned ? t('sent.closeAnyway') : t('sent.close')) : state === 'failed' ? t('sent.later') : t('sent.ok')}
              </Button>
            )}
            <input ref={picker} type="file" hidden onChange={(e) => void onPicked(e.target.files).then(() => (e.target.value = ''))} />
          </div>
        </div>
      )}
    </SentContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useSentNotice = () => useContext(SentContext)
