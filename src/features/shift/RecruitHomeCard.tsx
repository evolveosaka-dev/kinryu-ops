import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useMe } from '../../app/auth'
import { today, useRecruits } from './changeData'

/** Home: open 代わり募集 I could take, and my report decided in the last day. */
export function RecruitHomeCard() {
  const { t } = useTranslation('shift')
  const me = useMe()
  const recruits = useRecruits(Boolean(me.roster_name))
  const open = (recruits.data ?? []).filter((r) => r.status === 'open' && !r.my_offer_id)
  const covering = (recruits.data ?? []).filter((r) => r.assigned && r.business_date >= today())
  if (!open.length && !covering.length) return null
  return (
    <Link to="/absence?tab=recruit" className="flex items-center gap-3 rounded-2xl border-2 border-sky-400 bg-sky-50 px-4 py-3 font-bold text-sky-950">
      <span aria-hidden className="text-2xl">
        🙋
      </span>
      <span className="flex-1">
        {open.length > 0 && <span className="block">{t('change.homeRecruit', { n: open.length })}</span>}
        {covering.length > 0 && <span className="block text-green-800">✅ {t('change.homeCovering', { n: covering.length })}</span>}
      </span>
      <span aria-hidden className="text-xl">
        ›
      </span>
    </Link>
  )
}

