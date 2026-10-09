import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { LanguageSelect } from '../../components/LanguageSelect'
import { Button, Card, ErrorBox, TextInput } from '../../components/ui'
import { currentLocale } from '../../i18n'
import { appBaseUrl, supabase } from '../../lib/supabase'

type Mode = 'login' | 'signup' | 'forgot'

export function LoginPage() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [fullName, setFullName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const google = async () => {
    setError(null)
    const { error: e } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: appBaseUrl(), queryParams: { prompt: 'select_account' } },
    })
    if (e) setError(e.message)
  }

  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      if (mode === 'login') {
        const { error: e } = await supabase.auth.signInWithPassword({ email, password })
        if (e) setError(t('auth.invalid'))
      } else if (mode === 'signup') {
        const { error: e } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: appBaseUrl(), data: { display_name: displayName.trim(), entered_full_name: fullName.trim(), locale: currentLocale() } },
        })
        if (e) setError(e.message)
        else setInfo(t('auth.checkEmail'))
      } else {
        const { error: e } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: appBaseUrl() })
        if (e) setError(e.message)
        else setInfo(t('auth.resetSent'))
      }
    } finally {
      setBusy(false)
    }
  }

  const title = mode === 'login' ? t('auth.title') : mode === 'signup' ? t('auth.signupTitle') : t('auth.resetTitle')

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <span className="flex size-9 items-center justify-center rounded-xl bg-brand text-base text-white" aria-hidden>
            金
          </span>
          {t('app.title')}
        </h1>
        <LanguageSelect compact />
      </div>

      <Card className="flex flex-col gap-4">
        <h2 className="text-lg font-bold">{title}</h2>

        {mode !== 'forgot' && (
          <>
            <Button variant="secondary" onClick={google} className="flex items-center justify-center gap-2">
              <span aria-hidden className="text-lg">G</span> {t('auth.google')}
            </Button>
            <div className="flex items-center gap-3 text-sm text-slate-600">
              <hr className="flex-1" /> {t('auth.or')} <hr className="flex-1" />
            </div>
          </>
        )}

        <form onSubmit={submit} className="flex flex-col gap-3">
          {mode === 'signup' && (
            <TextInput
              label={t('fullName.label')}
              hint={t('fullName.hint')}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              minLength={2}
              maxLength={100}
              autoComplete="name"
            />
          )}
          {mode === 'signup' && (
            <TextInput
              label={t('auth.displayName')}
              hint={t('auth.displayNameHint')}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              autoComplete="nickname"
            />
          )}
          <TextInput
            label={t('auth.email')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            inputMode="email"
          />
          {mode !== 'forgot' && (
            <TextInput
              label={t('auth.password')}
              hint={mode === 'signup' ? t('auth.passwordHint') : undefined}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
          )}
          {error && <ErrorBox message={error} />}
          {info && <p className="rounded-xl bg-green-50 p-3 text-sm font-bold text-green-800">{info}</p>}
          <Button type="submit" disabled={busy}>
            {mode === 'login' ? t('auth.login') : mode === 'signup' ? t('auth.signup') : t('auth.sendReset')}
          </Button>
        </form>

        <div className="flex flex-col items-start gap-1">
          {mode !== 'login' && (
            <Button variant="ghost" onClick={() => setMode('login')}>
              {t('auth.haveAccount')}
            </Button>
          )}
          {mode !== 'signup' && (
            <Button variant="ghost" onClick={() => setMode('signup')}>
              {t('auth.noAccount')}
            </Button>
          )}
          {mode === 'login' && (
            <Button variant="ghost" onClick={() => setMode('forgot')}>
              {t('auth.forgot')}
            </Button>
          )}
        </div>
      </Card>
      <p className="text-center text-xs text-slate-500">
        {t('app.company')} ・{' '}
        <a href="privacy.html" className="underline">
          Privacy Policy
        </a>
      </p>
    </main>
  )
}
