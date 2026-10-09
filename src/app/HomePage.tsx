import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { SpokenPhrase } from '../components/SpokenPhrase'
import { Card } from '../components/ui'
import { PHILOSOPHY, SERVICE_PHRASES } from '../domain/phrases'
import { currentSlot, formatShortDate, MEETING_TIME } from '../domain/time'
import { useAuth, useMe } from './auth'

function BigLink({ to, icon, label }: { to: string; icon: string; label: string }) {
  return (
    <Link
      to={to}
      className="flex min-h-16 items-center gap-3 rounded-2xl bg-brand px-4 text-lg font-bold text-white shadow active:bg-brand-dark"
    >
      <span aria-hidden className="text-2xl">
        {icon}
      </span>
      {label}
    </Link>
  )
}

export function HomePage() {
  const { t } = useTranslation()
  const me = useMe()
  const { canPatrol, isManager } = useAuth()
  const slot = currentSlot(new Date())

  return (
    <div className="flex flex-col gap-4">
      <p className="text-lg font-bold">{t('home.hello', { name: me.display_name })}</p>
      <p className="text-sm text-slate-600">
        {t('home.now')}：{formatShortDate(slot.businessDate)} {t(`shift.${slot.shift}`)}（{t('chorei:meeting', { time: MEETING_TIME[slot.shift] })}）
      </p>

      <BigLink to="/chorei" icon="📣" label={t('home.choreiButton')} />
      <Link to="/genko" className="flex min-h-12 items-center justify-center rounded-xl bg-white font-bold text-brand ring-1 ring-brand">
        📜 {t('genko:title')}
      </Link>
      {canPatrol && <BigLink to="/patrol" icon="🔍" label={t('home.patrolButton')} />}
      <div className="grid grid-cols-2 gap-2">
        <Link to="/history" className="flex min-h-12 items-center justify-center rounded-xl bg-white font-bold ring-1 ring-slate-300">
          🗂️ {t('home.historyButton')}
        </Link>
        {isManager && (
          <Link to="/manager" className="flex min-h-12 items-center justify-center rounded-xl bg-white font-bold ring-1 ring-slate-300">
            🛠️ {t('home.managerButton')}
          </Link>
        )}
      </div>

      <Card>
        <h2 className="mb-2 font-bold text-slate-700">{t('home.philosophy')}</h2>
        <ul className="flex flex-col gap-2">
          {PHILOSOPHY.map((p) => (
            <li key={p.key}>
              <SpokenPhrase ja={p.ja} romaji={p.romaji} tKey={p.key} />
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="mb-2 font-bold text-slate-700">{t('home.phrases')}</h2>
        <ul className="flex flex-col gap-2">
          {SERVICE_PHRASES.map((p) => (
            <li key={p.key}>
              <SpokenPhrase ja={p.ja} romaji={p.romaji} tKey={p.key} />
            </li>
          ))}
        </ul>
      </Card>
      <p className="text-xs text-slate-500">📱 {t('home.installHint')}</p>
    </div>
  )
}
