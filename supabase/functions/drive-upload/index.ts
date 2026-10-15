// Creates a Google Drive resumable upload session for a photo/video of a 朝礼 or 巡回 record.
// The browser then uploads the bytes directly to Google and calls "finish".
//
// POST { action: 'start', parentType, parentId, kind, fileName, mimeType, size, durationSec? }
//   → { attachmentId, uploadUrl }
// POST { action: 'finish', attachmentId, fileId } → { driveUrl }
// POST { action: 'fail', attachmentId } → { ok }
import { clearFolderCache, ensureFolder, google, googleToken } from '../_shared/google.ts'
import { adminClient, appOrigin, HttpError, requireUser, serve } from '../_shared/http.ts'

const SHIFT_JA: Record<string, string> = { early: '早番', middle: '中番', late: '遅番' }
const MAX_VIDEO_BYTES = 150 * 1024 * 1024
const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const MAX_VIDEO_SEC = 90

interface StartBody {
  action: 'start'
  /** miss = a 朝礼できなかった report (chorei_misses), files added by a manager; stock = a 廃棄・破損 row (stock_events) */
  parentType: 'chorei' | 'patrol' | 'miss' | 'stock' | 'incident' | 'lost_found' | 'lost_return'
  parentId: string
  kind: 'image' | 'video'
  fileName: string
  mimeType: string
  size: number
  durationSec?: number | null
}

