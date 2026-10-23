// シフト表の自動取り込み: downloads the workbook shared from Office 365 (app_kv shift_workbook_url), reads the
// 早番 / 中番 / 遅番 sheets and imports the month through apply_shift_import (which keeps the list of changes).
// The link may be one file (:x:) or a folder (:f:, owner 2026-10-23): for a folder, this month's and next month's
// 「金龍YYYY年M月シフト.xlsm」 are looked up by name (in YYYY年/YYYY年M月/, YYYY年M月/ or the folder itself) and both
// are imported, so the link need not change every month and next month's table is in the app before it starts.
// The 販売杯数 workbook (app_kv sales_workbook_url) is read in the same run → apply_sales_import (daily_sales);
// each part has its own status, so one failing does not stop the other. Files are only downloaded, never changed.
// Daily at 6:00 JST via pg_cron (x-cron-secret), or by a manager (今すぐ取り込む).
import { strFromU8, unzipSync } from 'npm:fflate@0.8.2'
import { kvGet, kvSet } from '../_shared/google.ts'
import { adminClient, env, HttpError, requireUser, serve } from '../_shared/http.ts'
import { EXTRA_SHEETS, extractPayrollSource, PAY_SHEETS } from '../_shared/payrollWorkbook.ts'
import { parseSalesSheet, SALES_SHEET } from '../_shared/salesWorkbook.ts'
import { parseSharedStrings, parseWorkbook, sheetPaths, SHIFT_SHEETS } from '../_shared/shiftWorkbook.ts'

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

interface Folder {
  origin: string
  /** /personal/<user> or /sites/<name> */
  site: string
  /** server-relative path of the shared folder */
  path: string
  cookie: string
}

/** A folder share link → its server-relative path and the cookies (FedAuth) that let the REST API read inside it. */
async function openFolder(shareUrl: string): Promise<Folder> {
  let url = shareUrl
  const cookies = new Map<string, string>()
  for (let hop = 0; hop < 8; hop++) {
    const res = await fetch(url, { redirect: 'manual', headers: cookies.size ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {} })
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';')
      const i = pair!.indexOf('=')
      if (i > 0) cookies.set(pair!.slice(0, i).trim(), pair!.slice(i + 1).trim())
    }
    const next = res.headers.get('location')
    await res.body?.cancel()
    if (res.status >= 300 && res.status < 400 && next) {
      url = new URL(next, url).toString()
      continue
    }
    if (!res.ok) throw new HttpError(502, `folder link failed: HTTP ${res.status}`)
    const u = new URL(url)
    const path = u.searchParams.get('id')
    if (!path) throw new HttpError(502, 'folder link: no folder found (link expired or not shared?)')
    return { origin: u.origin, site: path.split('/').slice(0, 3).join('/'), path, cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') }
  }
  throw new HttpError(502, 'folder link: too many redirects')
}

const enc = (path: string) => path.split('/').map((p) => encodeURIComponent(p).replace(/'/g, "''")).join('/')
const rest = (f: Folder, call: string) => fetch(`${f.origin}${f.site}/_api/web/${call}`, { headers: { Cookie: f.cookie, Accept: 'application/json;odata=nometadata' } })
const halfWidth = (s: string) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))

/** 「金龍YYYY年M月シフト.xlsm」 of a month inside the shared folder (server-relative path), or null. */
async function findMonthFile(f: Folder, month: string): Promise<string | null> {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7))
  for (const dir of [`${f.path}/${y}年/${y}年${m}月`, `${f.path}/${y}年${m}月`, f.path]) {
    const res = await rest(f, `GetFolderByServerRelativeUrl('${enc(dir)}')/Files`)
    if (!res.ok) {
      await res.body?.cancel()
      continue
    }
    const files = ((await res.json()) as { value?: { Name: string; ServerRelativeUrl: string }[] }).value ?? []
    const hit = files.find((x) => {
      const n = halfWidth(x.Name).match(/^金龍\s*(\d{4})年\s*(\d{1,2})月シフト\.(xlsm|xlsx)$/)
      return n && Number(n[1]) === y && Number(n[2]) === m
    })
    if (hit) return hit.ServerRelativeUrl
  }
  return null
}

