import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Card } from '../../components/ui'
import { unwrap } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { monthOf, today } from './data'
import { ManagerTabs } from './ManagerTabs'

// Claude Haiku 4.5 list prices (USD per 1M tokens) — keep in sync with the translate function's model.
const PRICE_IN = 1
const PRICE_OUT = 5

function useTranslationUsage() {
  const { from } = monthOf(today().slice(0, 7))
  return useQuery({
    queryKey: ['admin', 'translation-usage', from],
    queryFn: async () => {
      const rows = unwrap<{ input_tokens: number | null; output_tokens: number | null }[]>(
        await supabase.from('translation_log').select('input_tokens, output_tokens').gte('at', `${from}T00:00:00+09:00`),
      )
      const input = rows.reduce((s, r) => s + (r.input_tokens ?? 0), 0)
      const output = rows.reduce((s, r) => s + (r.output_tokens ?? 0), 0)
      return { calls: rows.length, input, output, usd: (input * PRICE_IN + output * PRICE_OUT) / 1_000_000 }
    },
  })
}

export function SettingsPage() {
  const { t } = useTranslation('manager')
  const usage = useTranslationUsage()
  const links = [
    { to: '/manager/users', icon: '👥', label: t('users.title'), sub: t('settings.usersSub') },
    { to: '/manager/roster', icon: '📋', label: t('roster.title'), sub: t('settings.rosterSub') },
    { to: '/manager/targets', icon: '🍜', label: t('targets.title'), sub: t('settings.targetsSub') },
    { to: '/manager/sync', icon: '📊', label: t('sync.title'), sub: t('settings.syncSub') },
  ]
  return (
    <div className="flex flex-col gap-3">
      <ManagerTabs />
      <h1 className="text-xl font-bold">⚙️ {t('tabs.settings')}</h1>
      <ul className="flex flex-col gap-2">
        {links.map((l) => (
          <li key={l.to}>
            <Link to={l.to} className="flex min-h-14 items-center gap-3 rounded-2xl bg-white px-4 ring-1 ring-slate-200">
              <span aria-hidden className="text-2xl">
                {l.icon}
              </span>
              <span className="flex flex-col">
                <b>{l.label}</b>
                <span className="text-xs text-slate-500">{l.sub}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Card className="flex flex-col gap-1 text-sm">
        <h2 className="font-bold">🌐 {t('settings.translation')}</h2>
        {usage.data ? (
          <>
            <p>{t('settings.translationCalls', { n: usage.data.calls })}</p>
            <p className="text-xs text-slate-500">
              {t('settings.translationTokens', { input: usage.data.input, output: usage.data.output, usd: usage.data.usd.toFixed(2) })}
            </p>
          </>
        ) : (
          <p className="text-slate-500">—</p>
        )}
      </Card>
    </div>
  )
}