serve(async (req) => {
  const admin = adminClient()
  const caller = await requireUser(req, admin)
  const body = await req.json()

  if (body.action === 'start') {
    const b = body as StartBody
    if (caller.isTestAccount) throw new HttpError(403, 'test account: files are not uploaded')
    if (!['chorei', 'patrol', 'miss', 'stock', 'incident', 'lost_found', 'lost_return'].includes(b.parentType)) throw new HttpError(400, 'bad parentType')
    if (b.kind === 'image' && (!b.mimeType.startsWith('image/') || b.size > MAX_IMAGE_BYTES)) throw new HttpError(400, 'bad image')
    if (b.kind === 'video') {
      if (!b.mimeType.startsWith('video/')) throw new HttpError(400, 'bad video')
      if (b.size > MAX_VIDEO_BYTES) throw new HttpError(413, 'video too large')
      if ((b.durationSec ?? 0) > MAX_VIDEO_SEC + 1) throw new HttpError(413, 'video too long')
    }
    const origin = appOrigin(req)
    if (!origin) throw new HttpError(403, 'origin not allowed')

    // The parent record must be the caller's own (leader / patroller / reporter), or the caller is a manager.
    // Lost items are shared: whoever finds or returns one adds the photos.
    const lost = b.parentType === 'lost_found' || b.parentType === 'lost_return'
    const table = { chorei: 'chorei_records', patrol: 'patrol_checks', miss: 'chorei_misses', stock: 'stock_events', incident: 'incidents', lost_found: 'lost_items', lost_return: 'lost_items' }[b.parentType]
    const ownerCol = { chorei: 'leader_id', patrol: 'patroller_id', miss: 'reporter_id', stock: 'author_id', incident: 'reporter_id', lost_found: 'reporter_id', lost_return: 'reporter_id' }[b.parentType]
    const extra = b.parentType === 'miss' || b.parentType === 'incident' || lost ? '' : b.parentType === 'stock' ? 'voided_at, kind, ' : 'status, '
    const { data: parent } = await admin
      .from(table)
      .select(`id, ${ownerCol}, business_date, shift, ${extra}store:stores(name_ja)`)
      .eq('id', b.parentId)
      .maybeSingle()
    const p = parent as Record<string, unknown> | null
    if (!p || p.status === 'void' || p.voided_at || (b.parentType === 'stock' && p.kind !== 'loss')) throw new HttpError(404, 'record not found')
    if (!caller.isManager && !lost && (parent as Record<string, unknown>)[ownerCol] !== caller.id) throw new HttpError(403, 'not your record')

    const { data: row, error } = await admin
      .from('attachments')
      .insert({
        owner_id: caller.id,
        chorei_id: b.parentType === 'chorei' ? b.parentId : null,
        patrol_id: b.parentType === 'patrol' ? b.parentId : null,
        miss_id: b.parentType === 'miss' ? b.parentId : null,
        stock_event_id: b.parentType === 'stock' ? b.parentId : null,
        incident_id: b.parentType === 'incident' ? b.parentId : null,
        lost_item_id: lost ? b.parentId : null,
        phase: b.parentType === 'lost_found' ? 'found' : b.parentType === 'lost_return' ? 'return' : null,
        kind: b.kind,
        file_name: b.fileName.slice(0, 200),
        mime_type: b.mimeType,
        size_bytes: b.size,
        duration_sec: b.durationSec ?? null,
      })
      .select('id')
      .single()
    if (error) throw new HttpError(error.code === '23514' ? 409 : 400, error.message)

    // many-to-one embed: an object at runtime (typed loosely by supabase-js)
    const embedded = parent.store as unknown as { name_ja: string } | { name_ja: string }[] | null
    const store = (Array.isArray(embedded) ? embedded[0] : embedded)?.name_ja ?? 'store'
    const date = parent.business_date as string
    const folderPath = [date.slice(0, 7), store, b.parentType === 'patrol' ? '巡回' : b.parentType === 'stock' ? '在庫' : b.parentType === 'incident' ? 'クレーム・事故' : lost ? '忘れ物' : '朝礼']
    const ext = b.fileName.includes('.') ? b.fileName.slice(b.fileName.lastIndexOf('.')).toLowerCase() : ''
    const driveName = `${date}_${SHIFT_JA[parent.shift as string] ?? parent.shift}_${{ chorei: '朝礼', patrol: '巡回', miss: '朝礼なし', stock: '廃棄・破損', incident: 'クレーム・事故', lost_found: '忘れ物', lost_return: '忘れ物_返却' }[b.parentType]}_${row.id.slice(0, 8)}${ext}`

    const createSession = async (folderId: string) =>
      fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await googleToken()}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': b.mimeType,
          'X-Upload-Content-Length': String(b.size),
          // lets the browser at this origin PUT the bytes to the session URL (CORS)
          Origin: origin,
        },
        body: JSON.stringify({ name: driveName, parents: [folderId], description: `attachment ${row.id}` }),
      })

    let folderId = await ensureFolder(admin, folderPath)
    let session = await createSession(folderId)
    if (session.status === 404) {
      // a cached folder was deleted in Drive
      await clearFolderCache(admin)
      folderId = await ensureFolder(admin, folderPath)
      session = await createSession(folderId)
    }
    const uploadUrl = session.headers.get('Location')
    if (!session.ok || !uploadUrl) {
      await admin.from('attachments').update({ status: 'failed' }).eq('id', row.id)
      throw new HttpError(502, `drive session ${session.status}: ${await session.text()}`)
    }
    await admin.from('attachments').update({ drive_folder_id: folderId }).eq('id', row.id)
    return { attachmentId: row.id, uploadUrl }
  }

  if (body.action === 'finish' || body.action === 'fail') {
    const { data: att } = await admin.from('attachments').select('*').eq('id', body.attachmentId).maybeSingle()
    if (!att || (att.owner_id !== caller.id && !caller.isManager)) throw new HttpError(404, 'attachment not found')
    if (body.action === 'fail') {
      if (att.status === 'pending') await admin.from('attachments').update({ status: 'failed' }).eq('id', att.id)
      return { ok: true }
    }
    // Trust nothing from the client: the file must exist in the expected folder.
    const file = await google<{ id: string; parents?: string[]; size?: string; webViewLink: string }>(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(body.fileId)}?fields=id,parents,size,webViewLink`,
    )
    if (!file.parents?.includes(att.drive_folder_id)) throw new HttpError(400, 'file is not in the expected folder')
    const { error } = await admin
      .from('attachments')
      .update({ status: 'uploaded', drive_file_id: file.id, drive_url: file.webViewLink, size_bytes: Number(file.size ?? att.size_bytes) })
      .eq('id', att.id)
    if (error) throw new HttpError(500, error.message)
    return { driveUrl: file.webViewLink }
  }

  throw new HttpError(400, 'unknown action')
})
