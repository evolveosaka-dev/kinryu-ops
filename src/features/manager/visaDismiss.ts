import { useState } from 'react'
import { visaHidden, visaRuns, type VisaDismissed } from '../../domain/shiftChange'

type Run = ReturnType<typeof visaRuns>[number]

/** The runs this manager hid on this phone (owner, 2026-10-19); they come back when they get worse. */
export function useVisaDismissed(userId: string) {
  const key = `visaHidden:${userId}`
  const [hidden, setHidden] = useState<VisaDismissed>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? '{}') as VisaDismissed
    } catch {
      return {}
    }
  })
  const save = (next: VisaDismissed) => {
    setHidden(next)
    try {
      localStorage.setItem(key, JSON.stringify(next))
    } catch {
      // storage blocked: hidden for this visit only
    }
  }
  return {
    isHidden: (r: Run) => visaHidden(r, hidden),
    hide: (r: Run) => save({ ...hidden, [r.name]: { to: r.to, maxMin: r.maxMin } }),
    show: (name: string) => {
      const next = { ...hidden }
      delete next[name]
      save(next)
    },
  }
}
export type VisaDismiss = ReturnType<typeof useVisaDismissed>
