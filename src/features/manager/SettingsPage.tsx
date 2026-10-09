import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Icon, type IconName } from '../../components/Icon'
import { Card, PageTitle } from '../../components/ui'
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
  const links: { to: string; icon: IconName; label: string; sub: string }[] = [
    { to: '/manager/users', icon: 'users', label: t('users.title'), sub: t('settings.usersSub') },
    { to: '/manager/roster', icon: 'clipboard', label: t('roster.title'), sub: t('settings.rosterSub') },
    { to: '/manager/targets', icon: 'chart', label: t('targets.title'), sub: t('settings.targetsSub') },
    { to: '/manager/sync', icon: 'calendar', label: t('sync.title'), sub: t('settings.syncSub') },
  ]
  return (
    <div className="flex flex-col gap-3">
      <ManagerTabs />
      <PageTitle title={t('tabs.settings')} />
      <ul className="flex flex-col gap-2">
        {links.map((l) => (
          <li key={l.to}>
            <Link to={l.to} className="flex min-h-16 items-center gap-3 rounded-2xl border border-line bg-white px-3 hover:bg-surface">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                <Icon name={l.icon} size={22} />
              </span>
              <span className="flex flex-1 flex-col">
                <span className="font-semibold">{l.label}</span>
                <span className="text-xs text-muted">{l.sub}</span>
              </span>
              <Icon name="chevronRight" size={18} className="text-slate-500" />
            </Link>
          </li>
        ))}
      </ul>
      <Card className="flex flex-col gap-1 text-sm">
        <h2 className="font-bold">{t('settings.translation')}</h2>
        {usage.data ? (
          <>
            <p>{t('settings.translationCalls', { n: usage.data.calls })}</p>
            <p className="text-xs text-slate-600">
              {t('settings.translationTokens', { input: usage.data.input, output: usage.data.output, usd: usage.data.usd.toFixed(2) })}
            </p>
          </>
        ) : (
          <p className="text-slate-600">—</p>
        )}
      </Card>
    </div>
  )
}
