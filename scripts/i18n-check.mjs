// Fails when a key exists in `ja` (source of truth) but not in another locale.
// Staff namespaces must be complete in all locales; manager screens ship in ja + en first.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', 'src', 'locales')
const STAFF_LOCALES = ['en', 'vi', 'si', 'ne']
const MANAGER_LOCALES = ['en']

const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  )

const load = (locale, ns) => {
  try {
    return JSON.parse(readFileSync(join(ROOT, locale, `${ns}.json`), 'utf8'))
  } catch {
    return {}
  }
}

let missing = 0
for (const file of readdirSync(join(ROOT, 'ja'))) {
  const ns = file.replace(/\.json$/, '')
  const sourceKeys = flatten(load('ja', ns))
  const locales = ns === 'manager' ? MANAGER_LOCALES : STAFF_LOCALES
  for (const locale of locales) {
    const keys = new Set(flatten(load(locale, ns)))
    for (const key of sourceKeys) {
      if (!keys.has(key)) {
        console.error(`missing ${locale}/${ns}: ${key}`)
        missing++
      }
    }
  }
}

if (missing > 0) {
  console.error(`\n${missing} missing translation(s)`)
  process.exit(1)
}
console.log('i18n: all keys present')
