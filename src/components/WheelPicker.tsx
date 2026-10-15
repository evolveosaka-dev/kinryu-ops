import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { cx } from '../lib/cx'

const ITEM = 44
const VISIBLE = 5

/**
 * Scroll wheel (like the iPhone time picker): the row in the middle band is the value. Scrolling stops on a
 * row; tapping a row scrolls it to the middle. With no value yet, the first row is chosen.
 */
export function WheelPicker<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: ReactNode
  options: { value: T; label: ReactNode }[]
  value: T | null
  onChange: (v: T) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  )

  useEffect(() => {
    if (options.length > 0 && (value === null || !options.some((o) => o.value === value))) onChange(options[0]!.value)
  }, [options, value, onChange])

  // keep the wheel on the value when it changes from outside (or on first show)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && Math.round(el.scrollTop / ITEM) !== index) el.scrollTop = index * ITEM
  }, [index])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const onScroll = () => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const el = ref.current
      if (!el) return
      const i = Math.min(options.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM)))
      if (options[i] && options[i].value !== value) onChange(options[i].value)
    }, 90)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[15px] font-bold text-ink">{label}</span>
      <div className="relative overflow-hidden rounded-xl border border-line bg-white" style={{ height: ITEM * VISIBLE }}>
        <div aria-hidden className="pointer-events-none absolute inset-x-2 rounded-lg bg-brand/10 ring-2 ring-brand" style={{ top: ITEM * 2, height: ITEM }} />
        <div
          ref={ref}
          role="listbox"
          onScroll={onScroll}
          className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ paddingTop: ITEM * 2, paddingBottom: ITEM * 2 }}
        >
          {options.map((o, i) => (
            <button
              key={String(o.value)}
              type="button"
              role="option"
              aria-selected={i === index}
              onClick={() => ref.current?.scrollTo({ top: i * ITEM, behavior: 'smooth' })}
              className={cx('flex w-full snap-center items-center justify-center text-lg tabular-nums', i === index ? 'font-bold text-ink' : 'text-muted')}
              style={{ height: ITEM }}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-white to-transparent" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-white to-transparent" />
      </div>
    </div>
  )
}
