import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { SpokenPhrase } from '../components/SpokenPhrase'
import { Card, SectionTitle } from '../components/ui'
import { useUnreadComments } from '../features/comments/Comments'
import { DutyCard } from '../features/schedule/DutyCard'
import { NextShiftCard } from '../features/schedule/NextShiftCard'
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
  const unread = useUnreadComments()

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[23px] leading-tight font-bold">{t('home.name', { name: me.display_name || me.full_name })}</h1>
        <p className="mt-1 text-muted">{t('home.welcome')}</p>
      </div>

      {me.is_test_account && (
        <p className="rounded-2xl border-2 border-dashed border-violet-400 bg-violet-50 px-4 py-3 font-bold text-violet-900">🧪 {t('home.testAccount')}</p>
      )}

      {Boolean(unread.data?.total) && (
        <Link to={unread.data!.chorei ? '/history' : '/history?tab=patrol'} className="flex items-center gap-3 rounded-2xl border-2 border-amber-400 bg-amber-50 px-4 py-3 font-bold text-amber-950">
          <span aria-hidden className="text-2xl">
            💬
          </span>
          <span className="flex-1">{t('comment.homeCard', { n: unread.data!.total })}</span>
          <span aria-hidden className="text-xl">
            ›
          </span>
        </Link>
      )}

      <DutyCard />

      <NextShiftCard />

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
            <MenuItem to="/schedule" icon="📅" tint="bg-sky-100" title={t('home.schedule')} sub={t('home.scheduleSub')} />
            {isManager && <MenuItem to="/all-shifts" icon="🗓️" tint="bg-teal-100" title={t('home.allShifts')} sub={t('home.allShiftsSub')} />}
            <MenuItem to="/shift-request" icon="📝" tint="bg-violet-100" title={t('home.shiftRequest')} sub={t('home.shiftRequestSub')} />
            <MenuItem to="/history" icon="🗂️" tint="bg-green-100" title={t('home.historyButton')} sub={t('home.historySub')} />
            {isManager && <MenuItem to="/manager" icon="📊" tint="bg-blue-100" title={t('home.managerButton')} sub={t('home.managerSub')} />}
          </ul>
        </Card>
      </section>

      <section className="flex flex-col gap-2">
        <SectionTitle>
          {t('home.learn')}
          <span className="ml-2 rounded-md bg-amber-100 px-2 py-0.5 align-middle text-sm font-bold text-amber-900">🚧 {t('home.learnBadge')}</span>
        </SectionTitle>
        <Card className="p-0">
          <ul className="divide-y divide-line">
            <MenuItem to="/learn/manual" icon="📘" tint="bg-sky-100" title={t('home.manual')} sub={t('home.manualSub')} />
            <MenuItem to="/learn/videos" icon="🎥" tint="bg-rose-100" title={t('home.videos')} sub={t('home.videosSub')} />
            <MenuItem to="/learn/skills" icon="📈" tint="bg-lime-100" title={t('home.skills')} sub={t('home.skillsSub')} />
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
