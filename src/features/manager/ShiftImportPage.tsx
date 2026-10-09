import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { strFromU8, unzipSync } from 'fflate'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../components/Toast'
import { Button, Card, ErrorBox, PageTitle } from '../../components/ui'
import { parseWorkbook, sheetPaths, SHIFT_SHEETS, type ImportedRow } from '../../domain/shiftImport'
import { SHIFTS } from '../../domain/types'
import { errorMessage } from '../../lib/format'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { ManagerTabs } from './ManagerTabs'

interface Parsed {
  fileName: string
  month: string
  rows: ImportedRow[]
  missingSheets: string[]
}

/** Read only the 早番 / 中番 / 遅番 sheets in the browser — the file itself is never uploaded. */
async function readWorkbook(file: File): Promise<Parsed> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const base = unzipSync(bytes, { filter: (f) => ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml'].includes(f.name) })
  const text = (name: string, files: Record<string, Uint8Array>) => (files[name] ? strFromU8(files[name]) : '')
  const paths = sheetPaths(text('xl/workbook.xml', base), text('xl/_rels/workbook.xml.rels', base))
  const wanted = new Set(Object.values(SHIFT_SHEETS).flatMap((n) => (paths[n] ? [paths[n]] : [])))
  const sheetFiles = unzipSync(bytes, { filter: (f) => wanted.has(f.name) })
  const sheets: Record<string, string> = {}
  for (const name of Object.values(SHIFT_SHEETS)) if (paths[name]) sheets[name] = text(paths[name], sheetFiles)
  const res = parseWorkbook({ workbook: '', rels: '', sharedStrings: text('xl/sharedStrings.xml', base), sheets })
  if (!res.month) throw new Error('no-rows')
  return { fileName: file.name, month: res.month, rows: res.rows, missingSheets: res.missingSheets }
}

export function ShiftImportPage() {
  const { t } = useTranslation('manager')
  const toast = useToast()
  const queryClient = useQueryClient()
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [readError, setReadError] = useState<string | null>(null)

  const linked = useQuery({
    queryKey: ['admin', 'roster-links'],
    queryFn: async () =>
      unwrap<{ roster_name: string | null; full_name: string | null; display_name: string }[]>(
        await supabase.from('profiles').select('roster_name, full_name, display_name').not('roster_name', 'is', null),
      ),
  })
  const roster = useQuery({
    queryKey: ['staff_roster', 'all-names'],
    queryFn: async () => new Set(unwrap<{ name: string }[]>(await supabase.from('staff_roster').select('name')).map((r) => r.name)),
  })
  const existing = useQuery({
    queryKey: ['admin', 'shift-month-count', parsed?.month],
    enabled: Boolean(parsed),
    queryFn: async () => {
      const res = await supabase.from('shift_assignments').select('id', { count: 'exact', head: true }).eq('month', parsed!.month)
      if (res.error) throw new Error(res.error.message)
      return res.count ?? 0
    },
  })

  const save = useMutation({
    mutationFn: async (p: Parsed) => unwrap<number>(await supabase.rpc('import_shift_month', { p_month: p.month, p_rows: p.rows })),
    onSuccess: (n) => {
      toast(t('shiftImport.done', { n }))
      setParsed(null)
      void queryClient.invalidateQueries({ queryKey: ['shift_assignments'] })
      void queryClient.invalidateQueries({ queryKey: ['shift_coworkers'] })
      void queryClient.invalidateQueries({ queryKey: ['staff_roster'] })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'shift-month-count'] })
    },
  })

  const onFile = async (file: File | undefined) => {
    setParsed(null)
    setReadError(null)
    if (!file) return
    try {
      setParsed(await readWorkbook(file))
    } catch (err) {
      setReadError(err instanceof Error && err.message === 'no-rows' ? t('shiftImport.noRows') : t('shiftImport.readError', { msg: errorMessage(err) }))
    }
  }

  const names = parsed ? [...new Set(parsed.rows.map((r) => r.roster_name))].sort() : []
  const newNames = names.filter((n) => roster.data && !roster.data.has(n))
  const links = (linked.data ?? []).filter((l) => l.roster_name && names.includes(l.roster_name))

  return (
    <div className="flex flex-col gap-3">
      <ManagerTabs />
      <PageTitle title={t('shiftImport.title')} />
      <p className="text-sm text-muted">{t('shiftImport.note')}</p>
      <label className="flex min-h-13 cursor-pointer items-center justify-center rounded-xl border-[1.5px] border-dashed border-brand bg-white font-bold text-brand-dark hover:bg-brand-soft">
        📂 {t('shiftImport.pick')}
        <input type="file" accept=".xlsm,.xlsx" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
      </label>
      {readError && <ErrorBox message={readError} />}

      {parsed && (
        <Card className="flex flex-col gap-2">
          <p className="font-bold">{parsed.fileName}</p>
          <p className="text-lg font-bold">{t('shiftImport.month', { y: parsed.month.slice(0, 4), m: Number(parsed.month.slice(5, 7)) })}</p>
          <ul className="text-sm">
            {SHIFTS.map((s) => (
              <li key={s}>
                {SHIFT_SHEETS[s]}：{t('shiftImport.rows', { n: parsed.rows.filter((r) => r.shift === s).length })}
              </li>
            ))}
          </ul>
          <p className="text-sm">{t('shiftImport.people', { n: names.length })}</p>
          {parsed.missingSheets.length > 0 && <ErrorBox message={t('shiftImport.missingSheets', { names: parsed.missingSheets.join('・') })} />}
          {newNames.length > 0 && <p className="text-sm">{t('shiftImport.newNames', { names: newNames.join('、') })}</p>}
          <div className="text-sm">
            <p className="font-bold">{t('shiftImport.linked')}</p>
            {links.length === 0 ? (
              <p className="text-muted">{t('shiftImport.noLinked')}</p>
            ) : (
              <ul>
                {links.map((l) => (
                  <li key={l.roster_name}>
                    {l.roster_name} ← {l.full_name || l.display_name}（{t('shiftImport.days', { n: parsed.rows.filter((r) => r.roster_name === l.roster_name).length })}）
                  </li>
                ))}
              </ul>
            )}
          </div>
          {(existing.data ?? 0) > 0 && <p className="rounded-lg bg-amber-50 p-2 text-sm font-bold text-amber-900">⚠️ {t('shiftImport.overwrite', { n: existing.data })}</p>}
          {save.error && <ErrorBox message={errorMessage(save.error)} />}
          <Button disabled={save.isPending || parsed.rows.length === 0} onClick={() => save.mutate(parsed)}>
            {save.isPending ? t('shiftImport.importing') : t('shiftImport.import')}
          </Button>
        </Card>
      )}
    </div>
  )
}
