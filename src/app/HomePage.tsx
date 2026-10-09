import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { SpokenPhrase } from '../components/SpokenPhrase'
import { Card, SectionTitle } from '../components/ui'
import { PHILOSOPHY, SERVICE_PHRASES } from '../domain/phrases'
import { currentSlot, formatShortDate, MEETING_TIME } from '../domain/time'
import { useAuth, useMe } from './auth'

function InfoRow({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5 text-[17px] font-bold">
      <span aria-hidden className="flex size-8 items-center justify-center rounded-lg bg-brand-soft text-base">
        {icon}
      </span>
      {children}
    </li>
  )
}

function MenuItem({ to, icon, tint, title, sub }: { to: string; icon: string; tint: string; title: string; sub: string }) {
  return (
    <li>
      <Link to={to} className="flex items-center gap-3 p-3.5 hover:bg-surface">
        <span aria-hidden className={`flex size-11 shrink-0 items-center justify-center rounded-xl text-xl ${tint}`}>
          {icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-bold">{title}</span>
          <span className="text-sm text-muted">{sub}</span>
        </span>
        <span aria-hidden className="text-xl text-slate-500">
          ›
        </span>
      </Link>
    </li>
  )
}

export function HomePage() {
  const { t } = useTranslation()
  const me = useMe()
  const { canPatrol, isManager } = useAuth()
  const slot = currentSlot(new Date())

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[23px] leading-tight font-bold">{t('home.name', { name: me.display_name || me.full_name })}</h1>
        <p className="mt-1 text-muted">{t('home.welcome')}</p>
      </div>

      <Card className="border-blue-200">
        <p className="mb-2 font-bold text-brand">{t('home.now')}</p>
        <ul className="flex flex-col gap-2">
          <InfoRow icon="📅">{formatShortDate(slot.businessDate)}</InfoRow>
          <InfoRow icon="⏰">
            {t(`shift.${slot.shift}`)} <span className="font-normal">{t(`shiftTime.${slot.shift}`)}</span>
          </InfoRow>
          <InfoRow icon="📣">{t('chorei:meeting', { time: MEETING_TIME[slot.shift] })}</InfoRow>
        </ul>
        <div className="mt-4 flex flex-col gap-2.5">
          <Link to="/chorei" className="flex min-h-13 items-center justify-center rounded-xl bg-brand text-[17px] font-bold text-white hover:bg-brand-dark">
            {t('home.choreiButton')}
          </Link>
          <Link
            to="/genko"
            className="flex min-h-12 items-center justify-center gap-2 rounded-xl border-[1.5px] border-brand bg-white font-bold text-brand-dark hover:bg-brand-soft"
          >
            <span aria-hidden>📜</span>
            {t('genko:title')}
          </Link>
        </div>
      </Card>

      <section className="flex flex-col gap-2">
        <SectionTitle>{t('home.menu')}</SectionTitle>
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {canPatrol && <MenuItem to="/patrol" icon="🔍" tint="bg-amber-100" title={t('home.patrolButton')} sub={t('home.patrolSub')} />}
            <MenuItem to="/shift-request" icon="📝" tint="bg-violet-100" title={t('home.shiftRequest')} sub={t('home.shiftRequestSub')} />
            <MenuItem to="/history" icon="🗂️" tint="bg-green-100" title={t('home.historyButton')} sub={t('home.historySub')} />
            {isManager && <MenuItem to="/manager" icon="📊" tint="bg-blue-100" title={t('home.managerButton')} sub={t('home.managerSub')} />}
          </ul>
        </Card>
      </section>

      <section className="flex flex-col gap-2">
        <SectionTitle>{t('home.philosophy')}</SectionTitle>
        <Card>
          <ul className="flex flex-col gap-3">
            {PHILOSOPHY.map((p) => (
              <li key={p.key} className="text-[17px]">
                <SpokenPhrase ja={p.ja} romaji={p.romaji} tKey={p.key} />
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <section className="flex flex-col gap-2">
        <SectionTitle>{t('home.phrases')}</SectionTitle>
        <ul className="grid grid-cols-2 gap-2">
          {SERVICE_PHRASES.map((p) => (
            <li key={p.key} className="rounded-2xl border border-line bg-white p-3 text-[17px]">
              <SpokenPhrase ja={p.ja} romaji={p.romaji} tKey={p.key} />
            </li>
          ))}
        </ul>
      </section>

      <p className="text-sm text-muted">📱 {t('home.installHint')}</p>
    </div>
  )
}
