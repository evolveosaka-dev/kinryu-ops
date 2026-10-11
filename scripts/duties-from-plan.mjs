// Load the 朝礼・巡回 duty plan of the patrol members from the 担当表 workbook (.xlsx), sheet
// ⑦日別スケジュール (調整後 = the original shifts plus the ②案 extensions). Prints SQL that
//   1. replaces public.duty_assignments for the chosen dates (shown to each member on ホーム), and
//   2. extends the shifts in public.shift_assignments where a ②案 row works past the shift end.
// Names never go into the repository:
//
//   node scripts/duties-from-plan.mjs "<担当表>.xlsx" 2026-10-12 2026-10-19 > duties.sql
//   npx supabase db query --linked -f duties.sql
//
// Re-importing the month's shift workbook (設定 → シフト表の読み込み) resets the extended
// shifts; run this again afterwards. Requires `unzip` on PATH (Git for Windows ships it).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SHEET = '⑦日別スケジュール'
const STORES = { 御堂筋店: { code: 'midosuji', mark: '①' }, 千日前店: { code: 'sennichimae', mark: '⑤' } }
const SHIFTS = { 早番: 'early', 中番: 'middle', 遅番: 'late' }
const SHIFT_RANGE = { early: [420, 1020], middle: [1020, 1380], late: [1380, 1860] }
const KINDS = { 朝礼: 'chorei', 巡回: 'patrol' }

const [file, from = '0000-01-01', to = '9999-12-31'] = process.argv.slice(2)
if (!file) {
  console.error('usage: node scripts/duties-from-plan.mjs <担当表.xlsx> [from YYYY-MM-DD] [to YYYY-MM-DD]')
  process.exit(1)
}

const fail = (msg) => {
  throw new Error(msg)
}
const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const serialToDate = (v) => new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 86400000).toISOString().slice(0, 10)
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const dayDiff = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000)
const hm = (h, m) => Number(h) * 60 + Number(m)
const esc = (s) => s.replace(/'/g, "''")
const hours = (min) => String((min % 1440) / 60)

/** "早番 御堂筋店 7:00-17:30＋30分延長（案）", "遅番 千日前店 23:00-7:00（10/16）＋…" → own shift */
function parseOwn(text, rowDate) {
  const m = /^(早番|中番|遅番)\s+(御堂筋店|千日前店)\s+(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})(?:（(\d{1,2})\/(\d{1,2})）)?/.exec(text)
  if (!m) fail(`担当の勤務 not understood: ${text}`)
  const date = m[7] ? `${rowDate.slice(0, 4)}-${m[7].padStart(2, '0')}-${m[8].padStart(2, '0')}` : rowDate
  const start = hm(m[3], m[4])
  let end = hm(m[5], m[6])
  if (end <= start) end += 1440
  return { shift: SHIFTS[m[1]], store: STORES[m[2]], date, start, end }
}

function methodOf(text) {
  if (text.startsWith('【案】')) return 'extend'
  if (text.startsWith('出勤時')) return 'arrival'
  if (text.startsWith('17時をまたぐ') || text.startsWith('17:30まで')) return 'continue'
  if (text.includes('移動して')) return 'move'
  if (text.startsWith('勤務店舗') || text.startsWith('自分のシフト')) return 'own'
  return fail(`方法 not understood: ${text}`)
}

