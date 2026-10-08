// Build the staff roster (names + main store) from the monthly shift workbook (.xlsm).
// Reads sheets 早番 / 中番 / 遅番 (names in row 4, cells like "①7-17": ① 御堂筋店, ⑤ 千日前店)
// and prints SQL that upserts public.staff_roster. Names never go into the repository:
//
//   node scripts/roster-from-shift.mjs "<path>.xlsm" > roster.sql
//   npx supabase db query --linked -f roster.sql
//
// Requires `unzip` on PATH (Git for Windows ships it).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const STORE_BY_MARK = { '①': 'midosuji', '⑤': 'sennichimae' }
const SHIFT_SHEETS = ['早番', '中番', '遅番']
const NOT_NAMES = new Set(['日', '研修', '0', '⇒', '出勤人数', '必要人数', '備考', '過不足'])

const file = process.argv[2]
if (!file) {
  console.error('usage: node scripts/roster-from-shift.mjs <workbook.xlsm>')
  process.exit(1)
}

const dir = mkdtempSync(join(tmpdir(), 'roster-'))
try {
  execFileSync('unzip', ['-o', '-q', file, 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml', 'xl/worksheets/*', '-d', dir])
  const read = (p) => readFileSync(join(dir, p), 'utf8')

  const strings = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '').matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((x) => x[1]).join(''),
  )
  const workbook = read('xl/workbook.xml')
  const rels = read('xl/_rels/workbook.xml.rels')
  const sheetFile = (name) => {
    const rid = new RegExp(`<sheet [^>]*name="${name}"[^>]*r:id="([^"]+)"`).exec(workbook)?.[1]
    const target = new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1]
    if (!target) throw new Error(`sheet not found: ${name}`)
    return `xl/${target.replace(/^\/?xl\//, '')}`
  }
  /** rows[rowNumber][column] = value */
  const cells = (path) => {
    const rows = {}
    for (const [, r, body] of read(path).matchAll(/<row [^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      for (const [, col, attrs, inner] of body.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const v = /<v>([^<]*)<\/v>/.exec(inner ?? '')?.[1]
        if (v === undefined) continue
        ;(rows[r] ??= {})[col] = /t="s"/.test(attrs) ? strings[Number(v)] : v
      }
    }
    return rows
  }

  const counts = new Map() // name -> { midosuji, sennichimae }
  for (const sheet of SHIFT_SHEETS) {
    const rows = cells(sheetFile(sheet))
    const header = rows['4'] ?? {}
    const nameCols = Object.entries(header).filter(([col, v]) => col !== 'B' && v && !NOT_NAMES.has(v.trim()) && /^[^\d\s]/.test(v) && v.length <= 12)
    for (const [col, raw] of nameCols) {
      const name = raw.trim()
      if (!/^[\p{Script=Katakana}\p{Script=Han}ー・ァ-ヶ]+$/u.test(name)) continue
      const c = counts.get(name) ?? { midosuji: 0, sennichimae: 0 }
      for (let r = 5; r <= 40; r++) {
        const store = STORE_BY_MARK[(rows[String(r)]?.[col] ?? '').trim().charAt(0)]
        if (store) c[store]++
      }
      counts.set(name, c)
    }
  }

  const esc = (s) => s.replace(/'/g, "''")
  const values = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'ja'))
    .map(([name, c]) => {
      const store = c.midosuji === 0 && c.sennichimae === 0 ? 'null' : `(select id from public.stores where code = '${c.midosuji >= c.sennichimae ? 'midosuji' : 'sennichimae'}')`
      return `  ('${esc(name)}', ${store})`
    })
  console.log(`-- generated from the shift workbook: ${values.length} staff\ninsert into public.staff_roster (name, home_store_id) values\n${values.join(',\n')}\non conflict (name) do update set home_store_id = coalesce(excluded.home_store_id, public.staff_roster.home_store_id), active = true;`)
  console.error(`roster: ${values.length} names`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
