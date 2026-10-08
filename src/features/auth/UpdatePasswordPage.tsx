import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../app/auth'
import { useToast } from '../../components/Toast'
import { Button, Card, ErrorBox, TextInput } from '../../components/ui'
import { supabase } from '../../lib/supabase'

export function UpdatePasswordPage() {
  const { t } = useTranslation()
  const { clearRecovery } = useAuth()
  const toast = useToast()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    setBusy(true)
    const { error: e } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (e) return setError(e.message)
    toast(t('auth.passwordUpdated'))
    clearRecovery()
  }

  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <Card>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <h1 className="text-lg font-bold">{t('auth.resetTitle')}</h1>
          <TextInput
            label={t('auth.newPassword')}
            hint={t('auth.passwordHint')}
            type="password"
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
          {error && <ErrorBox message={error} />}
          <Button type="submit" disabled={busy}>
            {t('auth.updatePassword')}
          </Button>
        </form>
      </Card>
    </main>
  )
}
