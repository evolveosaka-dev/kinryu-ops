import { useTranslation } from 'react-i18next'
import { PageTitle } from '../../components/ui'
import { ManagerTabs } from '../manager/ManagerTabs'
import { LostItemsList } from './LostItems'

/** メニュー → 忘れ物・落とし物: every staff member sees the list, records new items and returns. */
export function LostItemsPage() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title={t('lost.title')} subtitle={t('lost.subtitle')} />
      <LostItemsList />
    </div>
  )
}

/** 管理 → 忘れ物: the same list, opened on 承認待ち. */
export function LostItemsAdminPage() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-3">
      <ManagerTabs />
      <PageTitle title={t('lost.title')} subtitle={t('lost.adminSubtitle')} />
      <LostItemsList initialFilter="pending" canAdd={false} />
    </div>
  )
}