const dir = mkdtempSync(join(tmpdir(), 'duties-'))
try {
  // files saved by other tools (openpyxl) may have no sharedStrings.xml: strings are inline then
  execFileSync('unzip', ['-o', '-q', file, '-d', dir])
  const read = (p) => readFileSync(join(dir, p), 'utf8')
  const shared = existsSync(join(dir, 'xl/sharedStrings.xml')) ? read('xl/sharedStrings.xml') : ''
  const strings = [...shared.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '').matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((x) => decode(x[1])).join(''),
  )
  const workbook = read('xl/workbook.xml')
  const rels = read('xl/_rels/workbook.xml.rels')
  const rid = [...workbook.matchAll(/<sheet [^>]*>/g)].map((m) => m[0]).find((s) => decode(/name="([^"]+)"/.exec(s)?.[1] ?? '') === SHEET)
  const target = rid && new RegExp(`Id="${/r:id="([^"]+)"/.exec(rid)[1]}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${/r:id="([^"]+)"/.exec(rid)[1]}"`).exec(rels)
  if (!target) fail(`sheet not found: ${SHEET}`)
  const sheetXml = read(`xl/${(target[1] ?? target[2] ?? target[3]).replace(/^\/?xl\//, '')}`)

  const rows = {}
  for (const [, r, body] of sheetXml.matchAll(/<row [^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    for (const [, col, attrs, inner] of body.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const t = /<t[^>]*>([^<]*)<\/t>/.exec(inner ?? '')?.[1] // inline strings
      const v = /<v>([^<]*)<\/v>/.exec(inner ?? '')?.[1]
      const value = /t="s"/.test(attrs) ? strings[Number(v)] : t !== undefined ? decode(t) : v !== undefined ? decode(v) : undefined
      if (value !== undefined) (rows[r] ??= {})[col] = value.trim()
    }
  }
  const header = rows['4'] ?? {}
  if (header.C !== '担当' || header.E !== '活動' || header.H !== '時刻' || header.L !== '区分') fail(`unexpected header in ${SHEET}`)

  const duties = []
  const extensions = new Map() // own shift key → { own, roster, end }
  const seen = new Set()
  for (const [r, c] of Object.entries(rows)) {
    if (Number(r) < 5 || !/^\d{5}(\.0+)?$/.test(c.A ?? '')) continue
    const date = serialToDate(c.A)
    if (date < from || date > to) continue
    const roster = c.C
    const kind = KINDS[c.E] ?? fail(`活動 not understood: ${c.E}`)
    const store = STORES[c.F] ?? fail(`店舗 not understood: ${c.F}`)
    const shift = SHIFTS[c.G] ?? fail(`勤番 not understood: ${c.G}`)
    const own = parseOwn(c.D, date)
    const method = methodOf(c.J ?? '')
    const isPlan = (c.L ?? '').startsWith('案')
    // minutes from 00:00 of this row's business date; 遅番 times after midnight belong to the next day
    const at = (h, m) => hm(h, m) + (shift === 'late' && hm(h, m) < 720 ? 1440 : 0)

    let mode, start, end
    let m
    if ((m = /^(\d{1,2}):(\d{2})$/.exec(c.H))) [mode, start, end] = ['at', at(m[1], m[2]), at(m[1], m[2]) + 30]
    else if ((m = /^(\d{1,2}):(\d{2})ごろ$/.exec(c.H))) [mode, start, end] = ['about', at(m[1], m[2]), at(m[1], m[2]) + 30]
    else if ((m = /^(\d{1,2}):(\d{2})〜(\d{1,2}):(\d{2})$/.exec(c.H))) [mode, start, end] = ['range', at(m[1], m[2]), at(m[3], m[4])]
    else if (c.H.startsWith('勤務中')) {
      const offset = dayDiff(date, own.date) * 1440
      const [s0, s1] = SHIFT_RANGE[shift]
      ;[mode, start, end] = ['during', Math.max(s0, own.start - offset), Math.min(s1, own.end - offset)]
    } else fail(`時刻 not understood: ${c.H}`)
    if (!(end > start)) fail(`empty time window on row ${r}`)

    const key = [date, shift, store.code, roster, kind].join('|')
    if (seen.has(key)) fail(`duplicate duty: ${key}`)
    seen.add(key)
    duties.push({ date, shift, store, roster, kind, mode, start, end, method, isPlan, staff: c.K ?? null })

    if (isPlan) {
      // work until the end of the ②案 duty: convert to minutes of the own shift's business date
      const ownEnd = end + dayDiff(date, own.date) * 1440
      const k = [roster, own.date, own.shift].join('|')
      if (ownEnd > own.end && ownEnd > (extensions.get(k)?.end ?? 0)) extensions.set(k, { own, roster, end: ownEnd })
    }
  }
  if (!duties.length) fail(`no rows between ${from} and ${to}`)

  const sqlStr = (s) => (s == null ? 'null' : `'${esc(s)}'`)
  const values = duties
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start || a.roster.localeCompare(b.roster, 'ja'))
    .map(
      (d) =>
        `  ('${d.date}', '${d.shift}', (select id from public.stores where code = '${d.store.code}'), '${esc(d.roster)}', '${d.kind}', '${d.mode}', ${d.start}, ${d.end}, '${d.method}', ${d.isPlan}, ${sqlStr(d.staff)})`,
    )
  const updates = [...extensions.values()].map(
    ({ own, roster, end }) =>
      `update public.shift_assignments set end_min = ${end}, raw = '${own.store.mark}${hours(own.start)}-${hours(end)}'\n` +
      ` where roster_name = '${esc(roster)}' and business_date = '${own.date}' and shift = '${own.shift}' and end_min in (${own.end}, ${end});`,
  )
  const period = `business_date between '${from === '0000-01-01' ? duties[0].date : from}' and '${to === '9999-12-31' ? duties.at(-1).date : to}'`

  console.log(`-- generated from ${SHEET}: ${duties.length} duties, ${updates.length} extended shifts
begin;
delete from public.duty_assignments where ${period};
insert into public.duty_assignments
  (business_date, shift, store_id, roster_name, kind, time_mode, start_min, end_min, method, is_plan, staff)
values
${values.join(',\n')};
${updates.join('\n')}
commit;
select roster_name, kind, count(*) as duties from public.duty_assignments where ${period} group by 1, 2 order by 1, 2;
select roster_name, business_date, shift, raw from public.shift_assignments
 where (roster_name, business_date, shift) in (${[...extensions.values()].map(({ own, roster }) => `('${esc(roster)}', '${own.date}'::date, '${own.shift}')`).join(', ') || "(null, null::date, null)"})
 order by business_date;`)
  console.error(`duties: ${duties.length} rows (${from} – ${to}); extended shifts: ${[...extensions.values()].map(({ own, roster, end }) => `${roster} ${own.date} ${own.shift} → ${hours(end)}:00`).join(', ') || 'none'}`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