async function downloadFromFolder(f: Folder, path: string): Promise<Uint8Array> {
  const res = await rest(f, `GetFileByServerRelativeUrl('${enc(path)}')/$value`)
  if (!res.ok) throw new HttpError(502, `download failed: HTTP ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new HttpError(502, 'download is not an Excel file')
  return bytes
}

/** Tokyo month (YYYY-MM-01) of now, shifted by n months. */
const tokyoMonth = (n = 0) => {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 8) + '01'
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

/** 販売杯数: the ★拝数入力シート figures since 2025 → daily_sales; result in app_kv sales_sync_status. */
async function syncSales(admin: ReturnType<typeof adminClient>, at: string) {
  try {
    const url = await kvGet(admin, 'sales_workbook_url')
    if (!url) return null
    const bytes = await download(url)
    const base = unzipSync(bytes, { filter: (f) => ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml'].includes(f.name) })
    const text = (name: string, files: Record<string, Uint8Array>) => (files[name] ? strFromU8(files[name]!) : '')
    const path = sheetPaths(text('xl/workbook.xml', base), text('xl/_rels/workbook.xml.rels', base))[SALES_SHEET]
    if (!path) throw new HttpError(422, `missing sheet: ${SALES_SHEET}`)
    const sheet = text(path, unzipSync(bytes, { filter: (f) => f.name === path }))
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
    const parsed = parseSalesSheet(sheet, parseSharedStrings(text('xl/sharedStrings.xml', base)), '2025-01-01', today)
    if (parsed.columns !== 6) throw new HttpError(422, `the sheet has ${parsed.columns} of the 6 columns ⑤早番…①遅番`)
    const { data, error } = await admin.rpc('apply_sales_import', { p_rows: parsed.rows })
    if (error) throw new HttpError(500, error.message)
    const last = parsed.rows.at(-1)?.date ?? null
    const result = { at, ok: true, last, ...(data as Record<string, unknown>) }
    await kvSet(admin, 'sales_sync_status', JSON.stringify(result))
    return result
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 300)
    console.error('sales sync', err)
    await kvSet(admin, 'sales_sync_status', JSON.stringify({ at, ok: false, error: message }))
    return { ok: false, error: message }
  }
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
  const sales = await syncSales(admin, at)
  try {
    const url = await kvGet(admin, 'shift_workbook_url')
    if (!url) throw new HttpError(400, 'no share link set')
    if (!/\/:f:\//.test(url)) {
      // one file
      const one = await importBook(admin, await download(url), by, null)
      const result = { at, ok: true, ...one, months: [{ ok: true, found: true, ...one }] }
      await kvSet(admin, 'shift_sync_status', JSON.stringify(result))
      return { ...result, sales }
    }
    // a folder: this month and next month, each on its own (next month may not exist yet)
    const folder = await openFolder(url)
    const months: MonthResult[] = []
    for (const month of [tokyoMonth(0), tokyoMonth(1)]) {
      try {
        const file = await findMonthFile(folder, month)
        if (!file) {
          months.push({ month, ok: month !== tokyoMonth(0), found: false })
          continue
        }
        months.push({ ok: true, found: true, file: file.split('/').pop(), ...(await importBook(admin, await downloadFromFolder(folder, file), by, month)) })
      } catch (err) {
        console.error('shift month', month, err)
        months.push({ month, ok: false, found: true, error: (err instanceof Error ? err.message : String(err)).slice(0, 200) })
      }
    }
    const cur = months[0]!
    const result = {
      at,
      ok: months.every((m) => m.ok),
      month: cur.month,
      rows: months.reduce((a, m) => a + (m.rows ?? 0), 0),
      changes: months.reduce((a, m) => a + (m.changes ?? 0), 0),
      payroll: cur.payroll,
      ...(months.every((m) => m.ok) ? {} : { error: months.filter((m) => !m.ok).map((m) => `${m.month.slice(0, 7)}: ${m.error ?? 'file not found'}`).join(' / ') }),
      months,
    }
    await kvSet(admin, 'shift_sync_status', JSON.stringify(result))
    return { ...result, sales }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await kvSet(admin, 'shift_sync_status', JSON.stringify({ at, ok: false, error: message.slice(0, 300) }))
    throw err
  }
})

interface MonthResult {
  month: string
  ok: boolean
  found: boolean
  file?: string
  rows?: number
  changes?: number
  payroll?: string
  error?: string
}

/** Imports one monthly workbook (shifts + the payroll sheets); `expect` = the month its file name says. */
async function importBook(admin: ReturnType<typeof adminClient>, bytes: Uint8Array, by: string | null, expect: string | null) {
  const book = readWorkbook(bytes)
  const wb = book.shifts
  if (!wb.month || wb.rows.length === 0) throw new HttpError(422, 'no shifts found in the workbook')
  if (wb.missingSheets.length) throw new HttpError(422, `missing sheets: ${wb.missingSheets.join(', ')}`)
  if (expect && wb.month !== expect) throw new HttpError(422, `the workbook is for ${wb.month.slice(0, 7)}, not ${expect.slice(0, 7)}`)
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
  return { month: wb.month, rows: data.rows as number, changes: data.changes as number, payroll }
}
