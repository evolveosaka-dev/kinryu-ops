import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth, useMe } from '../../app/auth'
import { LanguageSelect } from '../../components/LanguageSelect'
import { useToast } from '../../components/Toast'
import { Button, Card, ErrorBox, Segmented, TextInput } from '../../components/ui'
import { currentLocale } from '../../i18n'
import { storeName } from '../../lib/format'
import { useStores } from '../../lib/queries'
import { supabase } from '../../lib/supabase'

function GateShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-brand">{t('app.title')}</h1>
        <LanguageSelect compact />
      </div>
      {children}
      <Button variant="ghost" onClick={() => void supabase.auth.signOut()}>
        {t('action.signOut')}
      </Button>
    </main>
  )
}

/** Signed up but not approved yet: let the user fill name and store while waiting. */
export function PendingPage() {
  const { t } = useTranslation()
  const me = useMe()
  const { refreshProfile } = useAuth()
  const toast = useToast()
  const stores = useStores()
  const [name, setName] = useState(me.display_name)
  const [store, setStore] = useState(me.home_store_id ?? '')
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const { error: e } = await supabase
      .from('profiles')
      .update({ display_name: name.trim(), home_store_id: store || null, locale: currentLocale() })
      .eq('id', me.id)
    if (e) return setError(e.message)
    toast(t('pending.saved'))
    void refreshProfile()
  }

  return (
    <GateShell>
      <Card className="flex flex-col gap-4">
        <h2 className="text-lg font-bold">⏳ {t('pending.title')}</h2>
        <p>{t('pending.body')}</p>
        <TextInput label={t('auth.displayName')} hint={t('auth.displayNameHint')} value={name} onChange={(e) => setName(e.target.value)} />
        {stores.data && (
          <Segmented
            label={t('pending.homeStore')}
            value={store}
            onChange={setStore}
            options={stores.data.map((s) => ({ value: s.id, label: storeName(s, currentLocale()) }))}
          />
        )}
        {error && <ErrorBox message={error} />}
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={save} disabled={!name.trim()}>
            {t('action.save')}
          </Button>
          <Button variant="secondary" onClick={() => void refreshProfile()}>
            {t('action.refresh')}
          </Button>
        </div>
      </Card>
    </GateShell>
  )
}

/** Full name (氏名) is required before anything else; it is used for weekly / monthly reports. */
export function FullNamePage() {
  const { t } = useTranslation()
  const me = useMe()
  const { refreshProfile } = useAuth()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const normalized = name.trim().replace(/\s+/g, ' ')

  const save = async () => {
    if (normalized.length < 2) return setError(t('fullName.tooShort'))
    setBusy(true)
    const { error: e } = await supabase.from('profiles').update({ full_name: normalized }).eq('id', me.id)
    setBusy(false)
    if (e) return setError(e.message)
    void refreshProfile()
  }

  return (
    <GateShell>
      <Card className="flex flex-col gap-4">
        <h2 className="text-lg font-bold">🪪 {t('fullName.title')}</h2>
        <p>{t('fullName.body')}</p>
        <TextInput
          label={t('fullName.label')}
          hint={t('fullName.hint')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          maxLength={100}
          required
        />
        <p className="text-sm text-slate-600">{t('fullName.note')}</p>
        {error && <ErrorBox message={error} />}
        <Button onClick={save} disabled={busy || normalized.length < 2}>
          {t('fullName.submit')}
        </Button>
      </Card>
    </GateShell>
  )
}

export function InactivePage() {
  const { t } = useTranslation()
  return (
    <GateShell>
      <Card>
        <h2 className="text-lg font-bold">{t('inactive.title')}</h2>
        <p className="mt-2">{t('inactive.body')}</p>
      </Card>
    </GateShell>
  )
}

export function PrivacyPage() {
  const { t } = useTranslation()
  const me = useMe()
  const { refreshProfile } = useAuth()
  const [error, setError] = useState<string | null>(null)

  const accept = async () => {
    const { error: e } = await supabase
      .from('profiles')
      .update({ privacy_accepted_at: new Date().toISOString() })
      .eq('id', me.id)
    if (e) return setError(e.message)
    void refreshProfile()
  }

  return (
    <GateShell>
      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">🔒 {t('privacy.title')}</h2>
        <p>{t('privacy.body1')}</p>
        <p>{t('privacy.body2')}</p>
        <p>{t('privacy.body3')}</p>
        {error && <ErrorBox message={error} />}
        <Button onClick={accept}>{t('privacy.accept')}</Button>
      </Card>
    </GateShell>
  )
}
