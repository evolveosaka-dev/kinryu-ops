import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { useId } from 'react'
import { cx } from '../lib/cx'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-white active:bg-brand-dark disabled:bg-slate-300',
  secondary: 'bg-white text-slate-900 border border-slate-300 active:bg-slate-100 disabled:text-slate-400',
  ghost: 'text-brand underline-offset-2 hover:underline disabled:text-slate-400',
  danger: 'bg-white text-red-700 border border-red-300 active:bg-red-50',
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
        'min-h-11 rounded-xl px-4 py-2 text-base font-bold transition-colors disabled:cursor-not-allowed',
        VARIANTS[variant],
        className,
      )}
    />
  )
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200', className)}>{children}</section>
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
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-bold text-slate-700">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      {error && (
        <p role="alert" className="text-sm font-bold text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}

const inputClass =
  'w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30'

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

/** Large radio-style buttons (shift, store, type…). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: ReactNode
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm font-bold text-slate-700">{label}</legend>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cx(
              'min-h-11 rounded-xl border px-2 py-2 text-sm font-bold',
              value === o.value ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white text-slate-800',
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
      <input type="checkbox" className="size-6 accent-brand" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-base">{children}</span>
    </label>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-10 text-slate-500" role="status">
      <div className="size-8 animate-spin rounded-full border-4 border-slate-200 border-t-brand" />
      {label && <span>{label}</span>}
    </div>
  )
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800">
      {message}
    </p>
  )
}

/** Fixed bottom bar for the main action of a form (above the bottom navigation). */
export function StickyActions({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-16 z-10 -mx-4 mt-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
      {children}
    </div>
  )
}
