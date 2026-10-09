import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Icon, type IconName } from '../components/Icon'
import { SpokenPhrase } from '../components/SpokenPhrase'
import { SectionTitle } from '../components/ui'
import { PHILOSOPHY, SERVICE_PHRASES } from '../domain/phrases'
import { currentSlot, formatShortDate, MEETING_TIME } from '../domain/time'
import { useAuth, useMe } from './auth'

function InfoRow({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5 text-[15px] text-ink">
      <Icon name={icon} size={18} className="text-muted" />
      {children}
    </li>
  )
}

const primaryLink = 'flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-[15px] font-semibold text-white hover:bg-brand-dark'
const secondaryLink = 'flex min-h-12 items-center justify-center gap-2 rounded-xl border border-ink/80 bg-white px-4 text-[15px] font-semibold text-ink hover:bg-surface'

function ListLink({ to, icon, title, sub }: { to: string; icon: IconName; title: string; sub?: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 rounded-2xl border border-line bg-white p-3 hover:bg-surface">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
        <Icon name={icon} size={22} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold">{title}</span>
        {sub && <span className="truncate text-sm text-muted">{sub}</span>}
      </span>
      <Icon name="chevronRight" size={18} className="text-slate-400" />
    </Link>
  )
}

export function HomePage() {
  const { t } = useTranslation()
  const me = useMe()
  const { canPatrol, isManager } = useAuth()
  const slot = currentSlot(new Date())

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight">{me.display_name || me.full_name}</h1>
        <p className="mt-0.5 text-sm text-muted">{t('home.welcome')}</p>
      </div>

      <section className="overflow-hidden rounded-2xl border border-brand/15 bg-brand-soft">
        <p className="px-4 pt-3 text-sm font-semibold text-brand">{t('home.now')}</p>
        <ul className="flex flex-col gap-2 px-4 py-3">
          <InfoRow icon="calendar">{formatShortDate(slot.businessDate)}</InfoRow>
          <InfoRow icon="clock">
            {t(`shift.${slot.shift}`)} <span className="text-muted">{t(`shiftTime.${slot.shift}`)}</span>
          </InfoRow>
          <InfoRow icon="megaphone">{t('chorei:meeting', { time: MEETING_TIME[slot.shift] })}</InfoRow>
        </ul>
        <div className="flex flex-col gap-2 bg-white/60 p-3">
          <Link to="/chorei" className={primaryLink}>
            {t('home.choreiButton')}
          </Link>
          <Link to="/genko" className={secondaryLink}>
            <Icon name="book" size={18} />
            {t('genko:title')}
          </Link>
        </div>
      </section>

      <section className="flex flex-col gap-2.5">
        <SectionTitle>{t('home.menu')}</SectionTitle>
        {canPatrol && <ListLink to="/patrol" icon="clipboard" title={t('home.patrolButton')} sub={t('home.patrolSub')} />}
        <ListLink to="/history" icon="history" title={t('home.historyButton')} sub={t('home.historySub')} />
        {isManager && <ListLink to="/manager" icon="chart" title={t('home.managerButton')} sub={t('home.managerSub')} />}
      </section>

      <section className="flex flex-col gap-2.5">
        <SectionTitle>{t('home.philosophy')}</SectionTitle>
        <ul className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
          {PHILOSOPHY.map((p) => (
            <li key={p.key}>
              <SpokenPhrase ja={p.ja} romaji={p.romaji} tKey={p.key} />
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2.5">
        <SectionTitle>{t('home.phrases')}</SectionTitle>
        <ul className="grid grid-cols-2 gap-2">
          {SERVICE_PHRASES.map((p) => (
            <li key={p.key} className="rounded-2xl bg-surface p-3">
              <SpokenPhrase ja={p.ja} romaji={p.romaji} tKey={p.key} />
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-muted">{t('home.installHint')}</p>
    </div>
  )
}
