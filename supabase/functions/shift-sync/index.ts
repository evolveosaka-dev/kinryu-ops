// シフト表の自動取り込み: downloads the workbook shared from Office 365 (app_kv shift_workbook_url), reads the
// 早番 / 中番 / 遅番 sheets and imports the month through apply_shift_import (which keeps the list of changes).
// Daily at 6:00 JST via pg_cron (x-cron-secret), or by a manager (今すぐ取り込む).
import { strFromU8, unzipSync } from 'npm:fflate@0.8.2'
import { kvGet, kvSet } from '../_shared/google.ts'
import { adminClient, env, HttpError, requireUser, serve } from '../_shared/http.ts'
import { EXTRA_SHEETS, extractPayrollSource, PAY_SHEETS } from '../_shared/payrollWorkbook.ts'
import { parseWorkbook, sheetPaths, SHIFT_SHEETS } from '../_shared/shiftWorkbook.ts'

/** A OneDrive / SharePoint share link → the file bytes. The link answers with a redirect that sets the cookie
 *  (FedAuth) the download needs, so redirects are followed by hand, carrying the cookies. */
async function download(shareUrl: string): Promise<Uint8Array> {
  const u = new URL(shareUrl)
  u.searchParams.set('download', '1')
  let url = u.toString()
  const cookies = new Map<string, string>()
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(url, {
      redirect: 'manual',
      headers: cookies.size ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {},
    })
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';')
      const i = pair!.indexOf('=')
      if (i > 0) cookies.set(pair!.slice(0, i).trim(), pair!.slice(i + 1).trim())
    }
    const next = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && next) {
      await res.body?.cancel()
      url = new URL(next, url).toString()
      continue
    }
    if (!res.ok) throw new HttpError(502, `download failed: HTTP ${res.status}`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new HttpError(502, 'download is not an Excel file (link expired or not shared?)')
    return bytes
  }
  throw new HttpError(502, 'download failed: too many redirects')
}

/** The shift sheets (→ shift_assignments) and the sheets the payroll reads (→ payroll_sources). */
function readWorkbook(bytes: Uint8Array) {
  const base = unzipSync(bytes, { filter: (f) => ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml'].includes(f.name) })
  const text = (name: string, files: Record<string, Uint8Array>) => (files[name] ? strFromU8(files[name]!) : '')
  const paths = sheetPaths(text('xl/workbook.xml', base), text('xl/_rels/workbook.xml.rels', base))
  const names = [...Object.values(SHIFT_SHEETS), ...Object.values(PAY_SHEETS).map((p) => p.kintai), ...EXTRA_SHEETS]
  const wanted = new Set(names.flatMap((n) => (paths[n] ? [paths[n]!] : [])))
  const sheetFiles = unzipSync(bytes, { filter: (f) => wanted.has(f.name) })
  const sheets: Record<string, string> = {}
  for (const name of names) if (paths[name]) sheets[name] = text(paths[name]!, sheetFiles)
  const sharedStrings = text('xl/sharedStrings.xml', base)
  return { shifts: parseWorkbook({ sharedStrings, sheets }), sharedStrings, sheets }
}

serve(async (req) => {
  const admin = adminClient()
  const cronSecret = req.headers.get('x-cron-secret')
  let by: string | null = null
  if (cronSecret) {
    if (cronSecret !== env('SHEETS_SYNC_SECRET')) throw new HttpError(401, 'bad cron secret')
  } else {
    const caller = await requireUser(req, admin)
    if (!caller.isManager) throw new HttpError(403, 'managers only')
    if (caller.isTestAccount) throw new HttpError(403, 'test account: read only')
    by = caller.id
  }
  const at = new Date().toISOString()
  try {
    const url = await kvGet(admin, 'shift_workbook_url')
    if (!url) throw new HttpError(400, 'no share link set')
    const book = readWorkbook(await download(url))
    const wb = book.shifts
    if (!wb.month || wb.rows.length === 0) throw new HttpError(422, 'no shifts found in the workbook')
    if (wb.missingSheets.length) throw new HttpError(422, `missing sheets: ${wb.missingSheets.join(', ')}`)
    // refuse a workbook that lost most of the month (half-saved file, wrong sheet)
    const { data: last } = await admin.from('shift_import_log').select('rows').eq('month', wb.month).order('imported_at', { ascending: false }).limit(1).maybeSingle()
    const before = Array.isArray(last?.rows) ? last.rows.length : 0
    if (before > 0 && wb.rows.length < before / 2) throw new HttpError(422, `only ${wb.rows.length} shifts (before: ${before}); not imported`)
    const { data, error } = await admin.rpc('apply_shift_import', { p_month: wb.month, p_rows: wb.rows, p_source: 'office365', p_by: by })
    if (error) throw new HttpError(500, error.message)
    // 給与計算の元データ (System Admin only); a problem here does not stop the shift import
    let payroll: string = 'ok'
    try {
      const pay = extractPayrollSource({ sharedStrings: book.sharedStrings, sheets: book.sheets })
      const { error: pe } = await admin.from('payroll_sources').upsert({ month: pay.month, data: pay, source: 'office365', imported_at: new Date().toISOString() })
      if (pe) throw new Error(pe.message)
    } catch (err) {
      payroll = (err instanceof Error ? err.message : String(err)).slice(0, 200)
      console.error('payroll source', err)
    }
    const result = { at, ok: true, month: wb.month, rows: data.rows as number, changes: data.changes as number, payroll }
    await kvSet(admin, 'shift_sync_status', JSON.stringify(result))
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await kvSet(admin, 'shift_sync_status', JSON.stringify({ at, ok: false, error: message.slice(0, 300) }))
    throw err
  }
})
