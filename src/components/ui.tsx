import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { useId } from 'react'
import { cx } from '../lib/cx'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'px-4 bg-brand text-white hover:bg-brand-dark active:bg-brand-dark disabled:bg-slate-300',
  secondary: 'px-4 bg-white text-ink border border-ink/80 hover:bg-surface active:bg-surface disabled:border-line disabled:text-slate-400',
  ghost: 'px-1 text-brand hover:underline underline-offset-2 disabled:text-slate-400',
  danger: 'px-4 bg-white text-red-700 border border-red-300 hover:bg-red-50 active:bg-red-50',
}

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'min-h-12 rounded-xl py-2 text-[15px] font-semibold transition-colors disabled:cursor-not-allowed',
        VARIANTS[variant],
        className,
      )}
    />
  )
}

/** Light-grey surface card (the reference design's grouped blocks). */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('rounded-2xl border border-line bg-white p-4', className)}>{children}</section>
}

/** Page title with an optional subtitle. */
export function PageTitle({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <h1 className="text-[22px] leading-tight font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-base font-bold tracking-tight">{children}</h2>
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: string | null
  children: ReactNode
  htmlFor?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-semibold text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
      {error && (
        <p role="alert" className="text-sm font-semibold text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}

const inputClass =
  'w-full min-h-12 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-base placeholder:text-slate-400 focus:border-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand/10'

export function TextInput({ label, hint, error, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode; error?: string | null }) {
  const id = useId()
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <input id={id} {...props} className={cx(inputClass, props.className)} aria-invalid={Boolean(error)} />
    </Field>
  )
}

export function TextArea({ label, hint, error, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: ReactNode; hint?: ReactNode; error?: string | null }) {
  const id = useId()
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <textarea id={id} rows={2} {...props} className={cx(inputClass, props.className)} aria-invalid={Boolean(error)} />
    </Field>
  )
}

/** Choice tiles (shift, store, type…): outlined, the selected one in blue. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  columns,
}: {
  label: ReactNode
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
  /** defaults to one column per option */
  columns?: number
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      {label && <legend className="mb-1.5 text-sm font-semibold text-ink">{label}</legend>}
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))` }}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cx(
              'min-h-12 rounded-xl border px-2 py-2 text-sm font-semibold transition-colors',
              value === o.value ? 'border-brand bg-brand-soft text-brand ring-1 ring-brand' : 'border-line bg-white text-ink hover:bg-surface',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

export function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-1">
      <input type="checkbox" className="size-5 rounded accent-brand" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-[15px]">{children}</span>
    </label>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-10 text-muted" role="status">
      <div className="size-7 animate-spin rounded-full border-[3px] border-line border-t-brand" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  )
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">
      {message}
    </p>
  )
}

/** Fixed bottom bar for the main action of a form (above the bottom navigation). */
export function StickyActions({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 -mx-4 mt-2 border-t border-line bg-white/95 px-4 py-3 backdrop-blur">
      {children}
    </div>
  )
}
