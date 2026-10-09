import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth, useMe } from '../../app/auth'
import { LanguageSelect } from '../../components/LanguageSelect'
import { useToast } from '../../components/Toast'
import { Button, Card, ErrorBox, TextInput, PageTitle } from '../../components/ui'
import type { Locale } from '../../domain/types'
import { supabase } from '../../lib/supabase'

export function ProfilePage() {
  const { t } = useTranslation()
  const me = useMe()
  const { refreshProfile } = useAuth()
  const toast = useToast()
  const [name, setName] = useState(me.display_name)
  const [error, setError] = useState<string | null>(null)

  const update = async (patch: { display_name?: string; locale?: Locale }) => {
    const { error: e } = await supabase.from('profiles').update(patch).eq('id', me.id)
    if (e) return setError(e.message)
    toast(t('profile.saved'))
    void refreshProfile()
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title={t('profile.title')} />
      <Card className="flex flex-col gap-3">
        <TextInput label={t('auth.displayName')} value={name} onChange={(e) => setName(e.target.value)} />
        <Button onClick={() => update({ display_name: name.trim() })} disabled={!name.trim() || name === me.display_name}>
          {t('action.save')}
        </Button>
      </Card>
      <Card className="flex flex-col gap-2">
        <LanguageSelect onChange={(locale) => update({ locale })} />
      </Card>
      <Card className="flex flex-col gap-1 text-sm text-slate-700">
        <p>
          {t('fullName.label')}：<b>{me.full_name}</b>
        </p>
        <p className="text-xs text-slate-500">{t('fullName.note')}</p>
        <p>{t('auth.email')}：{me.email}</p>
        <p>
          {t('profile.role')}：{me.role}
          {me.can_patrol && ` / ${t('profile.patroller')}`}
        </p>
      </Card>
      {error && <ErrorBox message={error} />}
      <Button variant="danger" onClick={() => void supabase.auth.signOut()}>
        {t('action.signOut')}
      </Button>
    </div>
  )
}
